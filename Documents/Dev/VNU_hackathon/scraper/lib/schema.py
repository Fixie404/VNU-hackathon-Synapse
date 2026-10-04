"""MedIndex doctor record schema and validator.

validate(record) returns a list of short, stable reason strings (empty list
== valid). Reasons are deliberately value-free so they aggregate nicely in
the scrape summary.
"""

from __future__ import annotations

import datetime as _dt
import re

from .normalize import HOSPITALS, RANKS

# Bucharest bounding box
LAT_RANGE = (44.3, 44.6)
LNG_RANGE = (25.9, 26.3)

# name -> (python type(s), description). Order is the output key order.
FIELDS: dict[str, tuple[tuple[type, ...], str]] = {
    "id": ((int,), "sequential int, assigned by scrape.py"),
    "name": ((str,), 'name as published, e.g. "Dr. Ion Popescu"'),
    "image": ((str, type(None)), "https:// photo URL, or None"),
    "hospital": ((str,), f"one of {HOSPITALS}"),
    "specialty": ((str,), "English label (normalize_specialty)"),
    "medicalRank": ((str,), f"one of {RANKS}"),
    "priceRON": ((int,), "exact published consultation price, int > 0"),
    "priceService": ((str,), "the service the price is for, as published"),
    "priceSourceUrl": ((str,), "https:// page where the price is published"),
    "scrapedAt": ((str,), "ISO date YYYY-MM-DD"),
    "clinicName": ((str,), "clinic / location name"),
    "address": ((str,), "street address as published"),
    "area": ((str,), "Bucharest area (nearest_area or published)"),
    "lat": ((float, int), f"latitude in {LAT_RANGE}"),
    "lng": ((float, int), f"longitude in {LNG_RANGE}"),
    "acceptsCNAS": ((bool,), "True ONLY if the source explicitly says so"),
    "profileUrl": ((str,), "https:// doctor profile URL"),
}

OPTIONAL_FIELDS: dict[str, tuple[tuple[type, ...], str]] = {
    "manual": ((bool,), "True for hand-collected seed records"),
}

URL_FIELDS = ("priceSourceUrl", "profileUrl")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _type_ok(value, types: tuple[type, ...]) -> bool:
    # bool is a subclass of int: never accept it where a number is expected
    if isinstance(value, bool) and bool not in types:
        return False
    return isinstance(value, types)


def validate(record: dict, *, require_id: bool = True) -> list[str]:
    """Return a list of reasons why `record` is invalid ([] == valid).

    require_id=False skips the `id` field (scrape.py validates before ids are
    assigned)."""
    if not isinstance(record, dict):
        return ["record is not a dict"]

    reasons: list[str] = []
    for name, (types, _desc) in FIELDS.items():
        if name == "id" and not require_id:
            continue
        if name not in record:
            reasons.append(f"missing {name}")
            continue
        value = record[name]
        if value is None and type(None) in types:
            continue
        if not _type_ok(value, types):
            reasons.append(f"wrong type {name}")
            continue
        if isinstance(value, str) and not value.strip():
            reasons.append(f"empty {name}")

    for name, (types, _desc) in OPTIONAL_FIELDS.items():
        if name in record and not _type_ok(record[name], types):
            reasons.append(f"wrong type {name}")

    extra = set(record) - set(FIELDS) - set(OPTIONAL_FIELDS)
    for name in sorted(extra):
        reasons.append(f"unknown field {name}")

    if reasons:
        # further checks assume the basic shape is right
        return reasons

    if require_id and record["id"] <= 0:
        reasons.append("id not positive")
    if record["hospital"] not in HOSPITALS:
        reasons.append("hospital not in enum")
    if record["medicalRank"] not in RANKS:
        reasons.append("medicalRank not in enum")
    if record["priceRON"] <= 0:
        reasons.append("priceRON not positive")

    lat, lng = record["lat"], record["lng"]
    if not (LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
        reasons.append("lat outside Bucharest bbox")
    if not (LNG_RANGE[0] <= lng <= LNG_RANGE[1]):
        reasons.append("lng outside Bucharest bbox")

    for name in URL_FIELDS:
        if not record[name].startswith("https://"):
            reasons.append(f"{name} not https://")
    if record["image"] is not None and not record["image"].startswith("https://"):
        reasons.append("image not https://")

    d = record["scrapedAt"]
    if not _DATE_RE.match(d):
        reasons.append("scrapedAt not YYYY-MM-DD")
    else:
        try:
            _dt.date.fromisoformat(d)
        except ValueError:
            reasons.append("scrapedAt invalid date")

    return reasons
