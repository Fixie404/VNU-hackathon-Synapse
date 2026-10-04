"""Self-test for scraper/lib. Run: scraper/.venv/bin/python scraper/test_normalize.py"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lib.normalize import (  # noqa: E402
    BUCHAREST_AREAS, RANKS, haversine_km, nearest_area, normalize_rank,
    normalize_specialty, parse_price_ron, strip_diacritics,
)
from lib.schema import validate  # noqa: E402

SPEC, SENIOR = RANKS


def eq(got, want, what):
    assert got == want, f"{what}: got {got!r}, want {want!r}"


def test_strip_diacritics():
    eq(strip_diacritics("ș ş ț ţ ă â î"), "s s t t a a i", "lower")
    eq(strip_diacritics("Ș Ş Ț Ţ Ă Â Î"), "S S T T A A I", "upper")
    eq(strip_diacritics("Obstetrică-Ginecologie"), "Obstetrica-Ginecologie", "word")
    eq(strip_diacritics("Café Ñ ü"), "Cafe N u", "general NFKD")
    eq(strip_diacritics(""), "", "empty")


def test_normalize_rank():
    cases = {
        "Medic primar": SENIOR,
        "MEDIC PRIMAR": SENIOR,
        "primar": SENIOR,
        "Medic primar cardiologie": SENIOR,
        "Medic specialist": SPEC,
        "specialist": SPEC,
        "Medic Specialistă": SPEC,
        "Medic specialist, medic primar": SENIOR,
        "medic primar / medic specialist": SENIOR,
        "Medic rezident": None,
        "Psiholog": None,
        "Profesor universitar": None,
        "Primary": None,
        "": None,
        None: None,
        SPEC: SPEC,
        SENIOR: SENIOR,
    }
    for text, want in cases.items():
        eq(normalize_rank(text), want, f"rank {text!r}")


def test_normalize_specialty():
    cases = {
        "Cardiologie": "Cardiology",
        "cardiologie": "Cardiology",
        "  CARDIOLOGIE ": "Cardiology",
        "Dermatologie": "Dermatology",
        "Dermato-venerologie": "Dermatology",
        "Dermato - Venerologie": "Dermatology",
        "Obstetrică-Ginecologie": "Obstetrics & Gynecology",
        "Obstetrica - ginecologie": "Obstetrics & Gynecology",
        "Obstetrică și Ginecologie": "Obstetrics & Gynecology",
        "ORL": "ENT (Otorhinolaryngology)",
        "Otorinolaringologie": "ENT (Otorhinolaryngology)",
        "Ortopedie-Traumatologie": "Orthopedics",
        "Ortopedie și traumatologie": "Orthopedics",
        "Medicină internă": "Internal Medicine",
        "Pneumologie": "Pulmonology",
        "Diabet zaharat, nutriție și boli metabolice": "Diabetes & Nutrition",
        "Alergologie și imunologie clinică": "Allergy & Clinical Immunology",
        "Recuperare, medicină fizică și balneologie": "Physical Medicine & Rehabilitation",
        "Medicină de familie": "Family Medicine",
        "Boli infecțioase": "Infectious Diseases",
        "Stomatologie": "Dentistry",
        "Psihologie": "Psychology",
        "Cardiologie pediatrică": "Pediatric Cardiology",
        "Neurologie pediatrică": "Pediatric Neurology",
        "Endocrinologie pediatrică": "Pediatric Endocrinology",
        "Gastroenterologie pediatrică": "Pediatric Gastroenterology",
        "Chirurgie pediatrică": "Pediatric Surgery",
        "Chirurgie generală": "General Surgery",
        "Neurochirurgie": "Neurosurgery",
        "Oncologie medicală": "Medical Oncology",
        "Medic primar Cardiologie": "Cardiology",
        "Cardiology": "Cardiology",
        "Obstetrics & Gynecology": "Obstetrics & Gynecology",
        "Astrologie": None,
        "Cardiologie si astrologie": None,
        "": None,
        None: None,
    }
    for text, want in cases.items():
        eq(normalize_specialty(text), want, f"specialty {text!r}")


def test_parse_price_ron():
    cases = {
        "320 lei": 320,
        "320 LEI": 320,
        "320 RON": 320,
        "320lei": 320,
        "RON 320": 320,
        "1.200 lei": 1200,
        "1 200 RON": 1200,
        "1 200 RON": 1200,
        "320,00 lei": 320,
        "320.00 RON": 320,
        "1.200,00 lei": 1200,
        "Consultație cardiologie: 350 lei": 350,
        "Preț: 450 lei": 450,
        # rejected
        "200-300 lei": None,
        "200 - 300 RON": None,
        "200–300 lei": None,
        "de la 200 lei": None,
        "De la 200 lei": None,
        "from 200 RON": None,
        "începând cu 250 lei": None,
        "incepand de la 250 lei": None,
        "~300 lei": None,
        "aprox. 300 lei": None,
        "320,50 lei": None,
        "320.5 lei": None,
        "1,200 lei": None,
        "200 lei / 300 lei": None,
        "200 lei sau 300 lei": None,
        "50 EUR": None,
        "300 lei (50 €)": None,
        "0 lei": None,
        "320": None,           # no currency
        "gratuit": None,
        "": None,
        None: None,
        "300+ lei": None,
    }
    for text, want in cases.items():
        eq(parse_price_ron(text), want, f"price {text!r}")
    eq(parse_price_ron("320", require_currency=False), 320, "bare figure, currency not required")
    eq(parse_price_ron("200-300", require_currency=False), None, "bare range")
    r = parse_price_ron("1.200 lei")
    assert type(r) is int, "must return int"


def test_geo():
    eq(round(haversine_km(44.4268, 26.1025, 44.4268, 26.1025), 6), 0.0, "zero distance")
    d = haversine_km(44.4268, 26.1025, 44.4524, 26.0858)  # Unirii -> Victoriei
    assert 2.5 < d < 3.8, d
    for name, (lat, lng) in BUCHAREST_AREAS.items():
        eq(nearest_area(lat, lng), name, f"nearest_area at {name} centre")
        assert 44.3 <= lat <= 44.6 and 25.9 <= lng <= 26.3, name


def test_schema():
    good = {
        "id": 1, "name": "Dr. Test Example", "image": None, "hospital": "Sanador",
        "specialty": "Cardiology", "medicalRank": SENIOR, "priceRON": 350,
        "priceService": "Consultatie cardiologie", "priceSourceUrl": "https://example.org/p",
        "scrapedAt": "2026-10-04", "clinicName": "Clinica X", "address": "Str. X 1",
        "area": "Unirii", "lat": 44.43, "lng": 26.10, "acceptsCNAS": False,
        "profileUrl": "https://example.org/dr",
    }
    eq(validate(good), [], "valid record")
    eq(validate({**good, "manual": True}), [], "manual ok")
    assert validate({**good, "priceRON": True}), "bool price"
    assert validate({**good, "priceRON": 0}), "zero price"
    assert validate({**good, "priceRON": 350.0}), "float price"
    assert validate({**good, "lat": 45.0}), "lat bbox"
    assert validate({**good, "hospital": "Other"}), "hospital enum"
    assert validate({**good, "profileUrl": "http://x"}), "https only"
    assert validate({**good, "name": "  "}), "empty str"
    assert validate({**good, "acceptsCNAS": 1}), "bool CNAS"
    assert validate({**good, "scrapedAt": "2026-13-01"}), "bad date"
    assert validate({**good, "extra": 1}), "unknown field"
    no_id = {k: v for k, v in good.items() if k != "id"}
    assert validate(no_id), "id required by default"
    eq(validate(no_id, require_id=False), [], "id optional")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\nall {len(tests)} test groups passed")
