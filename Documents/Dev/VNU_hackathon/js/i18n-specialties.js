/* MedIndex – specialty, rank and hospital labels (EN + RO).
   Keys: "spec.<English specialty>", "rank.<English rank>", "hospital.<name>" (hospital names unchanged).
   Registers into window.MedIndexI18n when present and always fills window.MedIndexStrings
   (a plain fallback store used by app.js / assistant/ui.js for a specific language).
   window.MedIndexSpecAliases: extra search words per specialty (both languages, any case/diacritics). */
(function () {
  "use strict";

  var GP = "General Practitioner / Family Doctor";

  // English specialty -> Romanian label.
  var SPEC_RO = {
    "Allergology": "Alergologie",
    "Cardiology": "Cardiologie",
    "Dentistry": "Stomatologie",
    "Dermatology": "Dermatologie",
    "Endocrinology": "Endocrinologie",
    "ENT (Otorhinolaryngology)": "ORL (Otorinolaringologie)",
    "Family Medicine": "Medicină de familie",
    "Gastroenterology": "Gastroenterologie",
    "General Surgery": "Chirurgie generală",
    "Hematology": "Hematologie",
    "Infectious Diseases": "Boli infecțioase",
    "Internal Medicine": "Medicină internă",
    "Nephrology": "Nefrologie",
    "Neurology": "Neurologie",
    "Neurosurgery": "Neurochirurgie",
    "Obstetrics & Gynecology": "Obstetrică-Ginecologie",
    "Oncology": "Oncologie",
    "Ophthalmology": "Oftalmologie",
    "Orthopedics": "Ortopedie",
    "Pediatric Orthopedics": "Ortopedie pediatrică",
    "Pediatrics": "Pediatrie",
    "Plastic Surgery": "Chirurgie plastică",
    "Psychiatry": "Psihiatrie",
    "Psychology": "Psihologie",
    "Pulmonology": "Pneumologie",
    "Rheumatology": "Reumatologie",
    "Sports Medicine": "Medicină sportivă",
    "Urology": "Urologie",
    "Vascular Surgery": "Chirurgie vasculară"
  };
  SPEC_RO[GP] = "Doctor de Familie";

  var RANK_RO = {
    "Specialist Physician": "Medic specialist",
    "Senior Consultant / Primary Physician": "Medic primar"
  };

  var HOSPITALS = ["Sanador", "MedLife", "Regina Maria", "Medicover"];

  var FAMILY_ALIASES = ["medic de familie", "doctor de familie", "medicul de familie", "medicina de familie",
    "family doctor", "family medicine", "family physician", "general practitioner", "gp", "medic generalist", "medicina generala"];

  var ALIASES = {
    "ENT (Otorhinolaryngology)": ["orl", "ent", "otorinolaringologie", "ear nose throat"],
    "Obstetrics & Gynecology": ["ginecologie", "ginecolog", "obstetrica", "gynecology", "gynaecology", "obgyn"],
    "Ophthalmology": ["oftalmolog", "ochi", "eye doctor"],
    "Pulmonology": ["pneumolog", "plamani"],
    "Dermatology": ["dermatolog", "dermatovenerologie"],
    "Pediatrics": ["pediatru", "pediatrician"],
    "Psychiatry": ["psihiatru", "psychiatrist"]
  };
  ALIASES[GP] = FAMILY_ALIASES;
  ALIASES["Family Medicine"] = FAMILY_ALIASES;

  var en = {}, ro = {};
  Object.keys(SPEC_RO).forEach(function (k) { en["spec." + k] = k; ro["spec." + k] = SPEC_RO[k]; });
  Object.keys(RANK_RO).forEach(function (k) { en["rank." + k] = k; ro["rank." + k] = RANK_RO[k]; });
  HOSPITALS.forEach(function (h) { en["hospital." + h] = h; ro["hospital." + h] = h; });

  var store = window.MedIndexStrings = window.MedIndexStrings || { en: {}, ro: {} };
  function merge(dst, src) { for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) dst[k] = src[k]; }
  merge(store.en = store.en || {}, en);
  merge(store.ro = store.ro || {}, ro);

  var aliases = window.MedIndexSpecAliases = window.MedIndexSpecAliases || {};
  Object.keys(ALIASES).forEach(function (k) { aliases[k] = (aliases[k] || []).concat(ALIASES[k]); });

  var I = window.MedIndexI18n;
  if (I && typeof I.register === "function") { I.register("en", en); I.register("ro", ro); }
})();
