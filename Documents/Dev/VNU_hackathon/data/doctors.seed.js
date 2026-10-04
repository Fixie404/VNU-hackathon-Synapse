// Hand-collected seed records for MedIndex.
// Holds ONLY real records copied by hand from the networks' public pages,
// each with its real profileUrl and priceSourceUrl, "manual": true, and the
// same schema as data/doctors.js (no "id"; scrape.py assigns ids).
// scrape.py uses these only for networks where scraping kept 0 records,
// or always with --include-seed. Never add invented or estimated values.
window.DOCTORS_SEED = [];
