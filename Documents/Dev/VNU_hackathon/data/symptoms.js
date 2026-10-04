/* MedIndex – symptom -> specialist-TYPE rules (classic script, works over file://).
 *
 * This file NEVER names a disease as a likely cause. Each rule only says which TYPE
 * of specialist usually handles a kind of complaint.
 *
 * Globals defined here (all plain data, read by assistant/engine.js):
 *
 *   window.SYMPTOM_RULES = [{ keywords:[ro+en phrases], specialty, weight:1-5,
 *                              redFlag:false, reason:{en,ro}, urgent?:{en,ro},
 *                              specificity:"strong"|"specific"|"moderate"|"general" }]
 *     - Keywords are written naturally (diacritics allowed); the engine normalizes them.
 *     - Each rule counts ONCE per message (its weight is added to its specialty once,
 *       however many of its keywords match). Several rules per specialty = several concepts.
 *     - `urgent` adds an urgency sentence to the reply; it never changes the specialty.
 *     - `specialty` may be a name that is not in the dataset (e.g. "Psychology");
 *       the engine remaps it through SPECIALTY_FALLBACKS.
 *
 *   window.RED_FLAG_RULES = [{ id, anyOf?:[phrases], allOf?:[[phrases],[phrases],...],
 *                              noneOf?:[phrases], reason:{en,ro} }]
 *     - Checked FIRST on every message. A rule fires when (any phrase of anyOf matches)
 *       OR (every allOf group has at least one matching phrase), AND no noneOf phrase matches.
 *     - allOf groups are concept-level (they do not need to be adjacent), e.g.
 *       chest pain + breathlessness anywhere in the message.
 *
 *   window.SPECIALTY_FALLBACKS = { "Wanted specialty": ["closest", "next", ...] }
 *     - Used when a specialty has no doctors in the current list. The engine walks the
 *       chain, then tries "Family Medicine", then "Internal Medicine".
 *
 *   window.CHILD_KEYWORDS / window.ADULT_KEYWORDS – words used to infer who it is for.
 */
(function () {
  "use strict";

  var REASONS = {
    "Dermatology": {
      en: "Skin, hair and nail problems are treated by a dermatologist.",
      ro: "Problemele de piele, păr și unghii sunt tratate de un medic dermatolog."
    },
    "Cardiology": {
      en: "Heart-related symptoms such as chest discomfort or palpitations are checked by a cardiologist.",
      ro: "Simptomele legate de inimă, cum ar fi disconfortul în piept sau palpitațiile, sunt verificate de un medic cardiolog."
    },
    "Neurology": {
      en: "Headaches, dizziness, numbness and other nerve symptoms are assessed by a neurologist.",
      ro: "Durerile de cap, amețelile, amorțelile și alte simptome nervoase sunt evaluate de un medic neurolog."
    },
    "Orthopedics": {
      en: "Problems with bones, joints, the back and injuries are treated by an orthopedist.",
      ro: "Problemele oaselor, articulațiilor, spatelui și accidentările sunt tratate de un medic ortoped."
    },
    "Rheumatology": {
      en: "Ongoing joint pain, stiffness or swelling is often assessed by a rheumatologist.",
      ro: "Durerile, rigiditatea sau umflarea articulațiilor care persistă sunt adesea evaluate de un medic reumatolog."
    },
    "Sports Medicine": {
      en: "Pain linked to sport or exercise can be assessed by a sports medicine doctor.",
      ro: "Durerile legate de sport sau efort pot fi evaluate de un medic de medicină sportivă."
    },
    "ENT (Otorhinolaryngology)": {
      en: "Ear, nose and throat problems are treated by an ENT specialist.",
      ro: "Problemele de ureche, nas și gât sunt tratate de un medic ORL."
    },
    "Ophthalmology": {
      en: "Eye and vision problems are treated by an ophthalmologist.",
      ro: "Problemele ochilor și ale vederii sunt tratate de un medic oftalmolog."
    },
    "Gastroenterology": {
      en: "Stomach, bowel and digestion problems are treated by a gastroenterologist.",
      ro: "Problemele de stomac, intestin și digestie sunt tratate de un medic gastroenterolog."
    },
    "General Surgery": {
      en: "Lumps, bulges and some belly or groin problems are examined by a general surgeon.",
      ro: "Umflăturile, proeminențele și unele probleme ale abdomenului sau zonei inghinale sunt examinate de un medic chirurg."
    },
    "Obstetrics & Gynecology": {
      en: "Women's health, periods and pregnancy are looked after by an obstetrician-gynecologist.",
      ro: "Sănătatea femeii, menstruația și sarcina sunt urmărite de un medic obstetrician-ginecolog."
    },
    "Urology": {
      en: "Urinary problems and male reproductive health are treated by a urologist.",
      ro: "Problemele urinare și cele ale aparatului genital masculin sunt tratate de un medic urolog."
    },
    "Endocrinology": {
      en: "Hormone, thyroid and blood sugar problems are treated by an endocrinologist.",
      ro: "Problemele hormonale, de tiroidă și de glicemie sunt tratate de un medic endocrinolog."
    },
    "Pulmonology": {
      en: "Breathing and lung symptoms, such as a lasting cough, are assessed by a pulmonologist.",
      ro: "Simptomele respiratorii, cum ar fi o tuse care persistă, sunt evaluate de un medic pneumolog."
    },
    "Psychiatry": {
      en: "Mood, anxiety and sleep difficulties can be discussed with a psychiatrist.",
      ro: "Problemele de dispoziție, anxietatea și tulburările de somn pot fi discutate cu un medic psihiatru."
    },
    "Psychology": {
      en: "Stress and emotional difficulties can be discussed with a psychologist.",
      ro: "Stresul și dificultățile emoționale pot fi discutate cu un psiholog."
    },
    "Pediatrics": {
      en: "Children's health problems are best seen first by a pediatrician.",
      ro: "Problemele de sănătate ale copiilor sunt văzute cel mai bine întâi de un medic pediatru."
    },
    "Pediatric Orthopedics": {
      en: "Bone and joint problems in children are treated by a pediatric orthopedist.",
      ro: "Problemele oaselor și articulațiilor la copii sunt tratate de un medic ortoped pediatru."
    },
    "Family Medicine": {
      en: "A family doctor is a good first step for general symptoms and can refer you to a specialist.",
      ro: "Medicul de familie este un prim pas bun pentru simptome generale și vă poate trimite la un specialist."
    },
    "Internal Medicine": {
      en: "General, whole-body symptoms are assessed by an internal medicine doctor.",
      ro: "Simptomele generale, ale întregului organism, sunt evaluate de un medic internist."
    },
    "Allergology": {
      en: "Reactions to things like pollen, food or medicines are examined by an allergist.",
      ro: "Reacțiile la polen, alimente sau medicamente sunt examinate de un medic alergolog."
    },
    "Nephrology": {
      en: "Kidney-related concerns are assessed by a nephrologist.",
      ro: "Problemele legate de rinichi sunt evaluate de un medic nefrolog."
    },
    "Dentistry": {
      en: "Tooth and gum problems are treated by a dentist.",
      ro: "Problemele dinților și gingiilor sunt tratate de un medic dentist."
    }
  };

  var CHEST_URGENT = {
    en: "Chest pain should be checked soon. If it is strong, spreads to the arm or jaw, or comes with breathlessness or sweating, call 112.",
    ro: "Durerea în piept trebuie verificată curând. Dacă este puternică, iradiază în braț sau maxilar ori apare cu lipsă de aer sau transpirații, sunați la 112."
  };
  var BLOOD_URGENT = {
    en: "Blood where it should not be is worth getting checked soon.",
    ro: "Sângele apărut acolo unde nu ar trebui merită verificat curând."
  };

  function R(specialty, weight, keywords, urgent) {
    var rule = {
      keywords: keywords,
      specialty: specialty,
      weight: weight,
      redFlag: false,
      reason: REASONS[specialty]
    };
    if (urgent) rule.urgent = urgent;
    return rule;
  }

  window.SYMPTOM_RULES = [
    // ---- Dermatology ------------------------------------------------------
    R("Dermatology", 4, ["erupții", "erupție", "eruptii", "iritație pe piele", "bube", "coșuri", "acnee", "pete roșii",
      "pete pe piele", "urticarie", "eczemă", "psoriazis", "rash", "rashes", "hives", "red spots", "acne", "eczema", "psoriasis"]),
    R("Dermatology", 3, ["mâncărime", "mâncărimi", "mă mănâncă", "îl mănâncă", "o mănâncă", "mă mănâncă pielea", "mănâncărime",
      "itching", "itchy", "itch", "itches"]),
    R("Dermatology", 2, ["piele", "pielea", "pielii", "skin", "unghii", "unghie", "unghia", "nails", "cade părul", "căderea părului",
      "păr căzut", "hair loss", "losing hair"]),
    R("Dermatology", 3, ["aluniță", "alunițe", "alunita", "mole", "moles", "negi", "neg", "wart", "warts"]),
    R("Dermatology", 3, ["se descuamează", "descuamează", "descuamare", "se cojește", "se jupoaie", "piele uscată", "pielea uscată",
      "flaky skin", "peeling skin", "skin peeling", "scaly skin", "dry skin", "flaking"]),
    R("Dermatology", 4, ["problemă de piele", "probleme de piele", "probleme cu pielea", "skin problem", "skin problems", "skin issue"]),

    // ---- Cardiology -------------------------------------------------------
    R("Cardiology", 5, ["durere în piept", "dureri în piept", "durere de piept", "mă doare pieptul", "doare pieptul", "dor pieptul",
      "durere toracică", "pieptul mă doare", "mă doare în piept", "apăsare în piept", "strângere în piept", "chest pain", "chest pains", "chest hurts", "pain in my chest",
      "pain in chest", "chest pressure", "chest tightness", "tight chest"], CHEST_URGENT),
    R("Cardiology", 4, ["palpitații", "palpitatii", "palpitatie", "inima bate repede", "inima îmi bate repede", "bătăi neregulate",
      "bătăi rapide", "inima o ia razna", "palpitations", "heart racing", "racing heart", "irregular heartbeat", "skipped beats",
      "heart pounding"]),
    R("Cardiology", 3, ["tensiune mare", "tensiunea mare", "tensiune arterială", "tensiunea arterială", "hipertensiune",
      "high blood pressure", "blood pressure"]),
    R("Cardiology", 2, ["urc scările", "urc scarile", "urcat scările", "urcatul scărilor", "urcând scările", "climbing stairs",
      "climb stairs", "up the stairs", "walking upstairs", "going upstairs"]),
    R("Cardiology", 2, ["picioare umflate", "glezne umflate", "swollen ankles", "swollen legs", "inimă", "inima"]),

    // ---- Neurology --------------------------------------------------------
    R("Neurology", 3, ["capul mă doare", "mă doare capul", "doare capul", "dor capul", "durere de cap", "dureri de cap", "durerea de cap", "cefalee",
      "migrenă", "migrene", "headache", "headaches", "head hurts", "migraine", "migraines"]),
    R("Neurology", 2, ["amețeli", "amețeală", "amețit", "amețită", "amețesc", "vertij", "dizzy", "dizziness", "vertigo", "lightheaded",
      "light headed"]),
    R("Neurology", 3, ["amorțeală", "amorțeli", "amorțit", "amorțită", "furnicături", "furnicături în", "numbness", "numb", "tingling",
      "pins and needles"]),
    R("Neurology", 2, ["tremur", "tremurături", "tremor", "tremors", "shaky hands", "probleme de memorie", "uit des", "uit lucruri",
      "memory problems", "forgetful"]),

    // ---- Orthopedics / Rheumatology / Sports Medicine ---------------------
    R("Orthopedics", 4, ["genunchi", "genunchiul", "genunchii", "genunchiului", "knee", "knees"]),
    R("Orthopedics", 3, ["umăr", "umărul", "umeri", "gleznă", "glezna", "șold", "șoldul", "încheietura mâinii", "cot", "cotul",
      "shoulder", "shoulders", "ankle", "ankles", "hip", "hips", "wrist", "elbow"]),
    R("Orthopedics", 3, ["durere de spate", "dureri de spate", "mă doare spatele", "spatele mă doare", "doare spatele", "dor spatele", "durere lombară",
      "coloana", "coloană", "ceafă", "ceafa", "back pain", "backache", "lower back", "back hurts", "neck pain", "stiff neck", "spine"]),
    R("Orthopedics", 4, ["fractură", "fracturi", "entorsă", "luxație", "mi-am rupt", "mi-am sucit", "sucit", "broken bone",
      "fracture", "sprain", "sprained", "twisted ankle", "twisted my"]),
    R("Orthopedics", 2, ["se umflă", "s-a umflat", "umflat", "umflată", "umflare", "swollen", "swelling", "swells", "puffy"]),
    R("Orthopedics", 2, ["articulații", "articulație", "încheieturi", "joints", "joint"]),
    R("Rheumatology", 3, ["articulații umflate", "dureri articulare", "durere articulară", "dureri de articulații",
      "durere în articulații", "dureri în articulații", "rigiditate", "înțepenit dimineața", "joint pain", "joint pains",
      "swollen joints", "stiff joints", "morning stiffness"]),
    R("Rheumatology", 1, ["genunchi", "genunchii", "knee", "knees", "spate", "spatele", "back pain"]),
    R("Sports Medicine", 2, ["când alerg", "cand alerg", "la alergare", "alergare", "alergat", "la sală", "antrenament",
      "fac sport", "sport", "fotbal", "running", "when i run", "jogging", "workout", "gym", "exercise", "football", "training"]),

    // ---- ENT --------------------------------------------------------------
    R("ENT (Otorhinolaryngology)", 4, ["durere în gât", "dureri în gât", "durere de gât", "dureri de gât", "mă doare gâtul", "gâtul mă doare",
      "doare gâtul", "gât iritat", "gâtul iritat", "amigdale", "înghit greu", "sore throat", "throat pain", "throat hurts",
      "tonsils", "difficulty swallowing"]),
    R("ENT (Otorhinolaryngology)", 4, ["ureche", "urechea", "urechi", "urechile", "durere de ureche", "aud greu", "nu aud",
      "țiuit în urechi", "țiuie", "ear", "ears", "earache", "ear pain", "hearing", "tinnitus", "ringing in my ears"]),
    R("ENT (Otorhinolaryngology)", 3, ["nas înfundat", "nasul înfundat", "nasul", "nas", "sinusuri", "curge nasul", "sângerez din nas",
      "sforăi", "sforăit", "stuffy nose", "blocked nose", "runny nose", "nose", "sinus", "sinuses", "nosebleed", "snoring"]),
    R("ENT (Otorhinolaryngology)", 3, ["ureche înfundată", "urechea înfundată", "mă înțeapă urechea", "secreții din ureche",
      "blocked ear", "ear blocked", "ear discharge", "plugged ear"]),
    R("ENT (Otorhinolaryngology)", 2, ["răgușit", "răgușită", "răgușeală", "voce răgușită", "mi-a pierit vocea", "hoarse",
      "hoarseness", "lost my voice"]),
    R("ENT (Otorhinolaryngology)", 1, ["amețeli", "amețeală", "dizzy", "dizziness", "vertigo"]),

    // ---- Pulmonology ------------------------------------------------------
    R("Pulmonology", 3, ["tuse", "tusea", "tușesc", "tușește", "tușit", "cough", "coughing", "coughs"]),
    R("Pulmonology", 3, ["respir șuierat", "șuierat", "rămân fără aer la efort", "astm", "wheezing", "wheeze", "asthma",
      "out of breath when", "breathless when"]),
    R("Pulmonology", 2, ["fumez", "fumător", "fumătoare", "plămâni", "plămânii", "smoker", "smoking", "lungs", "lung"]),

    // ---- Gastroenterology / General Surgery -------------------------------
    R("Gastroenterology", 4, ["durere de burtă", "dureri de burtă", "doare burta", "mă doare burta", "burta mă doare", "durere de stomac",
      "dureri de stomac", "doare stomacul", "durere abdominală", "dureri abdominale", "burta", "stomac", "stomacul",
      "stomach ache", "stomachache", "stomach pain", "abdominal pain", "belly pain", "tummy ache", "stomach", "tummy", "belly"]),
    R("Gastroenterology", 3, ["arsuri gastrice", "arsuri la stomac", "reflux", "balonare", "balonat", "balonată", "acid reflux",
      "heartburn", "bloating", "bloated", "indigestie", "indigestion"]),
    R("Gastroenterology", 3, ["greață", "greturi", "grețuri", "vărsături", "vomit", "vomită", "vomit", "nausea", "vomiting",
      "throwing up"]),
    R("Gastroenterology", 3, ["diaree", "constipație", "constipat", "constipată", "diarrhea", "diarrhoea",
      "constipation", "constipated"]),
    R("Gastroenterology", 2, ["gaze", "flatulență", "sughiț", "mă satur repede", "digestie grea", "gas", "wind",
      "hiccups", "full quickly", "slow digestion"]),
    R("Gastroenterology", 3, ["sânge în scaun", "scaun cu sânge", "blood in stool", "blood in my stool"], BLOOD_URGENT),
    R("General Surgery", 3, ["hernie", "hernia", "umflătură", "nodul", "cucui", "lump", "bump", "lumps"]),

    // ---- Obstetrics & Gynecology ------------------------------------------
    R("Obstetrics & Gynecology", 5, ["sarcină", "sarcina", "sarcinii", "însărcinată", "gravidă", "test de sarcină",
      "pregnant", "pregnancy", "pregnancy test"]),
    R("Obstetrics & Gynecology", 4, ["menstruație", "menstruația", "menstruații", "menstruatie", "menstrual", "menstruale",
      "ciclu", "ciclul", "ciclul menstrual", "îmi întârzie ciclul", "my period", "my periods", "period pain", "period cramps",
      "late period", "missed period", "heavy periods", "irregular periods", "pms"]),
    R("Obstetrics & Gynecology", 4, ["ginecolog", "ginecologic", "ginecologie", "control ginecologic", "secreții vaginale",
      "vaginal", "menopauză", "contracepție", "anticoncepționale", "gynecologist", "gynaecologist", "gynecology",
      "gynecological", "menopause", "contraception", "birth control", "women s health", "womens health"]),
    R("Obstetrics & Gynecology", 3, ["sân", "sânul", "sâni", "sânii", "nodul la sân", "breast", "breasts", "breast lump"]),

    // ---- Urology / Nephrology (remapped) ----------------------------------
    R("Urology", 4, ["urinez des", "urinez", "urinare", "urinat", "usturime la urinare", "durere la urinare", "urină", "urina",
      "sânge în urină", "prostată", "prostata", "testicul", "testicule", "pee", "peeing", "urinating", "urination", "urine",
      "burning when i pee", "prostate", "testicle", "testicles"]),
    R("Urology", 4, ["usturime la urinare", "durere la urinare", "ustură când urinez", "mă ustură când urinez", "sânge în urină",
      "burning when i pee", "burning when peeing", "burning urine", "painful urination", "pain when i pee", "blood in urine",
      "blood in my urine"]),
    R("Urology", 4, ["piatră la rinichi", "pietre la rinichi", "calculi", "kidney stone", "kidney stones"]),
    R("Urology", 3, ["usturime", "urinez noaptea", "mă trezesc să urinez", "nu pot urina", "jet slab", "burning urine",
      "frequent urination", "pee often", "pee a lot", "weak stream", "cant pee"]),
    R("Nephrology", 3, ["rinichi", "rinichii", "kidney", "kidneys"]),

    // ---- Endocrinology ----------------------------------------------------
    R("Endocrinology", 4, ["tiroidă", "tiroida", "tiroidei", "glicemie", "glicemia", "zahăr mare", "diabet", "hormoni",
      "hormonal", "hormonală", "thyroid", "blood sugar", "diabetes", "hormones", "hormone"]),
    R("Endocrinology", 2, ["sete mare", "mi-e sete tot timpul", "beau multă apă", "m-am îngrășat", "îngrășat", "very thirsty",
      "always thirsty", "weight gain", "gained weight"]),

    R("Endocrinology", 3, ["transpir excesiv", "transpir foarte mult", "intoleranță la căldură", "mi-e mereu frig",
      "excessive sweating", "sweating a lot", "heat intolerance", "always cold", "cold intolerance"]),

    // ---- Ophthalmology ----------------------------------------------------
    R("Ophthalmology", 4, ["ochi", "ochii", "ochiul", "ochiului", "vedere", "văd încețoșat", "văd neclar", "văd dublu",
      "vedere încețoșată", "ochi roșii", "ochelari", "eye", "eyes", "vision", "blurry vision", "blurred vision", "red eye",
      "glasses", "double vision"]),

    R("Ophthalmology", 4, ["vedere încețoșată", "văd încețoșat", "văd neclar", "văd dublu", "vedere dublă", "vedere neclară",
      "blurry vision", "blurred vision", "double vision", "vision is blurry", "vision is blurred"]),
    R("Ophthalmology", 3, ["mă ustură ochii", "ochi uscați", "lăcrimez", "durere de ochi", "mă dor ochii", "văd pete",
      "dry eyes", "watery eyes", "itchy eyes", "eye pain", "sore eyes", "floaters"]),

    // ---- Psychiatry / Psychology (Psychology is remapped) -----------------
    R("Psychiatry", 4, ["anxietate", "anxietatea", "anxios", "anxioasă", "panică", "atac de panică", "atacuri de panică",
      "neliniște", "depresie", "deprimat", "deprimată", "trist", "tristă", "tristețe", "anxiety", "anxious", "panic",
      "panic attack", "panic attacks", "depressed", "depression", "low mood", "sad all the time"]),
    R("Psychiatry", 3, ["insomnie", "nu pot dormi", "nu pot să dorm", "nu dorm", "dorm prost", "dorm greu", "mă trezesc noaptea",
      "probleme cu somnul", "insomnia", "cant sleep", "cannot sleep", "trouble sleeping", "sleep problems", "can not sleep"]),
    R("Psychology", 2, ["stres", "stresat", "stresată", "epuizat psihic", "stress", "stressed", "burnout", "burned out"]),

    // ---- General: Family / Internal Medicine ------------------------------
    R("Family Medicine", 3, ["febră", "febra", "febril", "temperatură", "temperatura mare", "frisoane", "răceală", "răcit",
      "răcită", "gripă", "gripa", "fever", "high temperature", "temperature", "chills", "a cold", "flu"]),
    R("Internal Medicine", 2, ["febră", "febra", "temperatură", "frisoane", "fever", "high temperature", "chills"]),
    R("Family Medicine", 2, ["tuse", "tusea", "tușesc", "cough", "coughing", "durere în gât", "sore throat"]),
    R("Family Medicine", 2, ["oboseală", "obosit", "obosită", "fără energie", "slăbiciune", "sleit", "tired", "fatigue",
      "exhausted", "no energy", "weakness"]),
    R("Internal Medicine", 2, ["oboseală", "obosit", "obosită", "slăbiciune", "fatigue", "tired", "exhausted", "weakness",
      "am slăbit fără motiv", "pierdut în greutate", "weight loss", "losing weight"]),
    R("Family Medicine", 2, ["control", "analize", "analize de sânge", "check up", "checkup", "blood tests", "blood test",
      "trimitere", "referral", "vaccin", "vaccine", "vaccination"]),
    R("Family Medicine", 1, ["durere de cap", "dureri de cap", "doare capul", "headache", "amețeli", "dizzy", "dizziness"]),
    R("Family Medicine", 1, ["insomnie", "anxietate", "stres", "insomnia", "anxiety", "stress"]),

    // ---- Remapped specialties not usually in the list ---------------------
    R("Allergology", 3, ["alergie", "alergii", "alergic", "alergică", "allergy", "allergies", "allergic", "hay fever"]),
    R("Dentistry", 4, ["dinte", "dinți", "dintele", "măsea", "măseaua", "gingii", "gingie", "durere de dinți", "tooth",
      "teeth", "toothache", "gums", "gum"])
  ];

  // Red flags: checked FIRST, before any scoring. Combination rules use allOf groups.
  var BREATH_STRONG = ["nu pot respira", "nu mai pot respira", "nu pot să respir", "greu respir", "respir greu",
    "respir cu greutate", "mă sufoc", "sufoc", "se sufocă", "nu am aer", "nu primesc aer", "cant breathe", "cannot breathe",
    "can not breathe", "unable to breathe", "struggling to breathe", "hard to breathe", "difficulty breathing",
    "trouble breathing", "choking", "suffocating", "short of breath", "shortness of breath", "barely breathe",
    "hardly breathe", "hard time breathing", "breathing difficulty", "breathing difficulties", "abia respir",
    "abia pot respira", "abia mai respir", "nu mai respiră", "not breathing", "stopped breathing", "isnt breathing",
    "throat is closing", "throat closing", "throat closed", "throat is closed", "se închide gâtul", "mi se închide gâtul",
    "gâtul se închide"];
  var BREATH_ANY = BREATH_STRONG.concat(["lipsă de aer", "lipsa de aer", "fără aer", "dificultăți de respirație",
    "respirație grea", "gâfâi", "short of breath", "shortness of breath", "breathless", "out of breath"]);
  var CHEST = ["durere în piept", "dureri în piept", "durere de piept", "doare pieptul", "dor pieptul", "apăsare în piept",
    "strângere în piept", "durere toracică", "chest pain", "chest pains", "chest hurts", "pain in my chest", "pain in chest",
    "chest pressure", "chest tightness", "tight chest"];
  var HEADACHE = ["durere de cap", "dureri de cap", "doare capul", "dor capul", "headache", "head hurts", "head pain"];
  var SUDDEN = ["brusc", "bruscă", "dintr-o dată", "dintr-odată", "subit", "sudden", "suddenly", "out of nowhere"];
  var SEVERE = ["puternic", "puternică", "foarte tare", "insuportabil", "insuportabilă", "cumplit", "cumplită", "groaznic",
    "groaznică", "teribil", "explodează", "severe", "worst", "unbearable", "excruciating", "terrible", "extreme"];

  // Overdose amounts: words plus any number of 5 or more pills.
  var OD_AMOUNT = ["toate", "all", "prea multe", "prea multă", "too many", "too much", "whole bottle", "entire bottle",
    "whole box", "toată cutia", "o cutie întreagă", "un pumn", "a handful", "handful", "zeci", "dozens", "bunch"];
  for (var odn = 5; odn <= 300; odn++) OD_AMOUNT.push(String(odn));
  var INFANT = ["bebeluș", "bebelușul", "bebelușii", "bebe", "bebi", "baby", "babys", "infant", "newborn", "nou-născut",
    "nou-născutul", "sugarul"];

  window.RED_FLAG_RULES = [
    { id: "chest-breath", allOf: [CHEST, BREATH_ANY], reason: {
      en: "Chest pain together with difficulty breathing needs emergency care.",
      ro: "Durerea în piept împreună cu dificultatea de a respira necesită îngrijire de urgență." } },
    { id: "breathing", anyOf: BREATH_STRONG, reason: {
      en: "Difficulty breathing needs emergency care.",
      ro: "Dificultatea de a respira necesită îngrijire de urgență." } },
    { id: "stroke", anyOf: ["gura strâmbă", "gura strâmbată", "fața căzută", "fata cazuta", "fața strâmbă", "vorbesc greu",
      "vorbește greu", "vorbire neclară", "vorbește neclar", "nu pot vorbi", "nu mai poate vorbi", "amorțeală pe o parte",
      "amorțit pe o parte", "slăbiciune pe o parte", "paralizat", "paralizată", "jumătate de corp", "jumătate din corp",
      "face drooping", "face droop", "drooping face", "face is drooping", "slurred speech", "slurring", "cant speak",
      "cannot speak", "weakness on one side", "numbness on one side", "numb on one side", "one side of my body",
      "one side of my face", "one sided weakness", "paralysed", "paralyzed", "slurred", "speech is slurred", "nu pot mișca brațul",
      "nu pot mișca mâna", "nu pot mișca piciorul", "nu mai pot mișca", "cant move arm", "cannot move arm", "cant move leg",
      "cannot move leg", "unable to move arm", "cant feel arm", "cant lift arm", "nu pot ridica brațul"], reason: {
      en: "Face drooping, slurred speech or sudden weakness on one side can be signs of an emergency.",
      ro: "Gura strâmbă, vorbirea greoaie sau slăbiciunea bruscă pe o parte a corpului pot fi semne de urgență." } },
    { id: "stroke-sudden", allOf: [SUDDEN, ["slăbiciune", "amorțeală", "amorțit", "weakness", "numbness", "numb", "confuz",
      "confuză", "confused", "nu văd", "cant see"]], noneOf: ["cand alerg", "la sala"], reason: {
      en: "Sudden weakness, numbness, confusion or loss of vision needs emergency care.",
      ro: "Slăbiciunea, amorțeala, confuzia sau pierderea vederii apărute brusc necesită îngrijire de urgență." } },
    { id: "thunderclap-headache", anyOf: ["cea mai puternică durere de cap", "cea mai rea durere de cap",
      "cea mai mare durere de cap", "worst headache", "thunderclap"], reason: {
      en: "A sudden, very severe headache needs emergency care.",
      ro: "O durere de cap bruscă și foarte puternică necesită îngrijire de urgență." } },
    { id: "sudden-severe-headache", allOf: [SUDDEN, HEADACHE, SEVERE], reason: {
      en: "A sudden, very severe headache needs emergency care.",
      ro: "O durere de cap bruscă și foarte puternică necesită îngrijire de urgență." } },
    { id: "unconscious", anyOf: ["leșin", "leșinat", "am leșinat", "a leșinat", "leșinul", "mi-am pierdut cunoștința",
      "și-a pierdut cunoștința", "pierdut cunoștința", "inconștient", "inconștientă", "fainted", "fainting",
      "passed out", "lost consciousness", "unconscious", "blacked out"], reason: {
      en: "Fainting or losing consciousness needs urgent medical attention.",
      ro: "Leșinul sau pierderea cunoștinței necesită atenție medicală urgentă." } },
    { id: "bleeding", anyOf: ["sângerare abundentă", "sângerare puternică", "sângerare masivă", "sângerez abundent",
      "sângerez mult", "sângerează mult", "sângerează abundent", "nu se oprește sângerarea", "nu se opreste sangele",
      "heavy bleeding", "bleeding heavily", "bleeding a lot", "wont stop bleeding", "bleeding wont stop", "severe bleeding"],
      reason: {
      en: "Heavy bleeding needs emergency care.",
      ro: "Sângerarea abundentă necesită îngrijire de urgență." } },
    { id: "anaphylaxis", allOf: [["umflat", "umflată", "umflate", "umflați", "umflare", "umflătură", "s-a umflat", "swollen",
      "swelling", "swell"], ["gât", "gâtul", "buze", "buzele", "limba", "limbă", "throat", "lips", "lip", "tongue"]],
      noneOf: ["ganglion", "ganglioni", "glands", "gland", "amigdale", "amigdalele", "tonsils"], reason: {
      en: "Sudden swelling of the face, lips, tongue or throat needs emergency care.",
      ro: "Umflarea bruscă a feței, buzelor, limbii sau gâtului necesită îngrijire de urgență." } },
    { id: "anaphylaxis-named", anyOf: ["fața umflată", "umflat la față", "umflată la față", "umflat fața", "umflată fața", "swollen face", "face is swollen", "face swelling", "face swollen", "șoc anafilactic", "anafilaxie", "anaphylaxis", "anaphylactic"], reason: {
      en: "Swelling of the face or throat, or a severe reaction, needs emergency care.",
      ro: "Umflarea feței sau a gâtului ori o reacție severă necesită îngrijire de urgență." } },
    { id: "seizure", anyOf: ["convulsii", "convulsie", "convulsionează", "criză de epilepsie", "criză epileptică", "seizure",
      "seizures", "convulsions", "convulsing", "having a fit"], reason: {
      en: "A seizure needs emergency care.",
      ro: "O criză convulsivă necesită îngrijire de urgență." } },
    { id: "seizure-crisis", anyOf: ["criză", "crize", "a făcut o criză"], noneOf: ["anxietate", "panică", "panica", "anxiety",
      "panic", "plâns", "nervi", "furie", "isterie", "fiere", "tuse", "astm", "timp", "financiară", "criza de timp"], reason: {
      en: "A seizure or sudden attack needs emergency care.",
      ro: "O criză (convulsii) necesită îngrijire de urgență." } },
    { id: "head-injury", anyOf: ["traumatism cranian", "lovitură puternică la cap", "severe head injury", "serious head injury"],
      reason: {
      en: "A serious head injury needs emergency care.",
      ro: "O lovitură serioasă la cap necesită îngrijire de urgență." } },
    { id: "head-injury-signs", allOf: [["lovit la cap", "lovit în cap", "lovitură la cap", "căzut în cap", "a căzut pe cap",
      "head injury", "hit my head", "hit his head", "hit her head", "hit their head", "banged my head", "banged his head",
      "banged her head", "fell on my head", "fell on his head", "fell on her head"], ["vărsături", "vomită", "vomit", "vomiting",
      "confuz", "confuză", "confused", "somnolent", "somnoros", "drowsy", "sângerează", "sânge", "bleeding", "blood", "leșin",
      "fainted", "puternic", "tare", "grav", "badly", "hard", "severe", "serious", "nu se trezește", "wont wake"]], reason: {
      en: "A head injury with these signs needs emergency care.",
      ro: "O lovitură la cap cu aceste semne necesită îngrijire de urgență." } },
    { id: "self-harm", anyOf: ["vreau să mă omor", "să mă omor", "mă omor", "mă sinucid", "sinucid", "sinucidere", "sinucigaș",
      "vreau să mor", "nu mai vreau să trăiesc", "îmi fac rău", "să-mi fac rău", "kill myself", "killing myself",
      "suicide", "suicidal", "self harm", "self-harm", "hurt myself", "hurting myself", "end my life", "want to die",
      "dont want to live", "end it all", "nu vreau să mai trăiesc", "nu vreau sa mai traiesc",
      "nu mai are rost să trăiesc", "nu mai are rost", "vreau să dispar", "dont want to be alive", "not want to be alive",
      "nu vreau să mai fiu în viață", "better off dead", "mai bine mort", "tăiat venele", "tai venele", "tăia venele",
      "cut wrists", "cut my wrists", "slit wrists", "slit my wrists", "cut myself", "cutting myself", "mă tai",
      "mă arunc de pe", "să mă arunc", "mă arunc în fața", "sar de pe bloc", "jump off bridge", "jump off roof",
      "jump off building", "jump off balcony", "want to jump off", "jump in front of", "throw myself", "mă spânzur",
      "hang myself", "take my life", "take my own life", "disappear forever", "want to disappear",
      "no reason to live", "nothing to live for", "worth living", "nu mai suport să trăiesc", "nu mai suport viața",
      "nu mai vreau să exist", "nu vreau să mai exist", "dont want to exist"], reason: {
      en: "You deserve support right now. Please call 112 or go to the nearest emergency department, and reach out to someone you trust.",
      ro: "Meritați sprijin chiar acum. Vă rugăm sunați la 112 sau mergeți la cea mai apropiată unitate de urgență și vorbiți cu cineva în care aveți încredere." } },
    { id: "poisoning", anyOf: ["otrăvit", "otrăvită", "otrăvire", "otravă", "supradoză", "înghițit clor", "înghițit înălbitor",
      "băut clor", "poisoned", "poisoning", "poison", "overdose", "overdosed", "swallowed bleach", "drank bleach"],
      noneOf: ["alimentară", "alimentara", "food"], reason: {
      en: "Suspected poisoning needs emergency care. Call 112 now.",
      ro: "Suspiciunea de otrăvire necesită îngrijire de urgență. Sunați acum la 112." } },
    { id: "poisoning-intox", anyOf: ["intoxicat", "intoxicată", "intoxicație", "intoxicare"],
      noneOf: ["alimentară", "alimentara", "mâncare", "food"], reason: {
      en: "Suspected poisoning needs emergency care. Call 112 now.",
      ro: "Suspiciunea de intoxicație necesită îngrijire de urgență. Sunați acum la 112." } },
    { id: "poisoning-swallowed", allOf: [["înghițit", "a înghițit", "am înghițit", "băut", "swallowed", "drank", "ate"],
      ["clor", "înălbitor", "detergent", "pastile", "medicamente", "baterie", "soluție", "otravă", "bleach", "pills",
      "tablets", "chemical", "chemicals", "battery", "detergent", "cleaning"]], reason: {
      en: "Swallowing something harmful needs emergency care. Call 112 now.",
      ro: "Înghițirea unei substanțe periculoase necesită îngrijire de urgență. Sunați acum la 112." } },
    { id: "overdose", allOf: [["luat", "am luat", "a luat", "took", "taken", "swallowed", "înghițit", "inghitit", "băut"],
      OD_AMOUNT, ["pastile", "pastilele", "pills", "tablets", "comprimate", "medicamente", "medicamentele", "capsule",
      "capsules", "meds", "medication", "medicine"]], reason: {
      en: "Taking too many pills or medicines needs emergency help now. Call 112.",
      ro: "Luarea prea multor pastile sau medicamente necesită ajutor de urgență acum. Sunați la 112." } },
    { id: "emergency-named", anyOf: ["heart attack", "heart atack", "heart atac", "infarct", "atac de cord", "atac cardiac",
      "stop cardiac", "cardiac arrest", "stroke", "avc", "accident vascular"], noneOf: ["risk factors", "factori de risc",
      "what is a stroke", "what is a heart attack", "ce este avc", "ce este un infarct", "ce este un atac", "how to prevent",
      "cum previn", "prevenire", "prevention"], reason: {
      en: "What you describe can be an emergency. Call 112 now.",
      ro: "Ce descrieți poate fi o urgență. Sunați acum la 112." } },
    { id: "bleeding-nonstop", allOf: [["sângerează", "sângerez", "sângerare", "sângerarea", "sânge", "bleeding", "bleed",
      "bleeds", "nosebleed", "blood"], ["nu se oprește", "nu se mai oprește", "wont stop", "doesnt stop", "not stopping",
      "will not stop", "cant stop", "cannot stop"]], reason: {
      en: "Bleeding that will not stop needs emergency help now.",
      ro: "O sângerare care nu se oprește necesită ajutor de urgență acum." } },
    { id: "bleeding-everywhere", anyOf: ["blood everywhere", "sânge peste tot", "lots of blood", "mult sânge",
      "pierd mult sânge", "losing a lot of blood"], reason: {
      en: "Heavy bleeding needs emergency help now.",
      ro: "Sângerarea abundentă necesită ajutor de urgență acum." } },
    { id: "infant-danger", allOf: [INFANT, ["nu respiră", "nu mai respiră", "not breathing", "isnt breathing",
      "stopped breathing", "limp", "e moale", "este moale", "foarte moale", "nu reacționează", "nu răspunde",
      "not responding", "unresponsive", "nu se trezește", "wont wake", "will not wake", "cant wake", "se învinețește",
      "turning blue", "blue lips"]], reason: {
      en: "A baby with signs like these needs emergency help now. Call 112.",
      ro: "Un bebeluș cu astfel de semne are nevoie de ajutor de urgență acum. Sunați la 112." } },
    { id: "infant-high-fever", allOf: [INFANT, ["febră", "fever", "temperatură", "temperature", "grade", "degrees"],
      ["40", "41", "42", "104", "105", "106"]], reason: {
      en: "A baby with a temperature this high needs emergency help now. Call 112.",
      ro: "Un bebeluș cu o temperatură atât de mare are nevoie de ajutor de urgență acum. Sunați la 112." } },
    { id: "newborn-fever", allOf: [["nou-născut", "nou-născutul", "newborn"], ["febră", "fever", "febril", "feverish"]],
      reason: {
      en: "A newborn with a high temperature needs emergency help now. Call 112.",
      ro: "Un nou-născut cu temperatură mare are nevoie de ajutor de urgență acum. Sunați la 112." } },
    { id: "trauma", anyOf: ["car accident", "car crash", "accident de mașină", "accident rutier", "accident auto",
      "accident de motocicletă", "motorcycle accident", "hit by a car", "lovit de mașină", "stabbed", "înjunghiat",
      "înjunghiată", "been shot", "got shot", "gunshot", "împușcat", "împușcată", "bone sticking out",
      "bone is sticking out", "bone poking out", "os ieșit prin piele", "osul iese prin piele", "os iese prin piele",
      "osul a ieșit", "fractură deschisă", "open fracture", "compound fracture"], reason: {
      en: "A serious injury like this needs emergency help now. Call 112.",
      ro: "O rănire gravă ca aceasta necesită ajutor de urgență acum. Sunați la 112." } },
    { id: "severe-burn", anyOf: ["severe burn", "bad burn", "serious burn", "big burn", "third degree burn", "arsură gravă",
      "arsuri grave", "arsură mare", "arsuri mari", "arsură severă", "arsuri severe", "ars grav", "arsă grav",
      "badly burned", "badly burnt"], noneOf: ["stomac", "stomach", "esofag", "urinare", "urinez", "urinating", "urine",
      "pipi"], reason: {
      en: "A serious burn needs emergency help now. Call 112.",
      ro: "O arsură gravă necesită ajutor de urgență acum. Sunați la 112." } },
    { id: "overdose-drug", allOf: [OD_AMOUNT.concat(["bunch", "a lot", "lots", "multe", "pumn", "cutie", "cutia", "bottle",
      "box", "pachet", "folie"]), ["paracetamol", "ibuprofen", "algocalmin", "nurofen", "xanax", "diazepam", "aspirină",
      "aspirin", "antidepresive", "antidepressants", "somnifere", "sleeping pills", "tylenol", "advil", "panadol",
      "alprazolam", "lorazepam", "clonazepam", "tramadol", "codeină", "codeine", "insulină", "insulin", "fenobarbital"]],
      reason: {
      en: "Taking too many pills or medicines needs emergency help now. Call 112.",
      ro: "Luarea prea multor pastile sau medicamente necesită ajutor de urgență acum. Sunați la 112." } },
    { id: "blue-or-gasping", anyOf: ["lips turning blue", "lips are blue", "lips blue", "blue lips", "turning blue",
      "buzele vinete", "buze vinete", "buzele albastre", "s-a învinețit", "se învinețește", "gasping for air", "gasping",
      "gâfâie după aer", "asthma attack", "atac de astm", "criză de astm", "criza de astm", "no inhaler", "nu am inhalator",
      "inhaler not working", "inhalatorul nu ajută"], reason: {
      en: "Struggling for air or turning blue needs emergency help now. Call 112.",
      ro: "Lipsa de aer sau învinețirea necesită ajutor de urgență acum. Sunați la 112." } },
    { id: "wheeze-cant-talk", allOf: [["wheezing", "wheeze", "șuierat", "respir greu", "breathless"], ["cant talk",
      "cannot talk", "cant speak", "nu pot vorbi", "nu poate vorbi", "cant finish sentences"]], reason: {
      en: "Struggling to breathe or talk needs emergency help now. Call 112.",
      ro: "Dificultatea de a respira sau de a vorbi necesită ajutor de urgență acum. Sunați la 112." } },
    { id: "sting-throat", allOf: [["sting", "stung", "înțepătură", "înțepat", "înțepată", "bee", "wasp", "albină", "viespe",
      "peanut", "peanuts", "arahide", "alune"], ["throat tight", "throat feels tight", "tight throat", "gât strâns",
      "se strânge gâtul", "strâns în gât", "cant swallow", "nu pot înghiți", "hives all over", "greu respir", "respir greu",
      "dizzy", "amețit"]], reason: {
      en: "Throat tightness after a sting or a food needs emergency help now. Call 112.",
      ro: "Senzația de gât strâns după o înțepătură sau un aliment necesită ajutor de urgență acum. Sunați la 112." } },
    { id: "vision-face-sudden", anyOf: ["half my face", "half of my face", "jumătate de față", "jumătate din față",
      "face went numb", "face is numb", "face numb", "fața amorțită", "nu simt mâna", "nu simt brațul", "nu simt piciorul",
      "nu simt fața", "vorbește incoerent", "incoerent", "incoherent", "sudden blindness", "suddenly blind", "went blind",
      "am orbit", "orbit brusc", "lost my vision", "cant move legs", "cannot move legs", "nu pot mișca picioarele"],
      reason: {
      en: "Sudden numbness, loss of vision or trouble speaking needs emergency help now. Call 112.",
      ro: "Amorțeala, pierderea vederii sau vorbirea dificilă apărute brusc necesită ajutor de urgență acum. Sunați la 112." } },
    { id: "blood-vomit-cough", anyOf: ["vomit blood", "vomiting blood", "vomited blood", "throwing up blood", "threw up blood",
      "cough blood", "coughing blood", "coughing up blood", "vomitat sânge", "vomit cu sânge", "vărsături cu sânge",
      "vărs sânge", "tusesc sânge", "tuse cu sânge", "scuip sânge", "black tarry stool", "tarry stool", "black stool",
      "scaun negru", "scaune negre", "scaunul negru"], reason: {
      en: "Vomiting or coughing up blood, or black stools, needs emergency help now. Call 112.",
      ro: "Vărsăturile sau tusea cu sânge ori scaunul negru necesită ajutor de urgență acum. Sunați la 112." } },
    { id: "young-infant-fever", allOf: [INFANT, ["o lună", "1 lună", "2 luni", "două luni", "1 month", "one month",
      "2 month", "two month", "week old", "weeks old", "săptămâni de viață"], ["febră", "fever", "febril", "temperatură",
      "temperature", "38", "39"]], reason: {
      en: "A baby under 3 months with a raised temperature needs emergency help now. Call 112.",
      ro: "Un bebeluș sub 3 luni cu temperatură are nevoie de ajutor de urgență acum. Sunați la 112." } },
    { id: "child-unresponsive", allOf: [["copil", "copilul", "copilașul", "fiul", "fiica", "child", "kid", "son", "daughter",
      "toddler", "infant", "baby", "bebeluș", "bebelușul", "sugarul"], ["nu se trezește", "nu se mai trezește", "wont wake",
      "cant wake", "will not wake", "nu reacționează", "unresponsive", "not responding", "lethargic", "letargic",
      "floppy", "limp", "nu respiră", "not breathing"]], reason: {
      en: "A child with signs like these needs emergency help now. Call 112.",
      ro: "Un copil cu astfel de semne are nevoie de ajutor de urgență acum. Sunați la 112." } },
    { id: "unresponsive", anyOf: ["unresponsive", "not responsive", "nu reacționează"], reason: {
      en: "Someone who does not respond needs emergency help now. Call 112.",
      ro: "O persoană care nu reacționează are nevoie de ajutor de urgență acum. Sunați la 112." } },
    { id: "trauma-more", anyOf: ["motorcycle crash", "bike crash", "crashed my car", "car wreck", "căzut de la etaj",
      "căzut de la înălțime", "căzut de pe acoperiș", "căzut de pe bloc", "căzut de pe balcon", "fell from height",
      "fell from a height", "fell from the roof", "fell off the roof", "fell from a ladder", "fell off a ladder",
      "fell from the balcony", "fell off the balcony", "fell from the second floor", "tăietură adâncă", "rană adâncă",
      "deep cut", "deep wound", "amputated", "amputat", "amputată", "cut off my finger", "electrocuted", "electrocutat",
      "electrocutată", "electrocutare", "electric shock", "șoc electric", "electrocution", "near drowning", "was drowning", "almost drowned", "drowned",
      "s-a înecat", "înecat", "înecată", "aproape înecat"], reason: {
      en: "A serious injury or accident like this needs emergency help now. Call 112.",
      ro: "O rănire sau un accident grav ca acesta necesită ajutor de urgență acum. Sunați la 112." } },
    { id: "headache-lightning", allOf: [HEADACHE, ["fulger", "fulgerul", "thunderclap", "lightning"]], reason: {
      en: "A sudden, very severe headache needs emergency care.",
      ro: "O durere de cap bruscă și foarte puternică necesită îngrijire de urgență." } },
    { id: "stiff-neck-fever", allOf: [["gât înțepenit", "gâtul înțepenit", "ceafa înțepenită", "ceafă înțepenită",
      "înțepenit la gât", "stiff neck", "neck is stiff", "neck stiff", "cant bend my neck", "nu pot îndoi gâtul"],
      ["febră", "fever", "temperatură", "temperature", "febril"]], reason: {
      en: "A stiff neck together with fever needs emergency help now. Call 112.",
      ro: "Gâtul înțepenit împreună cu febra necesită ajutor de urgență acum. Sunați la 112." } }
  ];

  // ---- Specificity (read by the confidence score in assistant/engine.js) -------------
  // How strongly a rule's keywords point to ONE type of specialist:
  //   "strong"   – a single term that on its own clearly belongs to one specialist ("însărcinată",
  //                "pietre la rinichi", "tiroidă", "vedere încețoșată", "usturime la urinare", "menstruație");
  //   "specific" – strongly specialty-specific ("erupții pe piele", "palpitații", "menstruație", "genunchi");
  //   "moderate" – points to an area but is common ("durere de cap", "tuse", "durere de spate");
  //   "general"  – nonspecific ("febră", "oboseală", "amețeli", "stres", "umflat").
  // Key = specialty + "|" + the rule's FIRST keyword. Rules not listed get a default from their
  // weight (>= 4 specific, 3 moderate, <= 2 general). It never changes the specialty ranking.
  var SPECIFICITY = {
    "Dermatology|erupții": "specific", "Dermatology|mâncărime": "specific", "Dermatology|piele": "moderate",
    "Dermatology|aluniță": "specific", "Dermatology|se descuamează": "specific", "Dermatology|problemă de piele": "specific",
    "Cardiology|durere în piept": "specific", "Cardiology|palpitații": "specific", "Cardiology|tensiune mare": "specific",
    "Cardiology|urc scările": "moderate", "Cardiology|picioare umflate": "general",
    "Neurology|capul mă doare": "moderate", "Neurology|amețeli": "general", "Neurology|amorțeală": "moderate",
    "Neurology|tremur": "moderate",
    "Orthopedics|genunchi": "specific", "Orthopedics|umăr": "specific", "Orthopedics|durere de spate": "moderate",
    "Orthopedics|fractură": "specific", "Orthopedics|se umflă": "general", "Orthopedics|articulații": "moderate",
    "Rheumatology|articulații umflate": "moderate", "Rheumatology|genunchi": "general", "Sports Medicine|când alerg": "moderate",
    "ENT (Otorhinolaryngology)|durere în gât": "specific", "ENT (Otorhinolaryngology)|ureche": "specific",
    "ENT (Otorhinolaryngology)|nas înfundat": "moderate", "ENT (Otorhinolaryngology)|ureche înfundată": "specific",
    "ENT (Otorhinolaryngology)|răgușit": "moderate", "ENT (Otorhinolaryngology)|amețeli": "general",
    "Pulmonology|tuse": "moderate", "Pulmonology|respir șuierat": "specific", "Pulmonology|fumez": "general",
    "Gastroenterology|durere de burtă": "specific", "Gastroenterology|arsuri gastrice": "specific",
    "Gastroenterology|greață": "moderate", "Gastroenterology|diaree": "moderate", "Gastroenterology|gaze": "general",
    "Gastroenterology|sânge în scaun": "specific", "General Surgery|hernie": "moderate",
    "Obstetrics & Gynecology|sarcină": "strong", "Obstetrics & Gynecology|menstruație": "strong",
    "Obstetrics & Gynecology|ginecolog": "strong", "Obstetrics & Gynecology|sân": "moderate",
    "Urology|urinez des": "specific", "Urology|piatră la rinichi": "strong", "Urology|usturime la urinare": "strong", "Urology|usturime": "moderate",
    "Nephrology|rinichi": "moderate",
    "Endocrinology|tiroidă": "strong", "Endocrinology|sete mare": "general", "Endocrinology|transpir excesiv": "moderate",
    "Ophthalmology|ochi": "specific", "Ophthalmology|vedere încețoșată": "strong", "Ophthalmology|mă ustură ochii": "specific",
    "Psychiatry|anxietate": "specific", "Psychiatry|insomnie": "moderate", "Psychology|stres": "general",
    "Family Medicine|febră": "general", "Internal Medicine|febră": "general", "Family Medicine|tuse": "general",
    "Family Medicine|oboseală": "general", "Internal Medicine|oboseală": "general", "Family Medicine|control": "moderate",
    "Family Medicine|durere de cap": "general", "Family Medicine|insomnie": "general",
    "Allergology|alergie": "moderate", "Dentistry|dinte": "specific"
  };
  window.SYMPTOM_RULES.forEach(function (rule) {
    var k = rule.specialty + "|" + rule.keywords[0];
    rule.specificity = SPECIFICITY[k] || (rule.weight >= 4 ? "specific" : (rule.weight >= 3 ? "moderate" : "general"));
  });

  window.SPECIALTY_FALLBACKS = {
    "Psychology": ["Psychiatry", "Family Medicine"],
    "Psychiatry": ["Family Medicine"],
    "Pulmonology": ["Internal Medicine", "Family Medicine"],
    "Allergology": ["Internal Medicine", "Family Medicine"],
    "Nephrology": ["Urology", "Internal Medicine"],
    "Dentistry": ["Family Medicine"],
    "Pediatric Orthopedics": ["Orthopedics", "Pediatrics"],
    "Sports Medicine": ["Orthopedics"],
    "Rheumatology": ["Orthopedics", "Internal Medicine"],
    "Pediatrics": ["Family Medicine"],
    "Endocrinology": ["Internal Medicine"],
    "Gastroenterology": ["Internal Medicine"],
    "Cardiology": ["Internal Medicine"],
    "Neurology": ["Internal Medicine"],
    "General Surgery": ["Gastroenterology"],
    "Family Medicine": ["Internal Medicine"],
    "Internal Medicine": ["Family Medicine"]
    // Anything else (and the end of every chain): "Family Medicine", then "Internal Medicine".
  };

  window.SPECIALTY_REASONS = REASONS;

  window.CHILD_KEYWORDS = ["copil", "copilul", "copilului", "copii", "copilașul", "fiul", "fiica", "fiul meu", "fiica mea",
    "băiatul meu", "fetița", "fetița mea", "băiețelul", "bebe", "bebelușul", "bebeluș", "nou-născut", "nepoțelul",
    "my child", "my son", "my daughter", "my kid", "child", "children", "kid", "kids", "baby", "toddler", "newborn", "infant"];
  window.ADULT_KEYWORDS = ["eu", "am", "mă", "mi", "îmi", "sunt", "mie", "i", "im", "me", "myself", "my wife", "my husband",
    "soția", "soțul", "mama", "tata", "mama mea", "tatăl meu", "adult", "adultă"];
})();
