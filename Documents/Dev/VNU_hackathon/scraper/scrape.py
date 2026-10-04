#!/usr/bin/env python3
"""MedIndex scraper entry point.

Run from the repo root:
    scraper/.venv/bin/python scraper/scrape.py [--only NAME] [--include-seed] [--offline]

Loads scraper/adapters/<name>.py for each network, validates and dedupes the
records, merges hand-collected seed records from data/doctors.seed.js where
needed, prints a summary and writes data/doctors.js (only if the final data
set passes the sanity checks).
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import os
import sys
import traceback
from collections import Counter

SCRAPER_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRAPER_DIR)
if SCRAPER_DIR not in sys.path:
    sys.path.insert(0, SCRAPER_DIR)  # so adapters can `from lib.http import fetch`

from lib.normalize import HOSPITALS  # noqa: E402
from lib.schema import FIELDS, OPTIONAL_FIELDS, validate  # noqa: E402

ADAPTERS_DIR = os.path.join(SCRAPER_DIR, "adapters")
SEED_PATH = os.path.join(REPO_ROOT, "data", "doctors.seed.js")
OUT_PATH = os.path.join(REPO_ROOT, "data", "doctors.js")

# adapter module name -> hospital enum value
ADAPTERS: dict[str, str] = {
    "sanador": "Sanador",
    "medlife": "MedLife",
    "reginamaria": "Regina Maria",
    "medicover": "Medicover",
}
assert set(ADAPTERS.values()) == set(HOSPITALS)

MIN_DOCTORS = 10
MIN_NETWORKS = 2


def log(msg: str) -> None:
    print(f"[scrape] {msg}", file=sys.stderr, flush=True)


class NetworkStats:
    def __init__(self) -> None:
        self.found = 0
        self.kept = 0
        self.dropped: Counter[str] = Counter()
        self.error: str | None = None

    @property
    def n_dropped(self) -> int:
        return self.found - self.kept


def load_adapter(name: str):
    path = os.path.join(ADAPTERS_DIR, f"{name}.py")
    if not os.path.exists(path):
        raise FileNotFoundError(f"adapter file missing: {os.path.relpath(path, REPO_ROOT)}")
    spec = importlib.util.spec_from_file_location(f"adapters.{name}", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    fn = getattr(module, "scrape", None)
    if not callable(fn):
        raise TypeError(f"adapter {name} has no callable scrape()")
    return fn


def clean_record(raw: dict, today: str) -> dict:
    """Drop private '_' keys, add scrapedAt if missing, order keys."""
    rec = {k: v for k, v in raw.items() if not str(k).startswith("_")}
    if "scrapedAt" not in rec or rec["scrapedAt"] in (None, ""):
        rec["scrapedAt"] = today
    ordered = {k: rec[k] for k in FIELDS if k in rec}
    ordered.update({k: rec[k] for k in OPTIONAL_FIELDS if k in rec})
    ordered.update({k: v for k, v in rec.items() if k not in ordered})  # unknown keys -> validate() flags them
    return ordered


def process(raw_records, hospital: str, today: str, stats: NetworkStats,
            seen: set, *, seed: bool = False) -> list[dict]:
    """Validate + dedupe a batch of raw records for one network."""
    kept: list[dict] = []
    for raw in raw_records:
        stats.found += 1
        if not isinstance(raw, dict):
            stats.dropped["not a dict"] += 1
            continue
        if raw.get("_drop_reason"):
            stats.dropped[str(raw["_drop_reason"])] += 1
            continue
        rec = clean_record(raw, today)
        reasons = validate(rec, require_id=False)
        if not reasons and rec["hospital"] != hospital:
            reasons = [f"hospital is not {hospital}"]
        if not reasons and seed and rec.get("manual") is not True:
            reasons = ["seed record without manual:true"]
        if reasons:
            for r in dict.fromkeys(reasons):  # each reason once per record
                stats.dropped[r] += 1
            continue
        key = (rec["hospital"], rec["profileUrl"])
        if key in seen:
            stats.dropped["duplicate (hospital, profileUrl)"] += 1
            continue
        seen.add(key)
        kept.append(rec)
        stats.kept += 1
    return kept


def load_seed() -> list:
    if not os.path.exists(SEED_PATH):
        return []
    with open(SEED_PATH, encoding="utf-8") as f:
        text = f.read()
    marker = text.find("window.DOCTORS_SEED")
    if marker < 0:
        raise ValueError("data/doctors.seed.js: 'window.DOCTORS_SEED' not found")
    eq = text.find("=", marker)
    start = text.find("[", eq)
    end = text.rfind("]")
    if eq < 0 or start < 0 or end < start:
        raise ValueError("data/doctors.seed.js: could not locate the JSON array")
    data = json.loads(text[start:end + 1])
    if not isinstance(data, list):
        raise ValueError("data/doctors.seed.js: DOCTORS_SEED is not an array")
    return data


def print_summary(title: str, stats: dict[str, NetworkStats]) -> None:
    print(f"\n{title}")
    print(f"{'network':<14} {'found':>6} {'kept':>6} {'dropped':>8}")
    print("-" * 37)
    tot = [0, 0, 0]
    for hospital, s in stats.items():
        print(f"{hospital:<14} {s.found:>6} {s.kept:>6} {s.n_dropped:>8}"
              + (f"   ERROR: {s.error}" if s.error else ""))
        for reason, n in s.dropped.most_common():
            print(f"{'':<16}- {reason}: {n}")
        tot[0] += s.found
        tot[1] += s.kept
        tot[2] += s.n_dropped
    print("-" * 37)
    print(f"{'TOTAL':<14} {tot[0]:>6} {tot[1]:>6} {tot[2]:>8}")


def write_output(records: list[dict], meta: dict, today: str) -> None:
    body = (
        f"// Generated by scraper/scrape.py on {today}. Do not edit.\n"
        f"window.DOCTORS = {json.dumps(records, indent=2, ensure_ascii=False)};\n"
        f"window.DOCTORS_META = {json.dumps(meta, ensure_ascii=False)};\n"
    )
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    tmp = OUT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(body)
    os.replace(tmp, OUT_PATH)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build data/doctors.js from the network adapters.")
    ap.add_argument("--only", choices=sorted(ADAPTERS), help="run a single adapter")
    ap.add_argument("--include-seed", action="store_true",
                    help="always merge seed records (default: only for networks with 0 scraped records)")
    ap.add_argument("--offline", action="store_true",
                    help="cache only: cache misses raise instead of fetching (MEDINDEX_OFFLINE=1)")
    args = ap.parse_args(argv)

    if args.offline:
        os.environ["MEDINDEX_OFFLINE"] = "1"

    now = dt.datetime.now().astimezone()
    today = now.date().isoformat()

    names = [args.only] if args.only else list(ADAPTERS)
    seen: set = set()
    scraped: list[dict] = []
    stats: dict[str, NetworkStats] = {}

    for name in names:
        hospital = ADAPTERS[name]
        st = stats[hospital] = NetworkStats()
        try:
            fn = load_adapter(name)
            log(f"running adapter {name} ...")
            raw = fn()
            if not isinstance(raw, list):
                raise TypeError(f"scrape() returned {type(raw).__name__}, expected list")
        except FileNotFoundError as e:
            st.error = str(e)
            log(f"SKIP {name}: {e}")
            continue
        except Exception as e:  # noqa: BLE001 - one adapter must not kill the run
            st.error = f"{type(e).__name__}: {e}"
            log(f"FAILED {name}: {st.error}")
            traceback.print_exc(file=sys.stderr)
            continue
        scraped.extend(process(raw, hospital, today, st, seen))
        log(f"{name}: found {st.found}, kept {st.kept}")

    print_summary("Scraped", stats)

    # ---- seed records
    seed_stats: dict[str, NetworkStats] = {}
    seed_kept: list[dict] = []
    try:
        seed_raw = load_seed()
    except Exception as e:  # noqa: BLE001
        log(f"could not load seed file: {type(e).__name__}: {e}")
        seed_raw = []
    if seed_raw:
        by_hospital: dict[str, list] = {}
        for r in seed_raw:
            h = r.get("hospital") if isinstance(r, dict) else None
            by_hospital.setdefault(h if h in HOSPITALS else "(invalid)", []).append(r)
        for hospital, recs in by_hospital.items():
            if hospital == "(invalid)":
                st = seed_stats[hospital] = NetworkStats()
                st.found = len(recs)
                st.dropped["missing/invalid hospital"] = len(recs)
                continue
            if hospital not in stats:  # network not run (e.g. --only)
                continue
            if not args.include_seed and stats[hospital].kept > 0:
                continue
            st = seed_stats[hospital] = NetworkStats()
            seed_kept.extend(process(recs, hospital, today, st, seen, seed=True))
        if seed_stats:
            print_summary("Seed (data/doctors.seed.js)", seed_stats)

    # ---- assemble
    records = scraped + seed_kept
    for i, rec in enumerate(records, start=1):
        rec["id"] = i
        rec_ordered = {k: rec[k] for k in FIELDS if k in rec}
        rec_ordered.update({k: rec[k] for k in rec if k not in rec_ordered})
        records[i - 1] = rec_ordered

    final_bad = [(r["id"], validate(r)) for r in records if validate(r)]
    if final_bad:  # should be impossible; guard anyway
        log(f"internal error: {len(final_bad)} final records invalid, e.g. {final_bad[:3]}")
        return 1

    networks_meta = {}
    for hospital in HOSPITALS:
        s = sum(1 for r in records if r["hospital"] == hospital and not r.get("manual"))
        m = sum(1 for r in records if r["hospital"] == hospital and r.get("manual"))
        networks_meta[hospital] = {"scraped": s, "seed": m, "total": s + m}
    represented = [h for h, c in networks_meta.items() if c["total"] > 0]

    print(f"\nFinal: {len(records)} doctors across {len(represented)} network(s): "
          + (", ".join(f"{h} {networks_meta[h]['total']}" for h in represented) or "none"))

    problems = []
    if len(records) < MIN_DOCTORS:
        problems.append(f"fewer than {MIN_DOCTORS} doctors total ({len(records)})")
    if len(represented) < MIN_NETWORKS:
        problems.append(f"fewer than {MIN_NETWORKS} networks represented ({len(represented)})")
    if problems:
        msg = "; ".join(problems)
        print(f"\nERROR: {msg}. {os.path.relpath(OUT_PATH, REPO_ROOT)} was NOT written "
              "(any previous file is left untouched).", file=sys.stderr)
        return 1

    meta = {
        "generatedAt": now.isoformat(timespec="seconds"),
        "total": len(records),
        "networks": networks_meta,
    }
    write_output(records, meta, today)
    print(f"\nWrote {os.path.relpath(OUT_PATH, REPO_ROOT)} ({len(records)} doctors).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
