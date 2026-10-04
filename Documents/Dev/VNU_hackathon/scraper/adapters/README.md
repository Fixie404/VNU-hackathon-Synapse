# MedIndex adapter contract

One module per network: `sanador.py`, `medlife.py`, `reginamaria.py`, `medicover.py`
(the file name must match exactly; `scrape.py` maps them to the hospitals
`Sanador`, `MedLife`, `Regina Maria`, `Medicover`).

```python
def scrape() -> list[dict]: ...
```

- Called once, sequentially, by `scraper/scrape.py`. An exception is logged
  and the run continues with the other networks.
- `scraper/` is on `sys.path`, so import the shared helpers like this:

```python
from lib.http import fetch, allowed, RobotsDisallowed, OfflineCacheMiss, HTTPStatusError
from lib.normalize import (HOSPITALS, RANKS, strip_diacritics, normalize_rank,
                           normalize_specialty, parse_price_ron,
                           BUCHAREST_AREAS, nearest_area, haversine_km)
from lib.schema import FIELDS, validate
```

To run an adapter on its own (`scraper/.venv/bin/python scraper/adapters/x.py`),
add `sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))`
before those imports. Or just use `scrape.py --only x`.

## Rules

- **Never invent values.** If a field cannot be read from the source, do not
  fill it with a guess. Return the record with `"_drop_reason": "<short reason>"`
  instead (e.g. `"no price published"`). Keep reasons short and value-free so
  they aggregate in the summary.
- **All HTTP goes through `fetch()`**. It caches every body in
  `scraper/cache/`, enforces 1 request / 2 s globally, honours robots.txt
  (raises `RobotsDisallowed`) and raises `HTTPStatusError` on status >= 400.
  `MEDINDEX_OFFLINE=1` (or `scrape.py --offline`) makes cache misses raise
  `OfflineCacheMiss`. Use `fetch(url, binary=True)` for bytes.
- Use `normalize_rank`, `normalize_specialty` and `parse_price_ron`. When any
  of them returns `None`, drop the record with a `_drop_reason`.
- `parse_price_ron` needs `lei`/`RON` next to the figure; pass
  `require_currency=False` only when the page structure itself guarantees RON.
- `acceptsCNAS` is `True` only when the source explicitly says the doctor or
  clinic works with CNAS (casa de asigurari). Otherwise `False`.
- `lat`/`lng` must be the clinic's own coordinates from the source (e.g. a map
  embed or structured data). Do not use `BUCHAREST_AREAS` centres as clinic
  coordinates. `area` may be set with `nearest_area(lat, lng)`.
- Keys starting with `_` are stripped before validation; any other unknown key
  makes the record invalid.

## Record schema

`id` and `scrapedAt` may be omitted (`scrape.py` assigns sequential ids and
sets `scrapedAt` to today if it's missing).

| field | type | notes |
|---|---|---|
| id | int | assigned by scrape.py |
| name | str | as published, e.g. `"Dr. Ion Popescu"` |
| image | str \| None | `https://` photo URL or `None` |
| hospital | str | one of `HOSPITALS` |
| specialty | str | English, from `normalize_specialty` |
| medicalRank | str | one of `RANKS`, from `normalize_rank` |
| priceRON | int | exact published figure, > 0 (no bools, no ranges) |
| priceService | str | service the price is for, as published |
| priceSourceUrl | str | `https://` page where that price is published |
| scrapedAt | str | `YYYY-MM-DD` |
| clinicName | str | clinic / location name |
| address | str | street address as published |
| area | str | Bucharest area |
| lat | float | within 44.3 to 44.6 |
| lng | float | within 25.9 to 26.3 |
| acceptsCNAS | bool | `True` only if explicitly stated |
| profileUrl | str | `https://` doctor profile; dedupe key with `hospital` |
| manual | bool (optional) | `True` only for seed records in `data/doctors.seed.js` |

All strings must be non-empty. `validate(record)` from `lib.schema` returns
the list of problems (empty == valid); call it in your adapter while
developing.
