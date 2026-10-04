"""Normalisation helpers shared by all MedIndex adapters.

Everything here is conservative: when a value cannot be mapped with
certainty, the function returns None instead of guessing.
"""

from __future__ import annotations

import math
import re
import unicodedata

HOSPITALS = ("Sanador", "MedLife", "Regina Maria", "Medicover")
RANKS = ("Specialist Physician", "Senior Consultant / Primary Physician")

SPECIALIST, SENIOR = RANKS


# --------------------------------------------------------------------------
# diacritics

_RO_MAP = str.maketrans({
    "ș": "s", "ş": "s", "Ș": "S", "Ş": "S",
    "ț": "t", "ţ": "t", "Ț": "T", "Ţ": "T",
    "ă": "a", "Ă": "A", "â": "a", "Â": "A", "î": "i", "Î": "I",
})


def strip_diacritics(s: str) -> str:
    """Remove Romanian (comma- and cedilla-below forms) and any other
    combining diacritics via NFKD. None -> ""."""
    if s is None:
        return ""
    s = str(s).translate(_RO_MAP)
    s = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in s if not unicodedata.combining(ch))


def _plain(text: str) -> str:
    """lowercase, no diacritics, whitespace collapsed."""
    return re.sub(r"\s+", " ", strip_diacritics(text).lower()).strip()


# --------------------------------------------------------------------------
# medical rank

_PRIMAR_RE = re.compile(r"\bprimar(?:a|ul|ului)?\b")
_SPECIALIST_RE = re.compile(r"\bspecialist(?:a|ul|ului)?\b")


def normalize_rank(text: str | None) -> str | None:
    """'medic primar' / 'primar' -> Senior; 'medic specialist' / 'specialist'
    -> Specialist; both present -> Senior; anything else (incl. 'medic
    rezident') -> None. The canonical English labels map to themselves."""
    if not text:
        return None
    raw = re.sub(r"\s+", " ", str(text)).strip()
    if raw in RANKS:
        return raw
    t = _plain(raw)
    if _PRIMAR_RE.search(t):
        return SENIOR
    if _SPECIALIST_RE.search(t):
        return SPECIALIST
    return None


# --------------------------------------------------------------------------
# specialty

def _spec_key(text: str) -> str:
    """lowercase, no diacritics, punctuation/hyphens -> space, drop the
    connectors 'si'/'and'/'&', collapse whitespace."""
    t = strip_diacritics(text).lower()
    t = re.sub(r"[^a-z0-9]+", " ", t)
    words = [w for w in t.split() if w not in ("si", "and")]
    return " ".join(words)


_ENT = "ENT (Otorhinolaryngology)"
_OBGYN = "Obstetrics & Gynecology"
_PMR = "Physical Medicine & Rehabilitation"

# Romanian (and a few English) spellings -> English label.
# Keys are written naturally; they are passed through _spec_key below.
_SPECIALTY_SOURCE: dict[str, str] = {
    # cardio
    "Cardiologie": "Cardiology",
    "Cardiologie pediatrica": "Pediatric Cardiology",
    "Cardiologie interventionala": "Interventional Cardiology",
    "Chirurgie cardiovasculara": "Cardiovascular Surgery",
    # dermatology
    "Dermatologie": "Dermatology",
    "Dermato-venerologie": "Dermatology",
    "Dermatovenerologie": "Dermatology",
    "Dermatologie-venerologie": "Dermatology",
    "Dermatologie si venerologie": "Dermatology",
    # endocrinology / diabetes
    "Endocrinologie": "Endocrinology",
    "Endocrinologie pediatrica": "Pediatric Endocrinology",
    "Diabet zaharat, nutritie si boli metabolice": "Diabetes & Nutrition",
    "Diabet zaharat nutritie boli metabolice": "Diabetes & Nutrition",
    "Diabet, nutritie si boli metabolice": "Diabetes & Nutrition",
    "Diabet zaharat": "Diabetes & Nutrition",
    "Diabetologie": "Diabetes & Nutrition",
    "Nutritie si boli metabolice": "Diabetes & Nutrition",
    "Nutritie si dietetica": "Nutrition & Dietetics",
    "Dietetica": "Nutrition & Dietetics",
    # GI
    "Gastroenterologie": "Gastroenterology",
    "Gastroenterologie pediatrica": "Pediatric Gastroenterology",
    # neuro
    "Neurologie": "Neurology",
    "Neurologie pediatrica": "Pediatric Neurology",
    "Neurochirurgie": "Neurosurgery",
    # pediatrics
    "Pediatrie": "Pediatrics",
    "Neonatologie": "Neonatology",
    "Chirurgie pediatrica": "Pediatric Surgery",
    "Chirurgie si ortopedie pediatrica": "Pediatric Surgery",
    "Ortopedie pediatrica": "Pediatric Orthopedics",
    "Nefrologie pediatrica": "Pediatric Nephrology",
    "Pneumologie pediatrica": "Pediatric Pulmonology",
    "Psihiatrie pediatrica": "Child Psychiatry",
    "Neuropsihiatrie infantila": "Child Psychiatry",
    "Alergologie pediatrica": "Pediatric Allergy",
    # ob/gyn
    "Obstetrica-Ginecologie": _OBGYN,
    "Obstetrica ginecologie": _OBGYN,
    "Obstetrica si ginecologie": _OBGYN,
    "Ginecologie-Obstetrica": _OBGYN,
    "Ginecologie": _OBGYN,
    "Obstetrica": _OBGYN,
    "Obstetrics & Gynecology": _OBGYN,
    "Obstetrics and Gynecology": _OBGYN,
    # eyes / ENT
    "Oftalmologie": "Ophthalmology",
    "ORL": _ENT,
    "O.R.L.": _ENT,
    "Otorinolaringologie": _ENT,
    "Oto-rino-laringologie": _ENT,
    "ORL - Otorinolaringologie": _ENT,
    "Otorinolaringologie (ORL)": _ENT,
    "ORL (Otorinolaringologie)": _ENT,
    "ENT": _ENT,
    "ENT (Otorhinolaryngology)": _ENT,
    "Otorhinolaryngology": _ENT,
    # orthopedics
    "Ortopedie-Traumatologie": "Orthopedics",
    "Ortopedie si traumatologie": "Orthopedics",
    "Ortopedie": "Orthopedics",
    "Traumatologie": "Orthopedics",
    # urology / nephrology
    "Urologie": "Urology",
    "Nefrologie": "Nephrology",
    # psych
    "Psihiatrie": "Psychiatry",
    "Psihologie": "Psychology",
    "Psihologie clinica": "Psychology",
    "Psihoterapie": "Psychotherapy",
    # internal / family
    "Medicina interna": "Internal Medicine",
    "Medicina de familie": "Family Medicine",
    "Medicina generala": "Family Medicine",
    "Geriatrie si gerontologie": "Geriatrics",
    "Geriatrie": "Geriatrics",
    "Medicina muncii": "Occupational Medicine",
    "Medicina sportiva": "Sports Medicine",
    # chest / rheum / blood / onco / allergy / ID
    "Pneumologie": "Pulmonology",
    "Pneumoftiziologie": "Pulmonology",
    "Reumatologie": "Rheumatology",
    "Hematologie": "Hematology",
    "Oncologie medicala": "Medical Oncology",
    "Oncologie": "Medical Oncology",
    "Radioterapie": "Radiation Oncology",
    "Alergologie si imunologie clinica": "Allergy & Clinical Immunology",
    "Alergologie": "Allergy & Clinical Immunology",
    "Imunologie clinica": "Allergy & Clinical Immunology",
    "Boli infectioase": "Infectious Diseases",
    # surgery
    "Chirurgie generala": "General Surgery",
    "Chirurgie vasculara": "Vascular Surgery",
    "Chirurgie plastica": "Plastic Surgery",
    "Chirurgie plastica, estetica si microchirurgie reconstructiva": "Plastic Surgery",
    "Chirurgie plastica estetica si reconstructiva": "Plastic Surgery",
    "Chirurgie toracica": "Thoracic Surgery",
    "Chirurgie orala si maxilo-faciala": "Oral & Maxillofacial Surgery",
    "Chirurgie oro-maxilo-faciala": "Oral & Maxillofacial Surgery",
    "Chirurgie maxilo-faciala": "Oral & Maxillofacial Surgery",
    # rehab
    "Recuperare, medicina fizica si balneologie": _PMR,
    "Reabilitare medicala": _PMR,
    "Recuperare medicala": _PMR,
    "Medicina fizica si de reabilitare": _PMR,
    "Balneofizioterapie": _PMR,
    "Balneofizioterapie si recuperare medicala": _PMR,
    "Kinetoterapie": "Physiotherapy",
    "Fizioterapie": "Physiotherapy",
    # dental
    "Stomatologie": "Dentistry",
    "Stomatologie generala": "Dentistry",
    "Medicina dentara": "Dentistry",
    "Ortodontie": "Orthodontics",
    "Ortodontie si ortopedie dento-faciala": "Orthodontics",
    # imaging / diagnostics
    "Radiologie": "Radiology",
    "Radiologie si imagistica medicala": "Radiology",
    "Radiologie-imagistica medicala": "Radiology",
    "Imagistica medicala": "Radiology",
    "Medicina nucleara": "Nuclear Medicine",
    "Anatomie patologica": "Pathology",
    "Medicina de laborator": "Laboratory Medicine",
    "Genetica medicala": "Medical Genetics",
    # anesthesia
    "Anestezie": "Anesthesiology",
    "Anestezie si terapie intensiva": "Anesthesiology",
    "ATI": "Anesthesiology",
    # other
    "Logopedie": "Speech Therapy",
}

SPECIALTY_MAP: dict[str, str] = {}
for _src, _en in _SPECIALTY_SOURCE.items():
    SPECIALTY_MAP[_spec_key(_src)] = _en
# every English label also maps to itself
for _en in set(_SPECIALTY_SOURCE.values()):
    SPECIALTY_MAP.setdefault(_spec_key(_en), _en)

SPECIALTIES = tuple(sorted(set(SPECIALTY_MAP.values())))

# Leading words that may wrap a specialty name on profile pages,
# e.g. "Medic primar Cardiologie", "Specialitatea: Neurologie".
_PREFIX_RE = re.compile(
    r"^(?:dr |doctor |medic |primar |specialist |rezident |specialitate |specialitatea |specialitati |competenta )+"
)


def normalize_specialty(text: str | None) -> str | None:
    """Romanian (or already-English) specialty -> English label, else None.
    Exact match on a normalised key only; no fuzzy/substring guessing."""
    if not text:
        return None
    key = _spec_key(str(text))
    if not key:
        return None
    if key in SPECIALTY_MAP:
        return SPECIALTY_MAP[key]
    stripped = _PREFIX_RE.sub("", key + " ").strip()
    if stripped and stripped in SPECIALTY_MAP:
        return SPECIALTY_MAP[stripped]
    return None


# --------------------------------------------------------------------------
# price

# A figure: 1-3 digits followed by groups of 3 separated by '.', space,
# NBSP or narrow NBSP, or a plain run of digits; optional ,dd / .dd decimals.
_NUM_RE = re.compile(
    r"(?<![\d.,])(\d{1,3}(?:[.   ]\d{3})+|\d+)(?:[.,](\d+))?(?![\d])"
)
_REJECT_RE = re.compile(
    r"\bde la\b|\bfrom\b|\bincep|\bstarting\b|\baprox|\bcirca\b|\bca\.|\bpeste\b"
    r"|\bpana la\b|\bup to\b|\bminim|\bmaxim|\bintre\b|\bbetween\b"
    r"|[~≈±]|\d\s*\+|\beur\b|\beuro|€|\$|\busd\b"
)


def parse_price_ron(text: str | None, *, require_currency: bool = True) -> int | None:
    """Return an exact RON price as int, or None.

    Accepts a single figure such as "320 lei", "320 RON", "1.200 lei",
    "1 200 RON", "320,00 lei". Rejects ranges, "de la"/"from"/"incepand",
    "~", non-zero decimals, ambiguous separators, other currencies and any
    text containing more than one number. Never rounds.

    By default "lei"/"RON" must appear right next to the figure; pass
    require_currency=False only when the surrounding markup (e.g. a table
    column header) already guarantees the value is in RON.
    """
    if text is None:
        return None
    t = _plain(str(text).replace(" ", " ").replace(" ", " "))
    if not t or _REJECT_RE.search(t):
        return None
    if re.search(r"\d\s*[-–—/]\s*\d", t):  # range or "x/y"
        return None

    nums = list(_NUM_RE.finditer(t))
    if len(nums) != 1:
        return None
    m = nums[0]
    int_part, dec_part = m.group(1), m.group(2)

    if dec_part is not None:
        # "1.200" is captured whole by group 1 as a thousands group, so any
        # decimal part here is either ",dd"/".dd" or ambiguous (e.g. "1,200").
        # Only an all-zero 1-2 digit fraction is an exact integer price.
        if len(dec_part) > 2 or set(dec_part) != {"0"}:
            return None

    if require_currency:
        before = t[: m.start()].rstrip()
        after = t[m.end():].lstrip()
        if not (re.match(r"(?:lei|ron)\b", after) or re.search(r"\b(?:lei|ron)\s*:?$", before)):
            return None

    value = int(re.sub(r"[.   ]", "", int_part))
    return value if value > 0 else None


# --------------------------------------------------------------------------
# geography

# Approximate centres of well-known Bucharest neighbourhoods. Used only for
# the UI's "from <area>" selector and for labelling a clinic with its nearest
# area. Never used as a clinic's own coordinates.
BUCHAREST_AREAS: dict[str, tuple[float, float]] = {
    "Floreasca": (44.4655, 26.1050),
    "Pipera": (44.4920, 26.1290),
    "Aviatorilor": (44.4561, 26.0855),
    "Dorobanti": (44.4573, 26.0947),
    "Victoriei": (44.4524, 26.0858),
    "Unirii": (44.4268, 26.1025),
    "Militari": (44.4345, 26.0150),
    "Drumul Taberei": (44.4220, 26.0310),
    "Titan": (44.4240, 26.1720),
    "Berceni": (44.3800, 26.1130),
    "Tineretului": (44.4100, 26.1060),
    "Cotroceni": (44.4330, 26.0700),
    "Baneasa": (44.4980, 26.0800),
    "Herastrau": (44.4700, 26.0820),
    "Obor": (44.4495, 26.1255),
    "Pantelimon": (44.4440, 26.1640),
    "Crangasi": (44.4520, 26.0450),
    "Rahova": (44.4050, 26.0600),
    "Vitan": (44.4180, 26.1350),
    "Universitate": (44.4355, 26.1010),
    "Romana": (44.4469, 26.0975),
    "Grozavesti": (44.4430, 26.0600),
    "Colentina": (44.4600, 26.1450),
    "Tei": (44.4620, 26.1230),
    "Dristor": (44.4210, 26.1440),
    "Iancului": (44.4400, 26.1440),
    "Piata Muncii": (44.4310, 26.1350),
    "Lujerului": (44.4337, 26.0333),
    "Aparatorii Patriei": (44.3870, 26.1280),
}


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in km."""
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def nearest_area(lat: float, lng: float) -> str:
    """Name of the BUCHAREST_AREAS centre closest to (lat, lng)."""
    return min(BUCHAREST_AREAS, key=lambda a: haversine_km(lat, lng, *BUCHAREST_AREAS[a]))
