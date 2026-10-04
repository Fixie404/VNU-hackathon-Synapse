"""Regina Maria adapter for MedIndex (Bucharest only).

How the site publishes the data (all server-rendered Drupal HTML, robots.txt
allows /clinici/... and /medici/<slug>; we never request query-string URLs):

* Clinic page  /clinici/<slug>
    - drupal entityTaxonomy JSON: {"city": {"6951": "Bucuresti"},
      "location": {"<term id>": "Bucuresti <Name>"}}  -> links the clinic to
      the location term id used in doctors' price lists
    - address: `.views-field-field-address .field-content`
    - coords:  Google Maps link `maps/(dir|search)/?api=1&destination=LAT,LNG`
    - CNAS:    only if the clinic page body (header/nav/footer removed)
      explicitly mentions services "decontate CAS" / CNAS / Casa de Asigurari
* Clinic doctor listing /clinici/<slug>/medici (first page, 10 doctors)
* Doctor profile /medici/<slug>
    - name: <h1>
    - rank + specialty per specialty: `.section_medic-profile
      .paragraph--type--medic-specialties` (field-degree / field-specialty)
    - prices: `.paragraph--type--investigation-prices` cards (name + "NNN Lei")
      for the location pre-selected in the `select[name=locatie]` filter;
      each card's appointment link carries `location=<term>&specialty=<term>`
      so every price is tied to an exact clinic and specialty.

Price rule: for the doctor's specialty S, at the pre-selected location, take
the card(s) named exactly "Consult <X>" where normalize_specialty(X) equals
normalize_specialty(S) and whose specialty term is S. Exactly one distinct
price must result, otherwise the doctor is dropped. No price is ever derived.
"""

from __future__ import annotations

import html as _html
import json
import os
import re
import sys

if __name__ == "__main__":  # allow running standalone
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bs4 import BeautifulSoup

from lib.http import fetch, RobotsDisallowed, OfflineCacheMiss, HTTPStatusError  # noqa: F401
from lib.normalize import (normalize_rank, normalize_specialty, parse_price_ron,
                           nearest_area, strip_diacritics)

BASE = "https://www.reginamaria.ro"
HOSPITAL = "Regina Maria"
BUCHAREST_CITY_TERM = "6951"

# Bucharest policlinics whose doctor listings we sample (first page each).
SEED_CLINICS = [
    "policlinica-primaverii",
    "policlinica-floreasca",
    "policlinica-cotroceni",
    "policlinica-lujerului",
    "policlinica-victoria",
    "policlinica-baneasa",
    "policlinica-titu-maiorescu",
    "policlinica-doamna-ghica",
]
MAX_EXTRA_CLINIC_FETCHES = 12

_COORD_RE = re.compile(
    r"google\.com/maps/(?:dir|search)/\?api=1&(?:amp;)?(?:destination|query)=(-?\d+\.\d+),(-?\d+\.\d+)")
_TAXO_RE = re.compile(r'"entityTaxonomy":(\{.*?\}\})')
_CNAS_RE = re.compile(r"\bCNAS\b|\bdecontat\w*\s+(?:de\s+)?CAS\b|\bCAS\b\s+decont|casa de asigurari", re.I)


def _log(msg: str) -> None:
    print(f"[reginamaria] {msg}", file=sys.stderr, flush=True)


def _clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", _html.unescape(s or "")).strip()


# --------------------------------------------------------------------------
# clinics

class ClinicIndex:
    """location term id -> clinic info, built from clinic pages."""

    def __init__(self) -> None:
        self.by_term: dict[str, dict | None] = {}
        self.fetched: set[str] = set()
        self.extra_fetches = 0

    def load(self, url: str, *, extra: bool = False) -> None:
        url = url.split("#")[0].rstrip("/")
        if url in self.fetched:
            return
        if extra:
            if self.extra_fetches >= MAX_EXTRA_CLINIC_FETCHES:
                return
            self.extra_fetches += 1
        self.fetched.add(url)
        try:
            page = fetch(url)
        except Exception as e:  # noqa: BLE001
            _log(f"clinic fetch failed {url}: {e}")
            return
        info = parse_clinic(page, url)
        if info is None:
            return
        for term in info["_terms"]:
            # a term claimed by two different clinic pages is ambiguous
            if term in self.by_term and self.by_term[term] and self.by_term[term]["url"] != url:
                self.by_term[term] = None
            elif term not in self.by_term:
                self.by_term[term] = info

    def resolve(self, term: str, affiliation_urls: list[str]) -> dict | None:
        if term not in self.by_term:
            for u in affiliation_urls:
                self.load(u, extra=True)
                if term in self.by_term:
                    break
        return self.by_term.get(term)


def parse_clinic(page: str, url: str) -> dict | None:
    m = _TAXO_RE.search(page)
    if not m:
        _log(f"no taxonomy on {url}")
        return None
    try:
        taxo = json.loads(m.group(1))
    except ValueError:
        return None
    city = taxo.get("city") or {}
    locs = taxo.get("location") or {}
    if BUCHAREST_CITY_TERM not in city or not isinstance(locs, dict) or len(locs) != 1:
        return None

    coords = set(_COORD_RE.findall(page))
    if len(coords) != 1:
        _log(f"coords missing/ambiguous on {url}: {coords}")
        return {"_terms": list(locs), "url": url, "invalid": "clinic coords missing"}
    lat, lng = (float(x) for x in next(iter(coords)))

    soup = BeautifulSoup(page, "html.parser")
    addrs = {_clean(BeautifulSoup(str(el), "html.parser").get_text(" "))
             for el in soup.select(".views-field-field-address .field-content")}
    addrs = {a.rstrip(",").strip() for a in addrs if a}
    if len(addrs) != 1:
        return {"_terms": list(locs), "url": url, "invalid": "clinic address missing"}
    h1 = soup.select_one("h1")
    name = _clean(h1.get_text(" ")) if h1 else ""
    if not name:
        return {"_terms": list(locs), "url": url, "invalid": "clinic name missing"}

    for tag in soup(["script", "style", "noscript", "header", "footer", "nav"]):
        tag.decompose()
    region = soup.select_one(".region-content") or soup
    cnas = bool(_CNAS_RE.search(strip_diacritics(region.get_text(" "))))

    return {
        "_terms": list(locs),
        "url": url,
        "clinicName": name,
        "address": next(iter(addrs)),
        "lat": lat,
        "lng": lng,
        "area": nearest_area(lat, lng),
        "acceptsCNAS": cnas,
    }


# --------------------------------------------------------------------------
# doctors

def _specialty_en(text: str) -> str | None:
    """normalize_specialty, also accepting the site's 'Orl (otorinolaringologie)'
    form when the text outside and inside the parentheses agree."""
    en = normalize_specialty(text)
    if en:
        return en
    m = re.fullmatch(r"\s*(.+?)\s*\((.+)\)\s*", text or "")
    if m:
        a, b = normalize_specialty(m.group(1)), normalize_specialty(m.group(2))
        if a and a == b:
            return a
    return None


def _consult_specialty(item_name: str) -> str | None:
    m = re.fullmatch(r"(?i)consult\s+(.+)", item_name.strip())
    return _specialty_en(m.group(1)) if m else None


def parse_profile(page: str, url: str, clinics: ClinicIndex) -> dict:
    soup = BeautifulSoup(page, "html.parser")
    h1 = soup.select_one("h1")
    name = _clean(h1.get_text(" ")) if h1 else ""
    if not name:
        return {"name": url, "_drop_reason": "no name"}

    def drop(reason: str) -> dict:
        return {"name": name, "profileUrl": url, "_drop_reason": reason}

    prof = soup.select_one(".section_medic-profile")
    if prof is None:
        return drop("no profile section")
    specs = []
    for p in prof.select(".paragraph--type--medic-specialties"):
        deg = p.select_one(".field--name-field-degree")
        spc = p.select_one(".field--name-field-specialty")
        specs.append((_clean(deg.get_text()) if deg else "", _clean(spc.get_text()) if spc else ""))
    if not specs:
        return drop("no specialty")

    # image
    image = None
    img = soup.select_one(".field--name-field-medic-photo img")
    if img and img.get("src"):
        src = img["src"]
        image = src if src.startswith("https://") else (BASE + src if src.startswith("/") else None)

    # location filter of the price list
    loc_sel = soup.select_one("select[name=locatie]")
    if loc_sel is None:
        return drop("no price list")
    selected = [o for o in loc_sel.select("option") if o.has_attr("selected") and o.get("value") != "All"]
    if len(selected) != 1:
        return drop("price list location unclear")
    loc_term = selected[0]["value"]

    spec_sel = soup.select_one("select[name=specialitate]")
    spec_terms: dict[str, str] = {}
    if spec_sel is not None:
        for o in spec_sel.select("option"):
            if o.get("value") and o["value"] != "All":
                spec_terms.setdefault(_clean(o.get_text()).lower(), o["value"])

    items = []
    for card in soup.select(".paragraph--type--investigation-prices"):
        n = card.select_one(".field--name-field-investigation")
        pr = card.select_one(".field--name-field-price")
        a = card.select_one("a.is-appointment")
        q = dict(re.findall(r"(location|specialty)=(\d+)", _html.unescape(a["href"]))) if a and a.get("href") else {}
        items.append({
            "name": _clean(n.get_text()) if n else "",
            "price": _clean(pr.get_text()) if pr else "",
            "loc": q.get("location"),
            "spec": q.get("specialty"),
        })
    if not items:
        return drop("no price published")
    if any(it["loc"] != loc_term for it in items):
        return drop("price list location unclear")

    # first listed specialty with a stated rank and exactly one consult price
    reasons = []
    chosen = None
    for degree, spec_ro in specs:
        rank = normalize_rank(degree)
        if not rank:
            reasons.append("rank not stated")
            continue
        spec_en = _specialty_en(spec_ro)
        if not spec_en:
            reasons.append("unmapped specialty")
            continue
        term = spec_terms.get(spec_ro.lower())
        if not term:
            reasons.append("no price list for specialty")
            continue
        matches = [it for it in items if it["spec"] == term and _consult_specialty(it["name"]) == spec_en]
        prices = {parse_price_ron(it["price"]) for it in matches}
        if not matches:
            reasons.append("no standard consult price")
            continue
        if None in prices:
            reasons.append("unparseable price")
            continue
        if len(prices) != 1:
            reasons.append("ambiguous consult price")
            continue
        chosen = (degree, spec_ro, rank, spec_en, matches[0]["name"], prices.pop())
        break
    if chosen is None:
        return drop(reasons[0] if reasons else "no standard consult price")
    degree, spec_ro, rank, spec_en, item_name, price = chosen

    # clinic for the price list's location
    aff_urls = []
    for sc in soup.select('script[type="application/ld+json"]'):
        for u in re.findall(r'"url":\s*"(https://www\.reginamaria\.ro/(?:clinici|spitale|pediatrie)/[^"#]+)', sc.string or ""):
            if u not in aff_urls:
                aff_urls.append(u)
    clinic = clinics.resolve(loc_term, aff_urls)
    if clinic is None:
        return drop("clinic not resolved")
    if clinic.get("invalid"):
        return drop(clinic["invalid"])

    return {
        "name": name,
        "image": image,
        "hospital": HOSPITAL,
        "specialty": spec_en,
        "medicalRank": rank,
        "priceRON": price,
        "priceService": f"{item_name} - {spec_ro} ({degree.lower()}), {clinic['clinicName']}",
        "priceSourceUrl": url,
        "clinicName": clinic["clinicName"],
        "address": clinic["address"],
        "area": clinic["area"],
        "lat": clinic["lat"],
        "lng": clinic["lng"],
        "acceptsCNAS": clinic["acceptsCNAS"],
        "profileUrl": url,
    }


# --------------------------------------------------------------------------

def scrape() -> list[dict]:
    clinics = ClinicIndex()
    profile_urls: list[str] = []
    for slug in SEED_CLINICS:
        clinics.load(f"{BASE}/clinici/{slug}")
        try:
            listing = fetch(f"{BASE}/clinici/{slug}/medici")
        except Exception as e:  # noqa: BLE001
            _log(f"listing failed {slug}: {e}")
            continue
        for path in re.findall(r'href="(/medici/[^"?#/]+)"', listing):
            u = BASE + path
            if u not in profile_urls:
                profile_urls.append(u)
    _log(f"{len(profile_urls)} profiles from {len(SEED_CLINICS)} clinic listings")

    out: list[dict] = []
    for u in profile_urls:
        try:
            page = fetch(u)
            out.append(parse_profile(page, u, clinics))
        except Exception as e:  # noqa: BLE001 - one bad profile must not kill the run
            _log(f"profile failed {u}: {e}")
            out.append({"name": u, "_drop_reason": f"fetch/parse error ({type(e).__name__})"})
    return out


if __name__ == "__main__":
    from collections import Counter
    from lib.schema import validate
    recs = scrape()
    c = Counter(r.get("_drop_reason", "kept") for r in recs)
    print(c)
    for r in recs:
        if "_drop_reason" not in r:
            v = validate(dict(r, scrapedAt="2026-10-04"), require_id=False)
            print(r["name"], "|", r["specialty"], "|", r["medicalRank"], "|", r["priceRON"], "|", r["clinicName"], "|", r["acceptsCNAS"], v)
