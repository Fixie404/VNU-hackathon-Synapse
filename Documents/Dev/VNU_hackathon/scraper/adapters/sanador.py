"""SANADOR adapter for MedIndex.

Sources (all server-rendered HTML on www.sanador.ro, robots.txt allows all):
  * /contact-sanador        - every location: name, published address and a
                              Google Maps embed. Only embeds that carry
                              coordinates (!3d<lat>!2d<lng>) are used; locations
                              whose embed is an address query have no coords and
                              their doctors are dropped.
  * /<clinic page>          - "specialitati in contract cu CNAS" list (CNAS).
  * /medici?location=<id>   - doctor listing per clinic (paginated).
  * /<doctor slug>          - profile: name, photo, "Medic primar|specialist
                              <Specialitate>", locations and, for some doctors,
                              a doctor-specific price table.
  * /pret                   - network price list: "Consultatie <specialitate>
                              medic primar|specialist" rows.

Price rule (per doctor):
  1. doctor-specific table on the profile, if it has exactly one first
     consultation price for the doctor's specialty -> that price, source = profile;
  2. otherwise the exact /pret row for the specialty + rank (or the single
     rank-independent row for Obstetrics-Gynecology);
  3. otherwise (no row, ambiguous, academic-tier pricing that can't be matched)
     the doctor is dropped.
"""

from __future__ import annotations

import os
import re
import sys
import traceback
from urllib.parse import urljoin

if __name__ == "__main__":  # allow running stand-alone
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bs4 import BeautifulSoup

from lib.http import fetch
from lib.normalize import nearest_area, normalize_rank, normalize_specialty, parse_price_ron, strip_diacritics

BASE = "https://www.sanador.ro"
CONTACT_URL = BASE + "/contact-sanador"
PRICE_URL = BASE + "/pret"
LISTING_URL = BASE + "/medici"

# Listing filters (ids from the <select id="location"> on /medici) and how many
# listing pages to read per location (keeps the crawl well under ~150 requests).
LOCATIONS_TO_CRAWL = [
    ("19", 2),  # Clinica SANADOR Militari
    ("1", 3),   # Clinica SANADOR Decebal
    ("6", 2),   # Clinica SANADOR Baneasa
    ("21", 3),  # Clinica SANADOR Buzesti (12 pages; first 3 only)
]
MAX_PER_SPECIALTY = 8

# Sanador specialty (as written on the site) -> stem used in /pret rows
# "Consultatie <stem> medic primar|specialist".
PRICE_STEMS = {
    "Cardiologie": "cardiologie",
    "Dermato-venerologie": "dermatologie",
    "Endocrinologie": "endocrinologie",
    "Gastroenterologie": "gastroenterologie",
    "Neurologie": "neurologie",
    "O.R.L.": "O.R.L",
    "Pediatrie": "pediatrie",
    "Medicină internă": "medicina interna",
    "Urologie": "urologie",
    "Pneumologie": "pneumologie",
    "Reumatologie": "reumatologie",
    "Nefrologie": "nefrologie",
    "Oftalmologie": None,  # no plain rank-based consultation row on /pret
}
OBGYN = "Obstetrică-ginecologie"
OBGYN_ROW = "Consultatie obstetrica-ginecologie"
OBGYN_PROF_ROW = "Consultatie obstetrica-ginecologie medic profesor"
IN_SCOPE = set(PRICE_STEMS) | {OBGYN}

# General Practitioner / Family Doctor step: the team listed on the
# family-medicine specialty page, in published order, until GP_LIMIT valid
# records. Price: the single rank-independent /pret row below.
GP_URL = BASE + "/medicina-de-familie"
GP_SPEC = "Medicină de familie"
GP_ROW = "Consultatie medicina generala/medicina de familie"
GP_LIMIT = 2
GP_MAX_PROFILES = 6

_COORD_RE = re.compile(r"!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)")
# on _key() text (lowercase, no diacritics): "consultatii <specialties> cu decontare cas"
_CAS_BANNER_RE = re.compile(r"^consultatii (.+?) cu decontare (?:cas|cnas)\b")


def _log(msg: str) -> None:
    print(f"[sanador] {msg}", file=sys.stderr, flush=True)


def _soup(url: str) -> BeautifulSoup:
    return BeautifulSoup(fetch(url), "html.parser")


def _txt(el) -> str:
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip() if el else ""


def _key(s: str) -> str:
    return re.sub(r"\s+", " ", strip_diacritics(s).lower()).strip()


# --------------------------------------------------------------------------
# locations, coordinates, CNAS

def _cnas_specialties(clinic_url: str) -> set[str]:
    """English specialties listed under 'specialitati in contract cu CNAS'."""
    out: set[str] = set()
    try:
        s = _soup(clinic_url)
    except Exception as e:  # noqa: BLE001
        _log(f"clinic page failed {clinic_url}: {e}")
        return out
    for p in s.find_all("p"):
        # "...specialitati in contract cu CNAS:" (Militari) or
        # "Noi avem si consultatii in contract CAS:" (Baneasa), followed by a <ul>
        k = _key(_txt(p))
        if "in contract cu cnas" in k or re.search(r"\bconsultatii in contract (?:cu )?(?:cas|cnas)\b", k):
            ul = p.find_next_sibling("ul")
            if ul:
                for li in ul.find_all("li"):
                    sp = normalize_specialty(_txt(li))
                    if sp:
                        out.add(sp)
    # Explicit coverage banners such as
    # "Consultații Dermato-venerologie, Obstetrică-ginecologie și ORL cu decontare CAS!"
    for el in s.find_all(["div", "p", "li", "span", "strong"]):
        if el.find(["div", "p", "li"]):
            continue  # leaf-ish blocks only, so one statement is read once
        m = _CAS_BANNER_RE.match(_key(_txt(el)))
        if not m:
            continue
        for part in re.split(r",|\bsi\b", m.group(1)):
            sp = normalize_specialty(part.strip())
            if sp:
                out.add(sp)
    return out


def load_locations() -> dict[str, dict]:
    s = _soup(CONTACT_URL)
    locs: dict[str, dict] = {}
    for block in s.select("div.localizare"):
        name = _txt(block.h2)
        if not name:
            continue
        address = None
        for li in block.select("ul.date-contact li"):
            if li.h3 and _key(_txt(li.h3)) == "adresa" and li.p:
                address = _txt(li.p)
        iframe = block.find("iframe")
        m = _COORD_RE.search(iframe.get("src", "")) if iframe else None
        link = block.h2.find("a")
        locs[name] = {
            "name": name,
            "address": address,
            "lat": float(m.group(2)) if m else None,
            "lng": float(m.group(1)) if m else None,
            "page": urljoin(BASE, link["href"]) if link and link.get("href") else None,
            "cnas": None,  # filled lazily
        }
    return locs


def _cnas_for(loc: dict) -> set[str]:
    if loc["cnas"] is None:
        loc["cnas"] = _cnas_specialties(loc["page"]) if loc["page"] else set()
    return loc["cnas"]


# --------------------------------------------------------------------------
# prices

def load_price_list() -> dict[str, int]:
    """Top-level /pret rows: service name -> RON. A service that appears with
    different prices is mapped to None (ambiguous)."""
    s = _soup(PRICE_URL)
    prices: dict[str, int | None] = {}
    for row in s.select("div.row-preturi"):
        if row.find_parent("div", class_="row-preturi--plus") is not None:
            continue  # per-doctor sub-rows (handled via the profile pages)
        sv = row.find("span", class_="cell-serviciu", recursive=False)
        pr = row.find("span", class_="cell-pret", recursive=False)
        if not sv or not pr:
            continue
        name = _txt(sv)
        val = parse_price_ron(_txt(pr))
        if val is None:
            continue
        if name in prices and prices[name] != val:
            prices[name] = None
        else:
            prices.setdefault(name, val)
    # row-preturi--plus headers carry the generic price as their first sub-row
    for plus in s.select("div.row-preturi--plus"):
        title = plus.get("data-title", "").strip()
        for sub in plus.select("div.tabel-preturi div.row-preturi"):
            sv, pr = sub.select_one(".cell-serviciu"), sub.select_one(".cell-pret")
            if sv and pr and not sv.find("a") and _txt(sv) == title:
                val = parse_price_ron(_txt(pr))
                if val is not None:
                    if title in prices and prices[title] != val:
                        prices[title] = None
                    else:
                        prices.setdefault(title, val)
    return {k: v for k, v in prices.items() if v is not None}


def _doctor_table_prices(s: BeautifulSoup, ro_spec: str) -> list[tuple[str, int]]:
    """First-consultation rows for the specialty in the profile's own table."""
    stem = OBGYN_ROW[len("Consultatie "):] if ro_spec == OBGYN else PRICE_STEMS.get(ro_spec)
    if not stem:
        stem = ro_spec
    out = []
    for row in s.select("div.tabel-preturi--medic div.row-preturi"):
        name = _txt(row.select_one(".cell-serviciu"))
        k = _key(name)
        if not k.startswith("consult") or "control" in k or "+" in k:
            continue
        if _key(stem) not in k:
            continue
        val = parse_price_ron(_txt(row.select_one(".cell-pret")))
        if val is not None:
            out.append((name, val))
    return out


# --------------------------------------------------------------------------
# listing + profiles

def _listing_pages(loc_id: str, max_pages: int) -> list[str]:
    return [f"{LISTING_URL}?location={loc_id}" + (f"&page={p}" if p > 1 else "")
            for p in range(1, max_pages + 1)]


def collect_listing() -> list[dict]:
    seen: set[str] = set()
    items: list[dict] = []
    for loc_id, max_pages in LOCATIONS_TO_CRAWL:
        for url in _listing_pages(loc_id, max_pages):
            try:
                s = _soup(url)
            except Exception as e:  # noqa: BLE001
                _log(f"listing failed {url}: {e}")
                break
            cards = s.select("div.listing-medici a.news-item")
            if not cards:
                break
            for a in cards:
                href = urljoin(BASE, a.get("href", ""))
                if href in seen:
                    continue
                seen.add(href)
                h6 = a.select_one("h6")
                spec = h6.find(string=True, recursive=False).strip() if h6 else ""
                items.append({"url": href, "spec": spec, "name": _txt(a.select_one("h3"))})
    return items


def _rank_for(s: BeautifulSoup, ro_spec: str) -> str | None:
    """Rank stated for this specialty in the profile ('Medic primar X')."""
    box = s.select_one("div.main-medic")
    if not box:
        return None
    lines = [_txt(st) for st in box.find_all("strong")]
    segs = []
    for line in lines:
        for m in re.finditer(r"(?i)medic\s+(primar|specialist|rezident)\s+([^,;]+)", line):
            segs.append((m.group(1), m.group(2).strip()))
    target = normalize_specialty(ro_spec)
    ranks = {normalize_rank("medic " + r) for r, sp in segs
             if normalize_specialty(sp) == target or _key(sp) == _key(ro_spec)}
    if len(ranks) != 1:
        return None
    return ranks.pop()


def _locations_of(s: BeautifulSoup, locs: dict) -> list[str]:
    p = s.select_one("p.locations")
    text = _txt(p)
    found = []
    for name in locs:
        i = text.find(name)
        if i >= 0:
            found.append((i, name))
    # "Clinica SANADOR Victoriei, Corp A" must not also count as a shorter name
    found.sort()
    return [n for _, n in found]


def build_record(item: dict, locs: dict, prices: dict) -> dict:
    url = item["url"]
    s = _soup(url)
    name = _txt(s.select_one("h1")) or item["name"]
    rec = {"name": name, "profileUrl": url, "hospital": "Sanador"}

    spec_links = [_txt(a) for a in s.select("section.hero p a")]
    ro_spec = spec_links[0] if spec_links else item["spec"]
    if ro_spec != item["spec"]:
        return {**rec, "_drop_reason": "specialty mismatch listing/profile"}
    specialty = normalize_specialty(ro_spec)
    if not specialty:
        return {**rec, "_drop_reason": "specialty not mappable"}

    rank = _rank_for(s, ro_spec)
    if not rank:
        return {**rec, "_drop_reason": "rank not stated for specialty"}

    # ---- price
    title_k = _key(name)
    is_prof = bool(re.match(r"^prof\b", title_k))
    is_conf = bool(re.match(r"^conf\b", title_k))
    own = _doctor_table_prices(s, ro_spec)
    if own:
        if len({v for _, v in own}) != 1:
            return {**rec, "_drop_reason": "ambiguous doctor-specific price"}
        service, price = own[0]
        source = url
    else:
        if ro_spec == GP_SPEC:
            service = GP_ROW
        elif ro_spec == OBGYN:
            if is_prof:
                service = OBGYN_PROF_ROW
            elif is_conf:
                return {**rec, "_drop_reason": "academic title price ambiguous"}
            else:
                service = OBGYN_ROW
        else:
            stem = PRICE_STEMS.get(ro_spec)
            if not stem:
                return {**rec, "_drop_reason": "no consultation price for specialty"}
            word = "primar" if rank.startswith("Senior") else "specialist"
            service = f"Consultatie {stem} medic {word}"
        price = prices.get(service)
        if price is None:
            return {**rec, "_drop_reason": "no consultation price for specialty+rank"}
        source = PRICE_URL

    # ---- clinic
    doc_locs = _locations_of(s, locs)
    if not doc_locs:
        return {**rec, "_drop_reason": "no location published"}
    with_coords = [n for n in doc_locs if locs[n]["lat"] is not None and locs[n]["address"]]
    if not with_coords:
        return {**rec, "_drop_reason": "clinic has no published coordinates"}
    loc = locs[with_coords[0]]

    img = s.select_one("div.main-medic div.thumb img")
    image = None
    if img and img.get("src") and "no-photo" not in img["src"]:
        image = urljoin(BASE, img["src"])
        if not image.startswith("https://"):
            image = None

    return {
        **rec,
        "image": image,
        "specialty": specialty,
        "medicalRank": rank,
        "priceRON": price,
        "priceService": service,
        "priceSourceUrl": source,
        "clinicName": loc["name"],
        "address": loc["address"],
        "area": nearest_area(loc["lat"], loc["lng"]),
        "lat": loc["lat"],
        "lng": loc["lng"],
        "acceptsCNAS": specialty in _cnas_for(loc),
    }


def collect_gp() -> list[dict]:
    """Doctor cards of the family-medicine specialty page whose specialty is GP_SPEC."""
    s = _soup(GP_URL)
    items = []
    for a in s.select("div.listing-medici a.news-item"):
        h6 = a.select_one("h6")
        spec = h6.find(string=True, recursive=False).strip() if h6 else ""
        if spec == GP_SPEC:
            items.append({"url": urljoin(BASE, a.get("href", "")), "spec": spec,
                          "name": _txt(a.select_one("h3"))})
    return items


def scrape_gp(locs: dict, prices: dict, seen_urls: set[str]) -> list[dict]:
    out: list[dict] = []
    kept = tried = 0
    try:
        items = collect_gp()
    except Exception as e:  # noqa: BLE001
        _log(f"GP page failed: {e}")
        return out
    for it in items:
        if kept >= GP_LIMIT or tried >= GP_MAX_PROFILES:
            break
        if it["url"] in seen_urls:
            continue
        tried += 1
        try:
            rec = build_record(it, locs, prices)
        except Exception as e:  # noqa: BLE001
            _log(f"GP profile failed {it['url']}: {e}")
            rec = {"name": it["name"], "_drop_reason": "profile fetch/parse error"}
        out.append(rec)
        if "_drop_reason" not in rec:
            kept += 1
    return out


def scrape() -> list[dict]:
    locs = load_locations()
    prices = load_price_list()
    _log(f"{len(locs)} locations, {len(prices)} price rows")

    items = collect_listing()
    per_spec: dict[str, int] = {}
    out: list[dict] = []
    for it in items:
        if it["spec"] not in IN_SCOPE:
            continue
        if per_spec.get(it["spec"], 0) >= MAX_PER_SPECIALTY:
            continue
        per_spec[it["spec"]] = per_spec.get(it["spec"], 0) + 1
        try:
            out.append(build_record(it, locs, prices))
        except Exception as e:  # noqa: BLE001  one bad profile must not kill the run
            _log(f"profile failed {it['url']}: {e}")
            traceback.print_exc(file=sys.stderr)
            out.append({"name": it["name"], "_drop_reason": "profile fetch/parse error"})
    done = {it["url"] for it in items if it["spec"] in IN_SCOPE}
    out.extend(scrape_gp(locs, prices, done))
    return out


if __name__ == "__main__":
    import json
    print(json.dumps(scrape(), indent=1, ensure_ascii=False))
