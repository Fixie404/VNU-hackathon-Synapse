"""Medicover (medicover.ro) adapter for MedIndex.

Sources (all server-rendered HTML, fetched through lib.http.fetch):
  * Doctor listings per specialty, Bucharest:
        https://www.medicover.ro/medici/<specialitate>/bucuresti,sl,s
  * Doctor profiles (allowed by robots.txt; /detalii-medic/ is NOT used):
        https://www.medicover.ro/medici/<slug>,<id>,d,256
    Each profile publishes the rank under the name ("Medic Primar" /
    "Medic Specialist"), the specialties, and one price table per clinic
    (<tbody id="serviceDataContainer-<clinicId>">) with rows such as
    "Consultatie cardiologie medic primar Cardiogrup | 600,00 RON".
  * Bucharest locations page (address + map marker coordinates per clinic id):
        https://www.medicover.ro/clinici/bucuresti,c,s
  * CNAS list ("servicii decontate de Casa de Asigurari de Sanatate"), linked
    from https://www.medicover.ro/servicii-decontate-cas/ :
        https://programare.medicover.ro/specialitati-decontate-cas

Price rule: for the chosen clinic, the rows whose name starts with
"Consultatie" and is not a follow-up ("control"), and that name the specialty.
Exactly one such row with an exact RON figure is required; if the row names a
rank (primar/specialist) it must match the profile's rank.
"""

from __future__ import annotations

import os
import re
import sys
from urllib.parse import urljoin

if __name__ == "__main__":  # allow running stand-alone
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bs4 import BeautifulSoup

from lib.http import fetch, RobotsDisallowed, HTTPStatusError, OfflineCacheMiss
from lib.normalize import (normalize_rank, normalize_specialty, parse_price_ron,
                           nearest_area, strip_diacritics)

BASE = "https://www.medicover.ro"
CLINICS_URL = BASE + "/clinici/bucuresti,c,s"
CAS_URL = "https://programare.medicover.ro/specialitati-decontate-cas"

# listing slug -> words that must appear in the consultation row name
SPECIALTIES: list[tuple[str, tuple[str, ...]]] = [
    ("cardiologie", ("cardiologie",)),
    ("dermatologie", ("dermatologie", "dermato")),
    ("endocrinologie", ("endocrinologie",)),
    ("gastroenterologie", ("gastroenterologie",)),
    ("neurologie", ("neurologie",)),
    ("ginecologie", ("ginecologie", "obstetrica")),
    ("oftalmologie", ("oftalmologie",)),
    ("orl", ("orl",)),
    ("pediatrie", ("pediatrie",)),
]
MAX_PROFILES_PER_SPECIALTY = 10

# General Practitioner / Family Doctor step: the family-medicine listing, in
# published order, until GP_LIMIT valid records (at most GP_MAX_PROFILES tried).
# Medicover publishes the GP consultation as "Consultatie medic generalist".
GP_SLUG = "medicina-de-familie"            # listing URL segment
GP_SPEC = "medicina de familie"            # profile specialty / CNAS list heading
GP_WORDS = ("medicina de familie", "familie", "generalist", "medicina generala")
GP_LIMIT = 2
GP_MAX_PROFILES = 6

HOSPITAL = "Medicover"


def _log(msg: str) -> None:
    print(f"[medicover] {msg}", file=sys.stderr, flush=True)


def _plain(s: str) -> str:
    return re.sub(r"\s+", " ", strip_diacritics(s or "").lower()).strip()


def _text(el) -> str:
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip() if el else ""


# --------------------------------------------------------------------------
# clinics

def _load_clinics() -> dict[int, dict]:
    """clinic id -> {name, address, lat, lng} from the Bucharest locations page."""
    html = fetch(CLINICS_URL)
    coords: dict[int, tuple[float, float, str]] = {}
    for m in re.finditer(
        r'markerData=\{id:(\d+),position:\{lat:(-?[\d.]+),lng:(-?[\d.]+)\},title:"([^"]*)"\}', html
    ):
        coords[int(m.group(1))] = (float(m.group(2)), float(m.group(3)), m.group(4))

    soup = BeautifulSoup(html, "html.parser")
    clinics: dict[int, dict] = {}
    for h2 in soup.select("h2.mf-name"):
        a = h2.find("a", href=True)
        if not a:
            continue
        m = re.search(r",(\d+),d,178", a["href"])
        if not m:
            continue
        cid = int(m.group(1))
        box = h2.find_parent(class_="mf-info")
        street = box.select_one('[itemprop="streetAddress"]') if box else None
        locality = box.select_one('[itemprop="addressLocality"]') if box else None
        if cid not in coords or not street:
            continue
        lat, lng, _title = coords[cid]
        address = _text(street)
        if locality and _text(locality):
            address = f"{address}, {_text(locality)}"
        clinics[cid] = {"name": _text(a), "address": address, "lat": lat, "lng": lng,
                        "url": urljoin(BASE, a["href"])}
    return clinics


# --------------------------------------------------------------------------
# CNAS list

_CAS_CLINIC_KEYS = {
    # word in CAS list clinic label -> word in the clinic name on medicover.ro
    "spitalul medicover": "spitalul medicover pipera",
    "maternitatea medicover": "maternitatea medicover",
    "clinica victoriei": "clinica victoria medicover",
    "clinica the bridge": "clinica the bridge medicover",
    "clinica de pediatrie": "clinica pediatrie medicover",
    "clinica pipera": "clinica pipera medicover",
    "clinica jiului": "clinica jiului medicover",
}


def _name_tokens(name: str) -> frozenset[str]:
    t = _plain(name)
    t = re.sub(r"\(.*?\)", " ", t)
    t = re.sub(r"\b(dr|prof|conf|sef|lucrari|univ)\b\.?", " ", t)
    return frozenset(w for w in re.split(r"[^a-z]+", t) if len(w) > 1)


def _load_cas() -> list[tuple[str, str, frozenset[str]]]:
    """[(specialty heading plain, clinic name on medicover.ro plain, name tokens)]
    for Bucharest entries of the CNAS doctor list."""
    try:
        html = fetch(CAS_URL)
    except Exception as e:  # CNAS info is optional: default is False
        _log(f"CNAS list unavailable: {e!r}")
        return []
    soup = BeautifulSoup(html, "html.parser")
    content = soup.find(id="content0")
    out = []
    if not content:
        return out
    spec = None
    for el in content.find_all(["h2", "p"]):
        if el.name == "h2":
            spec = _plain(_text(el))
            continue
        strong = el.find("strong")
        if not strong or spec is None:
            continue
        label = _plain(_text(strong))
        if not label.startswith("bucuresti"):
            continue
        rest = _text(el)[len(_text(strong)):]
        rest = re.sub(r"^\s*-\s*", "", rest)
        clinic = None
        for k, v in _CAS_CLINIC_KEYS.items():
            if k in label:
                clinic = v
        if clinic:
            out.append((spec, clinic, _name_tokens(rest)))
    return out


def _accepts_cnas(cas, spec_slug: str, clinic_name: str, doctor_name: str) -> bool:
    tokens = _name_tokens(doctor_name)
    cn = _plain(clinic_name)
    for spec, clinic, ntoks in cas:
        if spec != spec_slug and not spec.startswith(spec_slug):
            continue
        if clinic != cn:
            continue
        # every published token of the CNAS entry must be in the doctor's name
        if len(ntoks) >= 2 and ntoks <= tokens:
            return True
    return False


# --------------------------------------------------------------------------
# listing / profile

def _listing_profiles(spec_slug: str) -> list[str]:
    url = f"{BASE}/medici/{spec_slug}/bucuresti,sl,s"
    html = fetch(url)
    soup = BeautifulSoup(html, "html.parser")
    urls = []
    for a in soup.select("h2.result-title a[href]"):
        href = urljoin(BASE, a["href"])
        if re.search(r"/medici/[^/]+,\d+,d,\d+$", href) and href not in urls:
            urls.append(href)
    return urls


def _cell_text(fragment: str) -> str:
    return _text(BeautifulSoup(fragment, "html.parser"))


def _price_tables(html: str) -> list[tuple[int, list[tuple[str, str]]]]:
    """[(clinic id, [(service, price text), ...])] in published order."""
    out = []
    for m in re.finditer(r'<tbody id="serviceDataContainer-(\d+)">(.*?)</table>', html, re.S):
        rows = []
        for tr in re.split(r"<tr[^>]*>", m.group(2)):
            cells = re.split(r"<td[^>]*>", tr)
            if len(cells) != 3:  # '' + service + price
                continue
            rows.append((_cell_text(cells[1]), _cell_text(cells[2])))
        out.append((int(m.group(1)), rows))
    return out


def _consult_rows(rows: list[tuple[str, str]], spec_words: tuple[str, ...]):
    cands = []
    for name, price in rows:
        p = _plain(name)
        if not p.startswith("consultatie"):
            continue
        if "control" in p:
            continue
        # bundles ("+ EKG"), driving-licence checks, other sub-specialties
        if "+" in p or "permis" in p or "_" in p:
            continue
        if "pediatric" in p and "pediatrie" not in spec_words:
            continue
        if not any(re.search(r"\b" + re.escape(w), p) for w in spec_words):
            continue
        cands.append((name, price))
    return cands


def _parse_profile(url: str, spec_slug: str, spec_words, clinics, cas) -> dict:
    html = fetch(url)
    soup = BeautifulSoup(html, "html.parser")

    h1 = soup.select_one(".doctor-name h1")
    name = _text(h1)
    if not name:
        return {"name": url, "_drop_reason": "no name on profile"}
    rec: dict = {"name": name}

    rank_raw = _text(soup.select_one(".doctor-name .subtekst"))
    rank = normalize_rank(rank_raw)
    if not rank:
        return {**rec, "_drop_reason": "rank not stated"}

    specs = [_text(a) for a in soup.select(".property-value.specializations a")]
    spec_match = [s for s in specs if _plain(s) == spec_slug or _plain(s).startswith(spec_slug)]
    if not spec_match:
        return {**rec, "_drop_reason": "listing specialty not on profile"}
    spec_ro = spec_match[0]
    specialty = normalize_specialty(spec_ro)
    if not specialty:
        return {**rec, "_drop_reason": "specialty not mappable"}

    img = None
    for im in soup.select(".doctor-details img[data-src]"):
        src = im.get("data-src", "")
        if "/Data/" in src and (im.get("alt") or "").strip() and _plain(im["alt"]) in _plain(name):
            img = urljoin(BASE, src)
            break

    # price tables, in published order
    chosen = None
    reasons = []
    # The table uses unclosed <tr>/<td> tags, which html.parser nests, so the
    # rows are split on the raw markup instead.
    for cid, rows in _price_tables(html):
        if cid not in clinics:
            reasons.append("clinic not in Bucharest list")
            continue
        cands = _consult_rows(rows, spec_words)
        if not cands:
            reasons.append("no consultation price")
            continue
        if len(cands) > 1:
            reasons.append("ambiguous consultation price")
            continue
        svc, price_txt = cands[0]
        price = parse_price_ron(price_txt)
        if price is None:
            reasons.append("price not exact")
            continue
        row_rank = normalize_rank(svc)
        if row_rank and row_rank != rank:
            reasons.append("price rank mismatch")
            continue
        chosen = (cid, svc, price)
        break

    if not chosen:
        reason = reasons[0] if reasons else "no price published"
        return {**rec, "_drop_reason": reason}

    cid, svc, price = chosen
    clinic = clinics[cid]
    return {
        "name": name,
        "image": img,
        "hospital": HOSPITAL,
        "specialty": specialty,
        "medicalRank": rank,
        "priceRON": price,
        "priceService": f"{svc} ({clinic['name']})",
        "priceSourceUrl": url,
        "clinicName": clinic["name"],
        "address": clinic["address"],
        "area": nearest_area(clinic["lat"], clinic["lng"]),
        "lat": clinic["lat"],
        "lng": clinic["lng"],
        "acceptsCNAS": _accepts_cnas(cas, spec_slug, clinic["name"], name),
        "profileUrl": url,
    }


def scrape() -> list[dict]:
    clinics = _load_clinics()
    _log(f"{len(clinics)} Bucharest clinics with address+coords")
    cas = _load_cas()
    _log(f"{len(cas)} Bucharest CNAS entries")

    out: list[dict] = []
    seen: set[str] = set()
    for spec_slug, words in SPECIALTIES:
        try:
            urls = _listing_profiles(spec_slug)
        except (RobotsDisallowed, HTTPStatusError, OfflineCacheMiss) as e:
            _log(f"listing {spec_slug}: {e!r}")
            continue
        except Exception as e:  # noqa: BLE001
            _log(f"listing {spec_slug} failed: {e!r}")
            continue
        n = 0
        for url in urls:
            if url in seen:
                continue
            if n >= MAX_PROFILES_PER_SPECIALTY:
                break
            n += 1
            seen.add(url)
            try:
                out.append(_parse_profile(url, spec_slug, words, clinics, cas))
            except Exception as e:  # noqa: BLE001 - one bad profile must not kill the run
                _log(f"profile {url} failed: {e!r}")
                out.append({"name": url, "_drop_reason": "profile fetch/parse error"})
    out.extend(_scrape_gp(clinics, cas, seen))
    return out


def _scrape_gp(clinics, cas, seen: set[str]) -> list[dict]:
    out: list[dict] = []
    try:
        urls = _listing_profiles(GP_SLUG)
    except Exception as e:  # noqa: BLE001
        _log(f"GP listing failed: {e!r}")
        return out
    kept = tried = 0
    for url in urls:
        if kept >= GP_LIMIT or tried >= GP_MAX_PROFILES:
            break
        if url in seen:
            continue
        seen.add(url)
        tried += 1
        try:
            rec = _parse_profile(url, GP_SPEC, GP_WORDS, clinics, cas)
        except Exception as e:  # noqa: BLE001
            _log(f"GP profile {url} failed: {e!r}")
            rec = {"name": url, "_drop_reason": "profile fetch/parse error"}
        out.append(rec)
        if "_drop_reason" not in rec:
            kept += 1
    return out


if __name__ == "__main__":
    import json
    recs = scrape()
    print(json.dumps(recs, ensure_ascii=False, indent=1))
