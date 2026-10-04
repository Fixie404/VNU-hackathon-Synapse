"""MedLife adapter (www.medlife.ro, server-rendered Drupal).

Sources (all allowed by robots.txt):
  * listing:  https://www.medlife.ro/medici/{specialty-slug}/bucuresti  (page 0)
  * profile:  https://www.medlife.ro/medic-{slug}
      - name (h1), rank (div.medic-grad), photo (poza_profil img)
      - price list ("Servicii / Pret"): rendered server-side for the unit that is
        pre-selected (<option selected>) in the "Unitate medicala" select.
        Each row: <li class="option" data-name=".." data-price="..">.
  * clinic:   the unit's page linked from the profile's "Locatii si program"
      section; coords from its map widget data-map=[{"id": <unit id>,
      "location": "bucuresti", "coord": "lat, lng"}], address from .sm-adresa.

Price rule: the row(s) named exactly "Consultatie" at the pre-selected unit.
All such rows must carry the same price (> 0), otherwise the doctor is dropped.
"""

from __future__ import annotations

import html
import json
import os
import re
import sys

if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lib.http import fetch
from lib.normalize import (nearest_area, normalize_rank, normalize_specialty,
                           strip_diacritics)

BASE = "https://www.medlife.ro"

# (listing slug, Romanian label used in the site's filter)
SPECIALTIES = [
    ("cardiologie", "Cardiologie"),
    ("dermatovenerologie", "Dermatovenerologie"),
    ("orl", "ORL"),
    ("endocrinologie", "Endocrinologie"),
    ("gastroenterologie", "Gastroenterologie"),
    ("neurologie", "Neurologie"),
    ("obstetrica-ginecologie", "Obstetrica - Ginecologie"),
    ("oftalmologie", "Oftalmologie"),
    ("pediatrie", "Pediatrie"),
]

# Explicit clinic-level CAS/CNAS statements (generic lab-collection notes don't count).
_CNAS_RE = re.compile(
    r"\bin contract cu (?:cas|cnas|casa)\b|\bservicii decontate (?:cas|cnas)\b")

_clinic_cache: dict[str, dict | None] = {}


def _text(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def _plain(s: str) -> str:
    return re.sub(r"\s+", " ", strip_diacritics(s).lower()).strip()


def _clinic(href: str, unit_id: str) -> dict | None:
    key = f"{href}#{unit_id}"
    if key in _clinic_cache:
        return _clinic_cache[key]
    info = None
    url = BASE + href
    page = fetch(url)
    for raw in re.findall(r'data-map="([^"]*)"', page):
        try:
            entries = json.loads(html.unescape(raw))
        except ValueError:
            continue
        for e in entries:
            if str(e.get("id")) == unit_id and e.get("location") == "bucuresti" and e.get("coord"):
                lat_s, lng_s = [x.strip() for x in e["coord"].split(",")]
                info = {"url": url, "lat": float(lat_s), "lng": float(lng_s)}
    if info:
        m = re.search(r'class="sm-adresa">\s*<a [^>]*>(.*?)</a>', page, re.S)
        info["address"] = _text(m.group(1)) if m else None
        info["cnas"] = bool(_CNAS_RE.search(_plain(_text(page))))
    _clinic_cache[key] = info
    return info


def _doctor(path: str, target: str) -> dict:
    url = BASE + path
    p = fetch(url)
    rec: dict = {"profileUrl": url, "hospital": "MedLife"}

    m = re.search(r"<h1>\s*([^<]+?)\s*</h1>", p)
    if not m:
        return {**rec, "name": path, "_drop_reason": "no name"}
    rec["name"] = html.unescape(m.group(1))

    m = re.search(r'<div class="medic-grad">\s*([^<]*?)\s*</div>', p)
    grad = html.unescape(m.group(1)) if m else ""
    rank = normalize_rank(grad)
    if not rank:
        return {**rec, "_drop_reason": "rank not stated"}
    # e.g. "Medic Primar Cardiologie": the rank must be for this specialty
    rest = re.sub(r"(?i)^\s*medic\s+(primar|specialist)\s*", "", grad).split(",")[0].split(":")[0]
    rest_spec = normalize_specialty(rest) if rest.strip() else None
    if rest_spec and rest_spec != target:
        return {**rec, "_drop_reason": "rank is for another specialty"}
    rec["medicalRank"] = rank
    rec["specialty"] = target

    m = re.search(r'<img src="(/sites/default/files/styles/poze_medici/public/poza_profil/[^"]+)"', p)
    rec["image"] = BASE + html.unescape(m.group(1)) if m else None

    # ---- price list for the pre-selected unit
    i = p.find('id="servicii"')
    sec = p[i:p.find("</section>", i)] if i >= 0 else ""
    sel = re.search(r'name="unitate">(.*?)</select>', sec, re.S)
    unit = re.search(r'<option value="(\d+)" selected="selected">([^<]+)</option>', sel.group(1)) if sel else None
    if not unit:
        return {**rec, "_drop_reason": "no unit selected for price list"}
    unit_id, unit_name = unit.group(1), html.unescape(unit.group(2)).strip()

    spsel = re.search(r'name="specialitate">(.*?)</select>', sec, re.S)
    sp_opts = [html.unescape(x).strip() for x in re.findall(r'<option value="[^"]+"[^>]*>([^<]+)</option>', spsel.group(1))] if spsel else []
    sp_labels = {normalize_specialty(o): o for o in sp_opts if normalize_specialty(o)}
    if target not in sp_labels:
        return {**rec, "_drop_reason": "specialty not offered at priced unit"}

    items = re.findall(r'<li class="option" data-name="([^"]*)" data-price="([^"]*)"', sec)
    cons = [pr for n, pr in items if _plain(html.unescape(n)) == "consultatie"]
    if not cons:
        return {**rec, "_drop_reason": "no consultation price published"}
    if len(set(cons)) != 1:
        return {**rec, "_drop_reason": "ambiguous consultation price"}
    if len(sp_labels) > 1 and len(cons) < len(sp_labels):
        return {**rec, "_drop_reason": "consultation price not tied to specialty"}
    if not re.fullmatch(r"\d+", cons[0]) or int(cons[0]) <= 0:
        return {**rec, "_drop_reason": "no consultation price published"}
    rec["priceRON"] = int(cons[0])
    rec["priceService"] = f"Consultatie, {sp_labels[target]} ({grad}), {unit_name}"
    rec["priceSourceUrl"] = url

    # ---- clinic of the priced unit
    j = p.find('id="locatii-si-program"')
    loc = p[j:p.find('id="programare"', j)] if j >= 0 else ""
    blocks = re.split(r'<div class="locatii-item">', loc)[1:]
    href = addr_profile = None
    for b in blocks:
        t = re.search(r'class="title">\s*<a href="([^"]+)"[^>]*>([^<]+)</a>', b)
        if t and html.unescape(t.group(2)).strip() == unit_name:
            href = t.group(1)
            a = re.search(r'<div class="item-content">([^<]+)</div>', b)
            addr_profile = _text(a.group(1)) if a else None
            break
    if not href:
        return {**rec, "_drop_reason": "priced unit has no location page"}
    c = _clinic(href, unit_id)
    if not c:
        return {**rec, "_drop_reason": "no clinic coordinates"}
    address = c["address"] or addr_profile
    if not address:
        return {**rec, "_drop_reason": "no clinic address"}
    rec.update(clinicName=unit_name, address=address, lat=c["lat"], lng=c["lng"],
               area=nearest_area(c["lat"], c["lng"]), acceptsCNAS=c["cnas"])
    return rec


def scrape() -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for slug, label in SPECIALTIES:
        target = normalize_specialty(label)
        try:
            listing = fetch(f"{BASE}/medici/{slug}/bucuresti")
        except Exception as e:  # noqa: BLE001
            print(f"[medlife] listing {slug} failed: {e}", file=sys.stderr)
            continue
        for path in re.findall(r'<a class="link-medic-title" href="([^"]+)"', listing):
            if path in seen:
                continue
            seen.add(path)
            try:
                out.append(_doctor(path, target))
            except Exception as e:  # noqa: BLE001
                out.append({"name": path, "_drop_reason": f"profile error {type(e).__name__}"})
    return out


if __name__ == "__main__":
    for r in scrape():
        print(r)
