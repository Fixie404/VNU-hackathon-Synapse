/* MedIndex – rule-based symptom -> specialist-TYPE engine.
 * Classic script, no modules, no fetch, no DOM access. Works over file://.
 * Reads window.SYMPTOM_RULES / RED_FLAG_RULES / SPECIALTY_FALLBACKS (data/symptoms.js)
 * and, if no list is passed in, window.DOCTORS for the available specialties.
 * It NEVER diagnoses: it only says which TYPE of specialist usually handles a complaint.
 *
 * Matching (documented):
 *   - Text and keywords go through normalize(): lowercase, Romanian diacritics stripped
 *     (ă â î ș ț, cedilla ş ţ, uppercase forms, any NFD combining mark), apostrophes
 *     removed ("can't" -> "cant"), other punctuation -> space, whitespace collapsed.
 *   - wordMatch(keywordWord, token):
 *       * words of <= 3 chars must match exactly ("cap" never matches "capabil");
 *       * otherwise they share a common prefix cp >= 4 AND cp >= (shorter length - 1)
 *         (tolerates one differing final letter: durere/dureri, eruptii/eruptie);
 *       * a token may be at most 1 char shorter than the keyword word, and at least 5 chars
 *         ("respir" ~ "respira", but "doar" !~ "doare", "alerg" !~ "alergie");
 *       * a token may extend the keyword word by <= 2 chars when the keyword word has 4 chars
 *         ("tuse" ~ "tusea", "head" !~ "headache"), by <= 5 chars otherwise
 *         ("piept" ~ "pieptului").
 *   - A phrase matches when its words match tokens in order; between two consecutive
 *     keyword words at most 1 unrelated token is allowed, plus up to 3 filler words
 *     ("foarte", "tare", "very", "my", ...).
 *
 * Scoring & confidence (documented):
 *   - A rule counts once per message; specialty score = sum of matched rule weights
 *     (after remapping missing specialties through SPECIALTY_FALLBACKS). This raw `score`
 *     ranks the specialties and is kept on each suggestion for compatibility.
 *   - Keep the top 3 with score >= MIN_SCORE (2).
 *   - Confidence is a continuous confidenceScore 0-100 (Low < 40, Medium 40-69, High >= 70)
 *     built from the rule evidence, with confidenceFactors explaining it: see the
 *     "confidence score" block below (confidenceOf). Lower-ranked suggestions are never more
 *     confident than the one above them; a remapped suggestion is capped at 69 (Medium).
 *   - Child (answers.who === "child", or child words in the text unless who === "adult"):
 *     Pediatrics goes first (score = max(top + 1, 4)), GP / Internal Medicine are dropped
 *     and Orthopedics becomes Pediatric Orthopedics when available.
 *
 * Conversation (natural chat, at most MAX_TURNS = 10 user messages per round before recommending):
 *   - extractFacts() reads WHO (adult/child), HOW LONG (lt3d/3d2w/gt2w) and HOW STRONG
 *     (mild/moderate/severe) from the user's own words (RO + EN, diacritic-insensitive).
 *   - analyze(text, {who, duration, severity, turn, asked}) returns ONE natural follow-up question:
 *       * no specialty matched yet: an open question about the symptom ("clarify", reworded each time);
 *       * otherwise the first unknown fact in the order who -> duration -> severity that was not
 *         asked yet in this round (a fact is asked at most once);
 *     and no question (= the recommendation) once everything is known or at turn >= 5.
 *     If nothing matched by message MAX_TURNS -> GP (Low).
 *
 * GP = "General Practitioner / Family Doctor" (the canonical label). The older dataset label
 * "Family Medicine" is an alias: resolveSpecialty() maps between them and returns the exact string
 * of the loaded dataset (the GP label when it is there). GP is the first-contact option: general /
 * vague complaints, check-ups, prescriptions, vaccinations, certificates and the family doctor named
 * directly have GP rules (data/symptoms.js); 3+ unrelated complaints put GP first (MIXED_REASON).
 *   - Each fact question has optional answer chips (FOLLOWUPS[id].o); the user may also type.
 *   - converse(userMessages, asked, avail, opts) = extractFacts + analyze for a whole round.
 */
(function (root) {
  "use strict";

  // AI mode (Kimi via server/proxy.py) is ON by default when the page is served over http(s)
  // (open http://127.0.0.1:8000): it calls the same-origin "/api/chat".
  // Opened from disk (file://) or without `location` (jsc, tests) it is rule-based and sends nothing
  // (the proxy accepts only its own origin). FORCE_RULES = true disables AI everywhere.
  // If the AI call fails for any reason, the UI answers that message with the rule engine below.
  var FORCE_RULES = false;
  var PROTOCOL = typeof location !== "undefined" && location ? location.protocol : "";
  var USE_LLM = !FORCE_RULES && (PROTOCOL === "http:" || PROTOCOL === "https:");
  var FILE_MODE = PROTOCOL === "file:";
  var LLM_ENDPOINT = "/api/chat";
  var LLM_TIMEOUT_MS = 30000;
  var LLM_MAX_TURNS = 24;     // history items sent (a full 10-message round + replies fits)
  var LLM_MAX_CHARS = 1500;
  var MIN_SCORE = 2;
  var MAX_TURNS = 10;         // user messages per round before a recommendation is forced
  var GP = "General Practitioner / Family Doctor";
  // Other names of the GP specialty (older datasets / model output) -> the canonical label.
  var SPECIALTY_ALIASES = { "Family Medicine": GP, "General Practitioner": GP, "General Practice": GP, "Family Doctor": GP,
    "GP": GP, "Medicină de familie": GP, "Medicina de familie": GP, "Medic de familie": GP };

  // ------------------------------------------------------------------ strings
  var T = {
    WELCOME: {
      en: "Hi! I am the MedIndex Assistant, powered by AI. I can share general health information and help you find the right type of specialist and doctor. I am not a doctor and I can be wrong. In an emergency, call 112.",
      ro: "Bună! Sunt asistentul MedIndex, bazat pe AI. Vă pot oferi informații generale despre sănătate și vă pot ajuta să găsiți tipul potrivit de specialist și medicul potrivit. Nu sunt medic și pot greși. În caz de urgență, sunați la 112."
    },
    AI_FALLBACK: {
      en: "AI is unavailable right now, so this answer uses basic mode.",
      ro: "AI-ul nu este disponibil acum, așa că acest răspuns folosește modul de bază."
    },
    TYPING: {
      en: "MedIndex Assistant is typing…",
      ro: "Asistentul MedIndex scrie…"
    },
    FILE_HINT: {
      en: "For AI answers, run the local server and open http://127.0.0.1:8000",
      ro: "Pentru răspunsuri AI, porniți serverul local și deschideți http://127.0.0.1:8000"
    },
    RF_MISTAKE: {
      en: "If this was a mistake, tap Start over.",
      ro: "Dacă a fost o greșeală, apăsați Începe din nou."
    },
    ASK_PHARMACIST: {
      en: "For medicines and doses, ask a doctor or pharmacist.",
      ro: "Pentru medicamente și doze, întrebați un medic sau un farmacist."
    },
    WARNING: {
      en: "The advice given by our chatbot may be wrong",
      ro: "Sfaturile oferite de chatbotul nostru pot fi greșite"
    },
    EMERGENCY: {
      en: "This may be an emergency. Call 112 now.",
      ro: "Aceasta poate fi o urgență. Sunați acum la 112."
    },
    DISCLAIMER: {
      en: "This is guidance, not a medical opinion. If you are worried or it gets worse, seek urgent care.",
      ro: "Aceasta este o orientare, nu o opinie medicală. Dacă vă îngrijorează sau se agravează, solicitați îngrijire de urgență."
    },
    LLM_NOTICE: {
      en: "Your message is sent to an AI service.",
      ro: "Mesajul dumneavoastră este trimis unui serviciu AI."
    },
    SEVERE: {
      en: "Because it is severe, try to see a doctor soon.",
      ro: "Pentru că este puternic, încercați să mergeți la medic curând."
    },
    LONG: {
      en: "Because it has lasted more than 2 weeks, it is worth booking an appointment soon.",
      ro: "Pentru că durează de peste 2 săptămâni, merită să faceți o programare curând."
    },
    NOTE_REMAP: {
      en: "No {from} doctors in this list; {to} is the closest option.",
      ro: "Nu există medici de {from} în această listă; {to} este cea mai apropiată opțiune."
    },
    FALLBACK_REASON: {
      en: "When symptoms are hard to place, a family doctor is a safe first step and can refer you to the right specialist.",
      ro: "Când simptomele sunt greu de încadrat, medicul de familie este un prim pas sigur și vă poate trimite la specialistul potrivit."
    },
    MIXED_REASON: {
      en: "When several unrelated complaints come together, a family doctor can look at the whole picture first and refer you to the right specialists.",
      ro: "Când apar împreună mai multe probleme fără legătură între ele, medicul de familie poate privi întâi situația de ansamblu și vă poate trimite la specialiștii potriviți."
    },
    Q_HINT: {
      en: "I have a few quick questions so I can point you to the right specialist.",
      ro: "Am câteva întrebări scurte, ca să vă pot îndruma spre specialistul potrivit."
    },
    THANKS: {
      en: "You're welcome! If anything else bothers you, just describe it here.",
      ro: "Cu plăcere! Dacă vă mai supără ceva, descrieți aici."
    }
  };

  // Open questions about the symptom (reworded on each attempt).
  var CLARIFY_Q = {
    en: ["Can you tell me a bit more about what you feel and where? For example: a headache, chest pain, a stomach ache, a skin rash, joint pain or trouble sleeping.",
         "I want to be sure I understand. Which part of the body is affected, and what exactly do you notice: pain, a rash, a cough, dizziness, or something else?",
         "Could you describe the main problem in a few words? Even a rough description helps, for example where it hurts or what has changed."],
    ro: ["Puteți să-mi spuneți mai multe despre ce simțiți și unde? De exemplu: durere de cap, durere în piept, durere de burtă, erupții pe piele, dureri de articulații sau probleme cu somnul.",
         "Vreau să mă asigur că am înțeles. Ce parte a corpului este afectată și ce observați exact: durere, erupții, tuse, amețeli sau altceva?",
         "Puteți descrie problema principală în câteva cuvinte? Ajută și o descriere aproximativă, de exemplu unde vă doare sau ce s-a schimbat."]
  };

  var SPECIALTY_RO = {
    "Psychology": "Psihologie", "Psychiatry": "Psihiatrie", "Pulmonology": "Pneumologie", "Allergology": "Alergologie",
    "Nephrology": "Nefrologie", "Dentistry": "Stomatologie", "Pediatrics": "Pediatrie", "Family Medicine": "Medicină de familie",
    "General Practitioner / Family Doctor": "Medic de familie",
    "Internal Medicine": "Medicină internă", "Urology": "Urologie", "Orthopedics": "Ortopedie",
    "Pediatric Orthopedics": "Ortopedie pediatrică", "Sports Medicine": "Medicină sportivă", "Rheumatology": "Reumatologie",
    "Endocrinology": "Endocrinologie", "Gastroenterology": "Gastroenterologie", "Cardiology": "Cardiologie",
    "Neurology": "Neurologie", "General Surgery": "Chirurgie generală"
  };

  // The three facts. q = the natural question (qChild when we know it is a child);
  // o = optional answer chips [value, label]. A chip sends its LABEL as a normal user message,
  // and extractFacts() maps every label back to its value (also without context).
  var FOLLOWUPS = {
    who: {
      en: { q: "Is this for you or for a child?", o: [["adult", "Adult"], ["child", "Child under 18"]] },
      ro: { q: "Este pentru dumneavoastră sau pentru un copil?", o: [["adult", "Adult"], ["child", "Copil sub 18 ani"]] }
    },
    duration: {
      en: { q: "How long has this been going on?", qChild: "How long has your child had this?",
            o: [["lt3d", "Less than 3 days"], ["3d2w", "3 days to 2 weeks"], ["gt2w", "More than 2 weeks"]] },
      ro: { q: "De cât timp aveți această problemă?", qChild: "De cât timp are copilul această problemă?",
            o: [["lt3d", "Mai puțin de 3 zile"], ["3d2w", "Între 3 zile și 2 săptămâni"], ["gt2w", "Mai mult de 2 săptămâni"]] }
    },
    severity: {
      en: { q: "How strong is it — mild, moderate, or severe? You can also rate it from 1 to 10.",
            o: [["mild", "Mild"], ["moderate", "Moderate"], ["severe", "Severe"]] },
      ro: { q: "Cât de puternic este — ușor, moderat sau sever? Puteți să-l notați și de la 1 la 10.",
            o: [["mild", "Ușor"], ["moderate", "Moderat"], ["severe", "Sever"]] }
    }
  };

  var QUICK_REPLIES = [
    { id: "skin", label: { en: "Skin problem", ro: "Problemă de piele" },
      text: { en: "I have a skin problem", ro: "Am o problemă de piele" } },
    { id: "headache", label: { en: "Headache", ro: "Durere de cap" },
      text: { en: "I have a headache", ro: "Mă doare capul" } },
    { id: "chest", label: { en: "Chest pain", ro: "Durere în piept" },
      text: { en: "I have chest pain", ro: "Am durere în piept" } },
    { id: "child", label: { en: "Child is sick", ro: "Copilul este bolnav" },
      text: { en: "My child is sick", ro: "Copilul meu este bolnav" } },
    { id: "joint", label: { en: "Joint or back pain", ro: "Durere de articulații sau spate" },
      text: { en: "I have joint pain or back pain", ro: "Am dureri de articulații sau dureri de spate" } },
    { id: "women", label: { en: "Women's health", ro: "Sănătatea femeii" },
      text: { en: "I need a gynecology check-up", ro: "Am nevoie de un control ginecologic" } }
  ];

  var FILLERS = toSet(["foarte", "tare", "rau", "putin", "cam", "mai", "ma", "mi", "imi", "il", "o", "un", "si", "cumplit",
    "groaznic", "teribil", "constant", "des", "very", "really", "so", "quite", "bit", "a", "an", "the", "my", "his", "her",
    "bad", "badly", "little", "always", "constantly"]);

  var RO_WORDS = toSet(["ma", "mi", "imi", "am", "doare", "dor", "durere", "dureri", "si", "sau", "de", "la", "pe", "in",
    "copilul", "copil", "meu", "mea", "nu", "cu", "care", "este", "e", "foarte", "simt", "ce", "rau", "cap", "capul", "gat",
    "piept", "pieptul", "febra", "tuse", "zile", "are", "sunt", "pot", "cand", "dupa", "un", "o", "mai", "tare", "burta",
    "spate", "spatele", "genunchi", "ameteli", "eruptii", "piele", "ochi", "fiul", "fiica", "bolnav", "bolnava", "nevoie",
    "vreau", "ajutor", "buna", "aveti", "ziua", "saptamani", "luni", "frecvente"]);
  var EN_WORDS = toSet(["i", "my", "the", "and", "have", "has", "is", "pain", "feel", "it", "of", "with", "can", "for",
    "a", "an", "im", "am", "me", "hurts", "hurt", "sick", "child", "son", "daughter", "since", "days", "weeks", "when",
    "headache", "cough", "fever", "rash", "need", "help", "what", "who", "doctor", "it", "this", "very", "back", "knee"]);

  // ------------------------------------------------------------------ helpers
  function toSet(arr) { var o = {}; for (var i = 0; i < arr.length; i++) o[arr[i]] = true; return o; }
  function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }
  function pick(obj, lang) { return obj ? (obj[lang] || obj.en) : null; }

  var DIAC = { "ă": "a", "â": "a", "î": "i", "ș": "s", "ş": "s", "ț": "t", "ţ": "t",
               "Ă": "a", "Â": "a", "Î": "i", "Ș": "s", "Ş": "s", "Ț": "t", "Ţ": "t" };

  function normalize(text) {
    if (text == null) return "";
    var s = String(text).replace(/[ăâîșşțţĂÂÎȘŞȚŢ]/g, function (c) { return DIAC[c]; });
    if (typeof s.normalize === "function") s = s.normalize("NFD");
    s = s.replace(/[̀-ͯ]/g, "").toLowerCase();
    s = s.replace(/['’‘`´]/g, "");
    s = s.replace(/[^a-z0-9]+/g, " ");
    return s.replace(/\s+/g, " ").replace(/^ | $/g, "");
  }

  function tokenize(text) {
    var n = normalize(text);
    return n ? n.split(" ") : [];
  }

  function wordMatch(kw, tok) {
    if (kw === tok) return true;
    var lk = kw.length, lt = tok.length;
    if (lk <= 3 || lt <= 3) return false;
    var s = Math.min(lk, lt), cp = 0;
    while (cp < s && kw.charCodeAt(cp) === tok.charCodeAt(cp)) cp++;
    if (cp < 4 || cp < s - 1) return false;
    if (lt < lk) return lt >= 5 && lt >= lk - 1;
    return (lt - lk) <= (lk === 4 ? 2 : 5);
  }

  // kwWords: array of normalized words. tokens: normalized tokens of the text.
  function phraseMatch(tokens, kwWords) { return !!phraseSpan(tokens, kwWords); }
  /** [firstTokenIndex, lastTokenIndex] of the first match of the phrase, or null. */
  function phraseSpan(tokens, kwWords, from) {
    if (!kwWords.length) return null;
    for (var i = from || 0; i < tokens.length; i++) {
      if (!wordMatch(kwWords[0], tokens[i])) continue;
      var pos = i, ok = true;
      for (var k = 1; k < kwWords.length && ok; k++) {
        var found = -1, gaps = 0, fill = 0;
        for (var j = pos + 1; j < tokens.length; j++) {
          if (wordMatch(kwWords[k], tokens[j])) { found = j; break; }
          if (has(FILLERS, tokens[j]) && fill < 3) { fill++; continue; }
          if (gaps < 1) { gaps++; continue; }
          break;
        }
        if (found < 0) ok = false; else pos = found;
      }
      if (ok) return [i, pos];
    }
    return null;
  }

  var phraseCache = {};
  function compile(phrase) {
    if (has(phraseCache, phrase)) return phraseCache[phrase];
    var w = tokenize(phrase);
    phraseCache[phrase] = w;
    return w;
  }

  function anyMatch(tokens, phrases) {
    if (!phrases) return false;
    for (var i = 0; i < phrases.length; i++) if (phraseMatch(tokens, compile(phrases[i]))) return true;
    return false;
  }

  /** Every hit of any of the phrases, as sorted spans with overlapping hits merged ([] = no match). */
  function allSpans(tokens, phrases) {
    var out = [], merged = [];
    for (var p = 0; phrases && p < phrases.length; p++) {
      var kw = compile(phrases[p]), from = 0, sp, mine = [];
      while (from < tokens.length && (sp = phraseSpan(tokens, kw, from))) { mine.push(sp); from = sp[0] + 1; }
      // keep the tightest hits: drop a hit that contains another hit of the same phrase
      // ("mă ... doare burta" starting at an earlier "mă" must not swallow other words)
      mine.forEach(function (a) {
        if (!mine.some(function (b) { return b !== a && b[0] >= a[0] && b[1] <= a[1]; })) out.push(a);
      });
    }
    out.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
    out.forEach(function (sp) {
      var last = merged[merged.length - 1];
      if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]); else merged.push([sp[0], sp[1]]);
    });
    return merged;
  }

  function matchesText(text, phrases) { return anyMatch(tokenize(text), phrases); }

  function detectLanguage(text) {
    var raw = String(text == null ? "" : text);
    if (/[ăâîșşțţĂÂÎȘŞȚŢ]/.test(raw)) return "ro";
    var toks = tokenize(raw), ro = 0, en = 0;
    for (var i = 0; i < toks.length; i++) {
      if (has(RO_WORDS, toks[i])) ro++;
      if (has(EN_WORDS, toks[i])) en++;
    }
    return ro > en ? "ro" : "en";
  }

  function rules() { return root.SYMPTOM_RULES || []; }
  function redFlagRules() { return root.RED_FLAG_RULES || []; }
  function fallbacks() { return root.SPECIALTY_FALLBACKS || {}; }
  function reasonsMap() { return root.SPECIALTY_REASONS || {}; }

  function resolveAvail(avail) {
    var list = null;
    if (avail && typeof avail.forEach === "function" && !Array.isArray(avail)) { // Set
      list = []; avail.forEach(function (v) { list.push(v); });
    } else if (Array.isArray(avail)) {
      list = avail.slice();
    } else if (root.DOCTORS && root.DOCTORS.length) {
      list = [];
      for (var i = 0; i < root.DOCTORS.length; i++) {
        var sp = root.DOCTORS[i] && root.DOCTORS[i].specialty;
        if (sp && list.indexOf(sp) < 0) list.push(sp);
      }
    } else {
      list = [];
      var rs = rules();
      for (var r = 0; r < rs.length; r++) if (list.indexOf(rs[r].specialty) < 0) list.push(rs[r].specialty);
    }
    return toSet(list);
  }

  /** Canonical specialty label ("Family Medicine" -> the GP label); other names unchanged. */
  function canonSpecialty(s) { return has(SPECIALTY_ALIASES, s) ? SPECIALTY_ALIASES[s] : s; }
  function sameSpecialty(a, b) { return a === b || canonSpecialty(a) === canonSpecialty(b); }
  /** The exact available string for `specialty` or one of its aliases (no fallback chain), or null. */
  function availName(specialty, availSet) {
    var c = canonSpecialty(specialty);
    if (has(availSet, c)) return c;
    if (has(availSet, specialty)) return specialty;
    for (var k in SPECIALTY_ALIASES) if (has(SPECIALTY_ALIASES, k) && SPECIALTY_ALIASES[k] === c && has(availSet, k)) return k;
    return null;
  }

  // Returns the exact available specialty string for `specialty`, or null.
  function resolveSpecialty(specialty, availSet) {
    var direct = availName(specialty, availSet);
    if (direct) return direct;
    var fb = fallbacks(), seen = {}, queue = (fb[canonSpecialty(specialty)] || fb[specialty] || []).slice();
    queue.push(GP, "Internal Medicine");
    while (queue.length) {
      var s = canonSpecialty(queue.shift());
      if (seen[s]) continue;
      seen[s] = true;
      var hit = availName(s, availSet);
      if (hit) return hit;
      var more = fb[s];
      if (more) queue = queue.concat(more);
    }
    return null;
  }

  function remapNote(from, to, lang) {
    var f = lang === "ro" ? (SPECIALTY_RO[from] || from) : from;
    return pick(T.NOTE_REMAP, lang).replace("{from}", f).replace("{to}", to);
  }

  function checkRedFlags(tokens) {
    var rf = redFlagRules();
    for (var i = 0; i < rf.length; i++) {
      var r = rf[i], fired = false;
      if (r.anyOf && anyMatch(tokens, r.anyOf)) fired = true;
      if (!fired && r.allOf && r.allOf.length) {
        fired = true;
        for (var g = 0; g < r.allOf.length; g++) if (!anyMatch(tokens, r.allOf[g])) { fired = false; break; }
      }
      if (fired && r.noneOf && anyMatch(tokens, r.noneOf)) fired = false;
      if (fired) return r;
    }
    return null;
  }


  // ------------------------------------------------------------------ fact extraction
  // extractFacts(): WHO / HOW LONG / HOW STRONG from free text (RO + EN). Works on normalize()d
  // tokens (lowercase, no diacritics, punctuation -> space) with EXACT word sequences (no fuzzy
  // matching, so "de multe ori" is not "de mult"). Limits (documented): it understands common
  // phrasings, digits and number words up to 30, "N/10" scales; it does not understand dates
  // ("since March 3rd"), most negations beyond the listed ones, or third persons other than
  // the listed family words.
  var FACT_IDS = ["who", "duration", "severity"];
  var FACT_VALUES = { who: ["adult", "child"], duration: ["lt3d", "3d2w", "gt2w"], severity: ["mild", "moderate", "severe"] };
  function validFact(id, v) { return has(FACT_VALUES, id) && FACT_VALUES[id].indexOf(v) >= 0 ? v : null; }

  var NUMW = { o: 1, un: 1, una: 1, unu: 1, a: 1, an: 1, one: 1, single: 1, doi: 2, doua: 2, two: 2, couple: 2,
    trei: 3, three: 3, patru: 4, four: 4, cinci: 5, five: 5, sase: 6, six: 6, sapte: 7, seven: 7, opt: 8, eight: 8,
    noua: 9, nine: 9, zece: 10, ten: 10, unsprezece: 11, eleven: 11, doisprezece: 12, douasprezece: 12, twelve: 12,
    treisprezece: 13, thirteen: 13, paisprezece: 14, fourteen: 14, cincisprezece: 15, fifteen: 15, douazeci: 20,
    twenty: 20, treizeci: 30, thirty: 30, cateva: 3, cativa: 3, few: 3, several: 4, multe: 10, many: 10 };
  var ARTICLES = toSet(["o", "a", "an", "un", "una"]);   // numbers only right before a unit
  function numOf(t, allowArticle) {
    if (t == null) return null;
    if (/^\d{1,4}$/.test(t)) return parseInt(t, 10);
    var m = /^(\d{1,3})d(\d{1,2})$/.exec(t);              // "1.5" / "1,5" (kept as "1d5" by factTokens)
    if (m) return parseFloat(m[1] + "." + m[2]);
    if (has(NUMW, t) && (allowArticle || !has(ARTICLES, t))) return NUMW[t];
    return null;
  }
  function factTokens(text) {
    return tokenize(String(text == null ? "" : text).replace(/(\d)[.,](\d)/g, "$1d$2"));
  }
  function seqAt(tokens, i, words) {
    for (var k = 0; k < words.length; k++) if (tokens[i + k] !== words[k]) return false;
    return true;
  }
  var seqCache = {};
  function seqs(list) {
    var key = list.join("|");
    if (!has(seqCache, key)) seqCache[key] = list.map(function (p) { return tokenize(p); }).filter(function (w) { return w.length; });
    return seqCache[key];
  }
  /** Index of the first exact occurrence of any phrase of `list`, or -1. */
  function findAny(tokens, list) {
    var L = seqs(list);
    for (var i = 0; i < tokens.length; i++) for (var j = 0; j < L.length; j++) if (seqAt(tokens, i, L[j])) return i;
    return -1;
  }
  function hasAny(tokens, list) { return findAny(tokens, list) >= 0; }
  /** Replaces every occurrence of the phrases with "_" (so they can't match anything else). */
  function blank(tokens, list) {
    var L = seqs(list), out = tokens.slice();
    for (var i = 0; i < out.length; i++) for (var j = 0; j < L.length; j++) {
      if (seqAt(out, i, L[j])) { for (var k = 0; k < L[j].length; k++) out[i + k] = "_"; }
    }
    return out;
  }

  // ---- WHO
  var CHILD_NOUNS = toSet(["copil", "copilul", "copilului", "copila", "copilas", "copilasul", "fiul", "fiica", "baiat",
    "baiatul", "baietel", "baietelul", "fata", "fetita", "fetitei", "bebe", "bebelus", "bebelusul", "bebelusa", "nepot",
    "nepotul", "nepoata", "nepotel", "nepotelul", "sugarul", "son", "daughter", "kid", "child", "boy", "girl", "baby",
    "toddler", "infant", "newborn"]);
  var POSSESSIVE = toSet(["meu", "mea", "nostru", "noastra", "my", "our", "mic", "mica", "cel", "cea", "little", "young", "younger", "youngest", "eldest", "older"]);
  var AGE_UNIT_DAYS = { ani: 365, an: 365, anisori: 365, years: 365, year: 365, yrs: 365, yr: 365, luni: 30, luna: 30,
    lunite: 30, months: 30, month: 30, saptamani: 7, saptamana: 7, weeks: 7, week: 7, zile: 1, zi: 1, days: 1, day: 1 };
  var AGE_VERBS = toSet(["are", "am", "ai", "avem", "aveti", "au", "avea", "implineste", "implinit", "face", "facut"]);
  var APPROX = toSet(["vreo", "cam", "circa", "aproximativ", "aprox", "aproape", "doar", "deja", "about", "around",
    "approximately", "roughly", "like", "almost", "nearly", "just", "only", "already", "maybe", "poate", "peste", "over", "under", "sub"]);
  var NOT_CHILD = ["nu e copil", "nu este copil", "nu e un copil", "nu este un copil", "nu e pentru copil", "nu este pentru copil",
    "nu pentru copil", "nu e pentru un copil", "nu pentru un copil", "nu e copilul", "nu am copii", "fara copii", "not a child",
    "not for a child", "not my child", "not for my child", "not a kid", "not my kid", "not for my kid", "no child", "no kids",
    "no children", "i dont have kids", "i dont have children", "i have no kids", "i have no children", "nu copilul", "not the child"];
  var CHILD_WORDS = ["copil", "copilul", "copilului", "copila", "copilas", "copilasul", "copilasului", "copii", "copiii",
    "copiilor", "fiul", "fiului", "fiica", "fiicei", "baiatul meu", "baiatul nostru", "baietel", "baietelul", "baietelului",
    "fetita", "fetitei", "fata mea", "fata noastra", "bebe", "bebel", "bebelus", "bebelusul", "bebelusului", "bebelusa",
    "nou nascut", "nou nascutul", "nepotel", "nepotelul", "nepotica", "sugarul", "sugarului", "adolescent", "adolescenta",
    "adolescentul", "minor", "minora", "minorul", "elev", "eleva", "under 18", "sub 18", "child", "children", "kid", "kids",
    "kiddo", "son", "daughter", "baby", "babies", "toddler", "newborn", "infant", "my boy", "my girl", "little boy",
    "little girl", "baby boy", "baby girl", "teen", "teenager", "underage", "minor", "pentru copil", "pt copil"];
  var ADULT_STRONG = ["adult", "adulta", "adultul", "adulti", "adults", "grown up", "grownup", "pentru mine", "pt mine",
    "for me", "for myself", "myself", "eu insumi", "eu insami", "chiar eu", "my wife", "my husband", "my partner", "my mom",
    "my mum", "my mother", "my dad", "my father", "my grandma", "my grandmother", "my grandpa", "my grandfather",
    "my boyfriend", "my girlfriend", "sotia", "sotiei", "sotul", "sotului", "mama", "mamei", "mamica", "tata", "tatal",
    "tatalui", "tatei", "bunica", "bunicii", "bunicul", "bunicului", "soacra", "socrul", "partenerul", "partenera",
    "prietenul meu", "prietena mea", "sunt adult", "sunt adulta", "sunt major", "sunt majora", "over 18", "peste 18",
    "sarcina", "insarcinata", "gravida", "pregnant", "pregnancy", "menopauza", "menopause", "prostata", "prostate"];
  var ADULT_WEAK_EN = toSet(["i", "im", "ive", "id", "me", "my", "mine"]);
  var ADULT_WEAK_RO = toSet(["eu", "mie", "mine"]);
  var WHO_CTX_ADULT = toSet(["eu", "mie", "mine", "me", "myself", "self", "personal", "personally", "i", "im", "noi", "us"]);

  /** Ages in the token list: [{years, attached (to a child noun), idx: [consumed indices]}]. */
  function findAges(tokens, whoAsked) {
    var out = [], childNoun = false;
    for (var c = 0; c < tokens.length; c++) if (has(CHILD_NOUNS, tokens[c])) childNoun = true;
    for (var i = 0; i < tokens.length; i++) {
      var n = numOf(tokens[i], true);
      if (n == null) continue;
      var j = i + 1;
      if (tokens[j] === "de") j++;
      var u = tokens[j], unit = has(AGE_UNIT_DAYS, u) ? AGE_UNIT_DAYS[u] : 0;
      var nextNoun = has(CHILD_NOUNS, tokens[j + 2]);
      if (unit && tokens[j + 1] === "old") {                                           // "6 years old", "6-year-old son"
        out.push({ years: n * unit / 365, attached: nextNoun || childNoun, idx: [i, j, j + 1] });
        continue;
      }
      if (!has(ARTICLES, tokens[i]) && (tokens[i + 1] === "yo" || (tokens[i + 1] === "y" && tokens[i + 2] === "o"))) {
        out.push({ years: n, attached: childNoun, idx: [i, i + 1] });
        continue;
      }
      var p = i - 1;
      while (p >= 0 && has(APPROX, tokens[p])) p--;
      var v = tokens[p];
      if (unit) {
        if (has(AGE_VERBS, v) && (unit === 365 || childNoun)) {                         // "are 5 ani", "am 30 de ani"
          out.push({ years: n * unit / 365, attached: false, idx: [i, j] });
          continue;
        }
        if (v === "de") {                                                               // "copilul (meu) de 5 ani"
          var q = p - 1;
          while (q >= 0 && has(POSSESSIVE, tokens[q])) q--;
          if (has(CHILD_NOUNS, tokens[q])) { out.push({ years: n * unit / 365, attached: true, idx: [i, j] }); continue; }
        }
        if (v === "varsta" || v === "aged" || v === "age") { out.push({ years: n * unit / 365, attached: false, idx: [i, j] }); continue; }
        continue;
      }
      if (has(ARTICLES, tokens[i])) continue;
      if (v === "varsta" || v === "aged" || v === "age") { out.push({ years: n, attached: childNoun, idx: [i] }); continue; }
      // "my son is 6", "fiul meu are 6"
      if ((v === "is" || v === "e" || v === "este" || v === "are" || v === "turned") && n < 120) {
        var q2 = p - 1;
        while (q2 >= 0 && has(POSSESSIVE, tokens[q2])) q2--;
        if (has(CHILD_NOUNS, tokens[q2]) || has(CHILD_NOUNS, tokens[p - 1])) { out.push({ years: n, attached: true, idx: [i] }); continue; }
      }
      // bare number as the answer to "Is this for you or for a child?"
      if (whoAsked && tokens.length <= 3 && n >= 0 && n < 120) out.push({ years: n, attached: false, idx: [i] });
    }
    return out;
  }

  /** {value, strength} (strength 2 = explicit, 1 = only first-person words) or null. */
  function whoOf(tokens, ages, lang, asked) {
    var t = blank(tokens, NOT_CHILD), i;
    var attached = ages.filter(function (a) { return a.attached; });
    if (attached.length) return { value: attached[0].years < 18 ? "child" : "adult", strength: 2 };
    for (i = 0; i < ages.length; i++) if (ages[i].years < 18) return { value: "child", strength: 2 };
    if (hasAny(t, CHILD_WORDS) || hasAny(t, root.CHILD_KEYWORDS || [])) return { value: "child", strength: 2 };
    if (ages.length) return { value: "adult", strength: 2 };
    if (hasAny(t, ADULT_STRONG)) return { value: "adult", strength: 2 };
    var weak = false;
    for (i = 0; i < t.length; i++) {
      if (has(ADULT_WEAK_RO, t[i]) || (lang === "en" && has(ADULT_WEAK_EN, t[i]))) weak = true;
      if (asked === "who" && has(WHO_CTX_ADULT, t[i])) return { value: "adult", strength: 2 };
    }
    if (t.length !== tokens.length || t.join(" ") !== tokens.join(" ")) return { value: "adult", strength: asked === "who" ? 2 : 1 }; // "not a child"
    return weak ? { value: "adult", strength: asked === "who" ? 2 : 1 } : null;
  }

  // ---- HOW LONG
  function unitDays(t) {
    if (/^(minut|minute|minutes|min|mins)$/.test(t)) return 0.001;
    if (/^(ora|ore|orei|hour|hours|hr|hrs)$/.test(t)) return 0.04;
    if (/^(zi|zile|zilei|day|days)$/.test(t)) return 1;
    if (/^(saptamana|saptamani|saptamanii|saptamanile|week|weeks)$/.test(t)) return 7;
    if (/^(luna|luni|lunii|lunile|month|months)$/.test(t)) return 30;
    if (/^(an|ani|anul|anii|year|years|yrs)$/.test(t)) return 365;
    return 0;
  }
  var PLURAL_UNIT = toSet(["zile", "days", "saptamani", "weeks", "months", "years", "ore", "hours", "minute", "minutes"]);
  var SINGULAR_QUAL = toSet(["last", "past", "this", "whole", "entire", "all", "trecuta", "trecut", "asta", "aceasta",
    "acesta", "intreaga", "intreg", "toata", "tot"]);
  var FREQ_BEFORE = toSet(["every", "each", "fiecare", "once", "twice", "per", "pe", "la", "ori", "times", "x"]);
  var LT3D_PHRASES = ["de ieri", "since yesterday", "yesterday", "ieri", "azi", "astazi", "today", "this morning",
    "since this morning", "de dimineata", "azi dimineata", "azi noapte", "aseara", "de aseara", "last night", "tonight",
    "alaltaieri", "de alaltaieri", "day before yesterday", "just started", "abia a inceput", "tocmai a inceput",
    "a inceput azi", "started today", "de cateva ore", "a few hours", "few hours", "o zi", "one day", "a day"];
  var GT2W_PHRASES = ["de mult", "de mult timp", "de multa vreme", "de multisor", "for ages", "for a long time",
    "a long time", "long time", "for years", "for months", "de ani", "ani de zile", "luni de zile", "de luni bune",
    "de ani buni", "dintotdeauna", "din copilarie", "since childhood", "since i was a child", "chronic", "cronic", "cronica",
    "de cand ma stiu", "forever", "for ever", "all my life", "toata viata", "de o vesnicie"];

  var AGE_LIMITS = ["sub 18 ani", "sub 18", "under 18 years old", "under 18 years", "under 18", "peste 18 ani", "peste 18",
    "over 18 years old", "over 18 years", "over 18"];

  function durationOf(tokens, ages, asked) {
    var used = {}, best = null, k;
    ages.forEach(function (a) { a.idx.forEach(function (x) { used[x] = true; }); });
    tokens = blank(tokens, AGE_LIMITS).map(function (x, i) { return used[i] ? "_" : x; }); // ages are not durations
    for (var i = 0; i < tokens.length; i++) {
      if (used[i]) continue;
      var t = tokens[i], u = unitDays(t);
      if (!u) continue;
      var j = i - 1;
      if (tokens[j] === "de" || tokens[j] === "of") j--;                 // "douăzeci de zile", "a couple of days"
      var n = used[j] ? null : numOf(tokens[j], true), days;
      if (n != null) {
        var before = tokens[j - 1];
        if (has(FREQ_BEFORE, before) && before !== "pe") continue;        // "every 2 days", "la 2 zile", "once a week"
        days = n * u;
        var pre = tokens.slice(Math.max(0, j - 3), j).join(" ");
        if (/(^| )(more than|over|peste|mai mult de|mai bine de|de peste)$/.test(pre)) days += Math.max(1, u * 0.1);
        else if (/(^| )(less than|under|sub|mai putin de|almost|nearly|aproape|nici)$/.test(pre)) days -= 0.1;
      } else if (has(PLURAL_UNIT, t)) {
        if (has(FREQ_BEFORE, tokens[i - 1])) continue;
        days = 3 * u;                                                      // "for days", "de săptămâni"
      } else if (has(SINGULAR_QUAL, tokens[i - 1]) || has(SINGULAR_QUAL, tokens[i + 1])) {
        days = u;                                                          // "last week", "săptămâna trecută", "all day"
      } else continue;
      if (best == null || days > best) best = days;
    }
    var cat = best == null ? null : (best < 3 ? "lt3d" : (best <= 14 ? "3d2w" : "gt2w"));
    var phrase = hasAny(tokens, GT2W_PHRASES) ? "gt2w" : (hasAny(tokens, LT3D_PHRASES) ? "lt3d" : null);
    var rank = { lt3d: 0, "3d2w": 1, gt2w: 2 };
    if (phrase && (!cat || rank[phrase] > rank[cat])) cat = phrase;
    if (!cat && asked === "duration") {
      // short direct answers: a bare number = days; "mult"/"long" = a long time; "putin"/"recent" = recently
      var bare = tokens.filter(function (x) { return !has(APPROX, x); });
      if (bare.length === 1 && numOf(bare[0], false) != null) cat = numOf(bare[0], false) < 3 ? "lt3d" : (numOf(bare[0], false) <= 14 ? "3d2w" : "gt2w");
      else if (hasAny(tokens, ["mult", "long", "a while", "ages", "o vreme", "ceva vreme", "de ceva vreme"])) cat = "gt2w";
      else if (hasAny(tokens, ["putin", "not long", "recent", "recently", "de curand", "just now", "acum"])) cat = "lt3d";
    }
    for (k in rank) if (cat === k) return cat;
    return null;
  }

  // ---- HOW STRONG
  var SEV_NEG_MILD = ["nu foarte", "nu prea", "nu e grav", "nu este grav", "nu chiar asa", "nu asa tare", "nu ma doare tare",
    "nu doare tare", "nu e tare", "nu e foarte", "nu este foarte", "nu e asa", "nu e chiar", "nu e rau", "not too bad",
    "not that bad", "not very", "not so bad", "not bad", "not severe", "not strong", "not too strong", "nothing serious",
    "not really", "not much"];
  var SEV_SEVERE = ["insuportabil", "insuportabila", "groaznic", "groaznica", "cumplit", "cumplita", "teribil", "teribila",
    "sever", "severa", "severe", "severely", "unbearable", "terrible", "horrible", "awful", "excruciating", "worst",
    "agonizing", "extreme", "extremely", "extrem", "intolerable", "atroce", "crunt", "crunta", "foarte tare", "foarte puternic",
    "foarte puternica", "foarte rau", "foarte intens", "foarte intensa", "foarte dureros", "foarte dureroasa", "tare de tot",
    "rau de tot", "nu pot dormi", "nu mai pot dormi", "nu pot sa dorm", "nu pot merge", "nu pot sa merg", "nu mai pot merge",
    "nu pot sta", "nu ma pot misca", "nu pot lucra", "very bad", "really bad", "so bad", "super bad", "very strong",
    "really strong", "very painful", "really painful", "very intense", "cant sleep", "can not sleep", "cannot sleep",
    "cant walk", "cannot walk", "cant move", "cannot move", "keeps me up", "keeps me awake"];
  var SEV_MOD_PREFIX = ["destul de", "quite", "pretty", "fairly", "cam", "rather", "moderately", "relativ"];
  var SEV_MILD_WORDS = ["usor", "usoara", "putin", "putina", "suportabil", "suportabila", "slab", "slaba", "mild", "mildly",
    "slight", "slightly", "minor", "a bit", "a little", "lejer", "bearable", "tolerable", "barely", "abia", "light", "ok"];
  var SEV_MODERATE = ["moderat", "moderata", "moderate", "deranjant", "deranjanta", "deranjeaza", "mediu", "medie", "medium",
    "bothersome", "annoying", "suparator", "suparatoare", "so so", "in between", "undeva la mijloc", "la mijloc", "average"];
  var SEV_CTX_SEVERE = ["tare", "puternic", "puternica", "strong", "intense", "intens", "intensa", "high", "mare", "ridicat", "a lot", "mult"];
  var SEV_CTX_MODERATE = ["bad", "rau", "painful", "dureros", "dureroasa", "it hurts", "ma doare"];

  function scaleOf(text, tokens, asked) {
    var s = normalizeKeep(text);
    var m = /(?:^|[^\d])(10|[0-9])(?:[.,]5)?\s*(?:\/|din|out of|of|pe)\s*10(?!\d)/.exec(s);
    var n = m ? parseInt(m[1], 10) : null;
    if (n == null) {
      for (var i = 2; i < tokens.length; i++) {
        if (tokens[i] !== "zece" && tokens[i] !== "ten" && tokens[i] !== "10") continue;
        var k = i - 1;
        if (tokens[k] === "of" && tokens[k - 1] === "out") k--;
        if (tokens[k] !== "din" && tokens[k] !== "of" && tokens[k] !== "pe" && tokens[k] !== "out") continue;
        var v = numOf(tokens[k - 1], false);
        if (v != null && v <= 10) { n = v; break; }
      }
    }
    if (n == null && asked === "severity") {
      var bare = tokens.filter(function (x) { return !has(APPROX, x) && x !== "nota" && x !== "un" && x !== "a" && x !== "maybe" && x !== "cred" && x !== "i" && x !== "think" && x !== "about" && x !== "its" && x !== "it" && x !== "is" && x !== "e" && x !== "este"; });
      if (bare.length === 1 && numOf(bare[0], false) != null && numOf(bare[0], false) <= 10) n = numOf(bare[0], false);
    }
    if (n == null) return null;
    return n <= 3 ? "mild" : (n <= 6 ? "moderate" : "severe");
  }
  /** Lowercase, Romanian diacritics stripped, punctuation KEPT (for "7/10"). */
  function normalizeKeep(text) {
    var s = String(text == null ? "" : text).replace(/[ăâîșşțţĂÂÎȘŞȚŢ]/g, function (c) { return DIAC[c]; });
    return s.toLowerCase();
  }

  function severityOf(text, tokens, asked) {
    var sc = scaleOf(text, tokens, asked);
    if (sc) return sc;
    var t = blank(tokens, ["mai putin", "a little girl", "a little boy", "a little one", "a little kid", "my little",
      "little girl", "little boy", "o fetita", "pe mine", "abia a inceput", "it has been", "light headed", "lightheaded", "a bit more"]);
    if (hasAny(t, SEV_NEG_MILD)) return "mild";
    if (hasAny(t, SEV_SEVERE)) return "severe";
    // "quite mild" / "destul de ușor" -> mild; "pretty bad" / "destul de tare" -> moderate
    var L = seqs(SEV_MOD_PREFIX), M = seqs(SEV_MILD_WORDS), STRONGISH = SEV_CTX_SEVERE.concat(SEV_CTX_MODERATE, ["sore", "uncomfortable"]);
    for (var i = 0; i < t.length; i++) for (var a = 0; a < L.length; a++) {
      if (!seqAt(t, i, L[a])) continue;
      var nx = i + L[a].length, after = t.slice(nx, nx + 2);
      for (var b = 0; b < M.length; b++) if (seqAt(t, nx, M[b])) return "mild";
      if (L[a][0] === "destul" || L[a][0] === "relativ" || L[a][0] === "moderately") { if (t[nx] && t[nx] !== "_") return "moderate"; }
      else if (hasAny(after, STRONGISH)) return "moderate";                // "pretty bad", "quite strong", "cam tare"
    }
    if (hasAny(t, SEV_MODERATE)) return "moderate";
    if (asked === "severity") {
      if (hasAny(t, SEV_CTX_SEVERE)) return "severe";
      if (hasAny(t, SEV_CTX_MODERATE)) return "moderate";
      if (hasAny(t, ["pretty", "quite", "destul", "fairly", "so", "asa si asa"])) return "moderate";
    }
    if (hasAny(t, SEV_MILD_WORDS.filter(function (w) { return w !== "light" && w !== "ok" && w !== "abia" && w !== "barely"; }))) return "mild";
    if (asked === "severity" && hasAny(t, ["light", "ok", "okay", "fine", "barely", "abia", "nu mult", "little"])) return "mild";
    return null;
  }

  /** Facts of ONE message: { who: {value, strength}|null, duration, severity }. */
  function factsOfMessage(text, asked) {
    var tokens = factTokens(text), lang = detectLanguage(text);
    var ages = findAges(tokens, asked === "who");
    return { who: whoOf(tokens, ages, lang, asked), duration: durationOf(tokens, ages, asked), severity: severityOf(text, tokens, asked) };
  }

  /**
   * extractFacts(input, opts) -> {who, duration, severity} (null where unknown). Pure.
   *   input: the conversation text (one string) or the list of user messages (oldest first).
   *   opts.asked: for a list, asked[i] = the fact the bot asked right before message i
   *     ("who" | "duration" | "severity" | null); it lets short answers count ("7", "tare", "me").
   *   opts.base: facts already known (e.g. who from an earlier round); messages override them.
   * Merge: the answer to the question that was asked updates that fact; any other fact found in a
   * message only fills a gap, or replaces an older value when nothing specific was asked. A
   * first-person word ("I", "eu") never overrides an explicit who (e.g. "my son ... I think since
   * yesterday" stays child).
   */
  function extractFacts(input, opts) {
    opts = opts || {};
    var msgs = Array.isArray(input) ? input : [input];
    var asked = Array.isArray(opts.asked) ? opts.asked : (typeof opts.asked === "string" ? [opts.asked] : []);
    var base = opts.base || {}, cur = {}, strength = {};
    FACT_IDS.forEach(function (id) {
      cur[id] = validFact(id, base[id]);
      strength[id] = cur[id] ? 2 : 0;
    });
    for (var i = 0; i < msgs.length; i++) {
      if (typeof msgs[i] !== "string" || !msgs[i]) continue;
      var a = FACT_IDS.indexOf(asked[i]) >= 0 ? asked[i] : null;
      var f = factsOfMessage(msgs[i], a);
      FACT_IDS.forEach(function (id) {
        var v = f[id], s = 2;
        if (id === "who" && v) { s = v.strength; v = v.value; }
        if (!v) return;
        if (cur[id] == null || id === a || (!a && s >= strength[id])) {
          if (id === "who" && cur[id] && s < strength[id]) return;
          cur[id] = v; strength[id] = Math.max(s, id === a ? 2 : s);
        }
      });
    }
    return { who: cur.who, duration: cur.duration, severity: cur.severity };
  }

  // ------------------------------------------------------------------ confidence score (0-100)
  /*
   * CONFIDENCE = "how well the information provided matches this TYPE of specialist".
   * It is NOT the probability of a disease and never a diagnosis. Display bands (confidenceLabel):
   *   Low < 40, Medium 40-69, High >= 70.
   *
   * Evidence. Each matched SYMPTOM_RULE is worth eff = weight x SPEC_MULT[rule.specificity]
   *   (strong 1.6, specific 1.4, moderate 1.0, general 0.7; set in data/symptoms.js). Every keyword
   *   hit of a rule is located in the text (token spans) and the hits are grouped into CONCEPTS:
   *   hits that share words, or sit next to each other (gap <= 2 tokens, only prepositions such as
   *   "pe" / "on" / "my" in between) when one of the two rules is a weight <= 2 qualifier rule
   *   ("erupții pe piele", "itchy skin"), describe ONE complaint. So RO and EN phrasings of the same
   *   complaint score alike. In text order, a concept that brings a new rule counts with the best
   *   eff of its new rules; a concept made only of rules already counted (a 2nd keyword of the same
   *   rule, e.g. "heartburn and bloating") is an EXTRA hit worth half (eff x 0.5). Specialties of the
   *   same body system (RELATED_GROUPS) lend half of their evidence as support (never a conflict).
   *
   * Score (E = the summed concept evidence; + 3 for a child's Pediatrics entry):
   *     base       65 x (1 - e^(-E/6))                   saturating: diminishing returns
   *   + match      +8 when at least one symptom rule matched
   *   + specific   +8 for a "specific" term, or +20 for a "strong" one (a single strong term such as
   *                "însărcinată" / "pietre la rinichi" / "blurry vision" reaches ~70 = High on its own)
   *   + support    +12 / +8 / +5 for the 2nd / 3rd / 4th concept, +6 / +4 / +2 for extra hits
   *   - conflict   30 x ratio, ratio = (strongest competitor's E x rel) / E, capped at 1, applied when
   *                >= 0.15. Competitor evidence whose words overlap the top's own evidence is ignored
   *                ("swollen ankles" for Cardiology does not count for Orthopedics). rel = 1 for another
   *                body system, 0.5 when the competitor has only "general" evidence, 0.35 for a
   *                generalist (GP / Internal Medicine) with non-general evidence or a child's
   *                Pediatrics entry; a generalist with only general evidence is ignored, and a top
   *                that IS a generalist gets no conflict penalty.
   *   - vague      -6 when every matched rule is "general" (or no symptom matched at all);
   *                -5 more for a single-word text without a specific/strong term
   *   + follow-up  +2 who (only when the user answered it / it was supplied as an answer, not when
   *                inferred from "I" / "mă"), +4 duration known, +3 severity known
   *   then the caps: a remapped specialty (originalSpecialty set) <= 69 (never High), clamp to
   *   [10, 95] (never 100%: we never fake certainty), rounded to an int; a lower-ranked suggestion is
   *   never above the one before it.
   * Pediatrics for a child: its evidence = every matched symptom rule (grouped into concepts) + the
   *   child itself (3) and it has no conflict penalty (a pediatrician sees all complaints).
   * GP fallback after MAX_TURNS with nothing matched: 20 (Low).
   * Mixed complaints (3+ unrelated body systems, none High, adult): GP goes first with
   *   max(MIXED_MIN, min(MIXED_MAX, the top specialist's score)) and the factor
   *   kind "conflict" labelled "mixed" (the complaints point in different directions; no extra penalty).
   * AI mode: each Kimi suggestion is re-scored from the LOCAL rules on the same conversation text
   *   (rateSuggestions); a specialty with no local evidence gets min(45, High 45 / Medium 40 / Low 25)
   *   and the factor "Based on the AI's reading of your description"; the list is re-sorted by score.
   * Output per suggestion: score (raw rule sum, kept for compatibility), confidenceScore (int 0-100),
   *   confidence ("Low"|"Medium"|"High"), confidenceFactors [{kind, label}] with kind one of
   *   match | specific | support | conflict | vague | followup | remap (labels in the reply language).
   */
  var CONF_CFG = { BASE_MAX: 65, BASE_K: 6, MATCH: 8, SPECIFIC: 8, STRONG: 20, SUPPORT: [0, 12, 8, 5], EXTRA: [6, 4, 2],
    EXTRA_EFF: 0.5, CONFLICT: 30, CONFLICT_MIN: 0.15, REL_GENERALIST: 0.35, REL_GENERAL_ONLY: 0.5, RELATED_SUPPORT: 0.5,
    ADJ_GAP: 2, ADJ_MAX_W: 2, VAGUE: 6, SHORT: 5, SHORT_WORDS: 1,
    FOLLOW: { who: 2, duration: 4, severity: 3 }, CHILD_W: 3, REMAP_CAP: 69, LLM_CAP: 45,
    LLM_NO_LOCAL: { High: 45, Medium: 40, Low: 25 }, FALLBACK: 20, MIXED_N: 3, MIXED_MIN: 40, MIXED_MAX: 60, MIN: 10, MAX: 95, MEDIUM: 40, HIGH: 70 };
  var SPEC_MULT = { strong: 1.6, specific: 1.4, moderate: 1.0, general: 0.7 };
  var GENERALISTS = toSet([GP, "Family Medicine", "Internal Medicine"]);
  var RELATED_GROUPS = [["Orthopedics", "Rheumatology", "Sports Medicine", "Pediatric Orthopedics"],
    ["ENT (Otorhinolaryngology)", "Pulmonology"], ["Gastroenterology", "General Surgery"], ["Urology", "Nephrology"],
    ["Psychiatry", "Psychology"], [GP, "Internal Medicine"], ["Endocrinology", "Internal Medicine"]];
  var ADJ_WORDS = toSet(["pe", "in", "la", "de", "din", "pentru", "on", "of", "at", "my", "the", "a", "al", "ale", "mea",
    "meu", "mele", "mei", "your", "around", "near"]);
  var FACTOR_TEXT = {
    match: { en: "Your description matches what this specialist usually handles", ro: "Descrierea se potrivește cu ce tratează de obicei acest specialist" },
    specific: { en: "A symptom you mentioned points clearly to this specialist", ro: "Un simptom menționat indică clar acest specialist" },
    support: { en: "Several related symptoms point to this specialist", ro: "Mai multe simptome înrudite indică acest specialist" },
    conflict: { en: "Your symptoms also fit another specialist", ro: "Simptomele se potrivesc și cu alt specialist" },
    vague: { en: "Only general symptoms so far", ro: "Deocamdată doar simptome generale" },
    short: { en: "The description is very short", ro: "Descrierea este foarte scurtă" },
    followup: { en: "Your answers (who, how long, how strong) add useful context", ro: "Răspunsurile dumneavoastră (pentru cine, de cât timp, cât de puternic) adaugă context util" },
    child: { en: "It is for a child, so a pediatrician is a good first stop", ro: "Este pentru un copil, deci medicul pediatru este un prim pas potrivit" },
    remap: { en: "The ideal specialist is not in this list, so this is the closest option", ro: "Specialistul ideal nu este în această listă, deci aceasta este cea mai apropiată opțiune" },
    ai: { en: "Based on the AI's reading of your description", ro: "Pe baza interpretării AI a descrierii dumneavoastră" },
    fallback: { en: "Your symptoms are hard to place, so a family doctor is a safe first step", ro: "Simptomele sunt greu de încadrat, deci medicul de familie este un prim pas sigur" },
    mixed: { en: "Several unrelated complaints: a family doctor can look at them together first", ro: "Mai multe probleme fără legătură: medicul de familie le poate evalua întâi împreună" }
  };
  function factor(kind, key, lang) { return { kind: kind, label: pick(FACTOR_TEXT[key || kind], lang) }; }
  function confidenceLabel(score) { return score >= CONF_CFG.HIGH ? "High" : (score >= CONF_CFG.MEDIUM ? "Medium" : "Low"); }
  function clampScore(x) { return Math.round(Math.max(CONF_CFG.MIN, Math.min(CONF_CFG.MAX, x))); }
  function ruleSpecificity(rule) {
    return has(SPEC_MULT, rule.specificity) ? rule.specificity : (rule.weight >= 4 ? "specific" : (rule.weight >= 3 ? "moderate" : "general"));
  }
  function overlaps(a, b) { return a[0] <= b[1] && b[0] <= a[1]; }
  function related(a, b) {
    a = canonSpecialty(a); b = canonSpecialty(b);
    for (var i = 0; i < RELATED_GROUPS.length; i++) if (RELATED_GROUPS[i].indexOf(a) >= 0 && RELATED_GROUPS[i].indexOf(b) >= 0) return true;
    return false;
  }
  /** Evidence item of a matched rule: every (merged) keyword hit span is kept. */
  function evidenceItem(rule, idx, spans) {
    var spec = ruleSpecificity(rule);
    return { rule: idx, w: rule.weight, spec: spec, eff: rule.weight * SPEC_MULT[spec], spans: spans };
  }

  /**
   * Groups the hits of `items` into concepts (see the block above). Returns
   * { E, concepts, extras, specific, strong, allGeneral } (specific/strong only from own, non-related items).
   */
  function conceptStats(items, tokens) {
    var C = CONF_CFG, hits = [], i, j;
    items.forEach(function (it, ii) { it.spans.forEach(function (sp) { hits.push({ ii: ii, sp: sp }); }); });
    hits.sort(function (a, b) { return a.sp[0] - b.sp[0] || a.sp[1] - b.sp[1]; });
    var parent = hits.map(function (x, n) { return n; });
    function find(n) { while (parent[n] !== n) n = parent[n] = parent[parent[n]]; return n; }
    function joins(x, y) {
      if (overlaps(x.sp, y.sp)) return true;
      var ix = items[x.ii], iy = items[y.ii];
      if (x.ii === y.ii || ix.rel || iy.rel || Math.min(ix.w, iy.w) > C.ADJ_MAX_W) return false;
      var first = x.sp[0] <= y.sp[0] ? x.sp : y.sp, second = first === x.sp ? y.sp : x.sp;
      var gap = tokens.slice(first[1] + 1, second[0]);
      if (second[0] <= first[1] || gap.length > C.ADJ_GAP) return false;
      for (var g = 0; g < gap.length; g++) if (!has(ADJ_WORDS, gap[g])) return false;
      return true;
    }
    for (i = 0; i < hits.length; i++) for (j = i + 1; j < hits.length; j++) if (joins(hits[i], hits[j])) parent[find(j)] = find(i);
    var groups = [], byRoot = {};
    for (i = 0; i < hits.length; i++) {
      var r = find(i);
      if (!has(byRoot, r)) { byRoot[r] = { start: hits[i].sp[0], items: [] }; groups.push(byRoot[r]); }
      if (byRoot[r].items.indexOf(hits[i].ii) < 0) byRoot[r].items.push(hits[i].ii);
    }
    groups.sort(function (a, b) { return a.start - b.start; });
    var seen = {}, out = { E: 0, concepts: 0, extras: 0, specific: false, strong: false, allGeneral: true };
    groups.forEach(function (g) {
      var bestNew = -1, bestAny = 0;
      g.items.forEach(function (ii) {
        bestAny = Math.max(bestAny, items[ii].eff);
        if (!seen[ii]) bestNew = Math.max(bestNew, items[ii].eff);
      });
      if (bestNew >= 0) { out.E += bestNew; out.concepts++; }
      else { out.E += bestAny * C.EXTRA_EFF; out.extras++; }
      g.items.forEach(function (ii) { seen[ii] = true; });
    });
    items.forEach(function (it) {
      if (it.spec !== "general") out.allGeneral = false;
      if (it.rel) return;
      if (it.spec === "strong") out.strong = true;
      if (it.spec === "specific") out.specific = true;
    });
    return out;
  }

  /**
   * Confidence of one specialty entry. acc = all specialty entries of this message (for support and
   * conflict); ctx = { lang, words, tokens, facts: {who, duration, severity}, whoExplicit }.
   * Returns { score (int), factors: [{kind, label}] }.
   */
  function confidenceOf(name, acc, ctx) {
    var C = CONF_CFG, e = acc[name], lang = ctx.lang, tokens = ctx.tokens || [], factors = [], i, k;
    var own = e.ev.filter(function (x) { return !x.child; }), isChildEntry = e.ev.some(function (x) { return x.child; });
    var items = own.slice();
    if (!e.pediatric) {
      for (k in acc) {                                   // related specialties lend support
        if (!has(acc, k) || k === name || !related(name, k)) continue;
        acc[k].ev.forEach(function (x) {
          if (!x.child) items.push({ rule: x.rule, w: x.w, spec: x.spec, eff: x.eff * C.RELATED_SUPPORT, spans: x.spans, rel: true });
        });
      }
    }
    var st = conceptStats(items, tokens);
    var E = st.E + (isChildEntry ? C.CHILD_W : 0);
    if (!own.length) st.allGeneral = true;               // no symptom at all (e.g. "my child is sick")
    var score = C.BASE_MAX * (1 - Math.exp(-E / C.BASE_K));
    if (own.length) { score += C.MATCH; factors.push(factor("match", null, lang)); }
    if (e.pediatric) factors.push(factor("followup", "child", lang));
    if (st.strong) { score += C.STRONG; factors.push(factor("specific", null, lang)); }
    else if (st.specific) { score += C.SPECIFIC; factors.push(factor("specific", null, lang)); }
    var sup = 0;
    for (i = 1; i < st.concepts && i < C.SUPPORT.length; i++) sup += C.SUPPORT[i];
    for (i = 0; i < st.extras && i < C.EXTRA.length; i++) sup += C.EXTRA[i];
    if (sup) { score += sup; factors.push(factor("support", null, lang)); }
    if (!e.pediatric && !GENERALISTS[name] && E > 0) {
      var ownSpans = [];
      own.forEach(function (x) { ownSpans = ownSpans.concat(x.spans); });
      var worst = 0;
      for (k in acc) {
        if (!has(acc, k) || k === name || related(name, k)) continue;
        var comp = acc[k].ev.filter(function (x) {
          return !x.child && !x.spans.some(function (sp) { return ownSpans.some(function (o) { return overlaps(o, sp); }); });
        });
        if (!comp.length) continue;
        var cs = conceptStats(comp, tokens), rel;
        if (GENERALISTS[k]) { if (cs.allGeneral) continue; rel = C.REL_GENERALIST; }
        else if (acc[k].pediatric) rel = C.REL_GENERALIST;
        else rel = cs.allGeneral ? C.REL_GENERAL_ONLY : 1;
        worst = Math.max(worst, cs.E * rel / E);
      }
      worst = Math.min(1, worst);
      if (worst >= C.CONFLICT_MIN) { score -= C.CONFLICT * worst; factors.push(factor("conflict", null, lang)); }
    }
    if (st.allGeneral) { score -= C.VAGUE; factors.push(factor("vague", null, lang)); }
    if (!st.specific && !st.strong && ctx.words <= C.SHORT_WORDS) { score -= C.SHORT; factors.push(factor("vague", "short", lang)); }
    var facts = ctx.facts || {}, fb = 0;
    if (facts.who && ctx.whoExplicit) fb += C.FOLLOW.who;
    if (facts.duration) fb += C.FOLLOW.duration;
    if (facts.severity) fb += C.FOLLOW.severity;
    if (fb) { score += fb; factors.push(factor("followup", null, lang)); }
    if (e.origin) { score = Math.min(score, C.REMAP_CAP); factors.push(factor("remap", null, lang)); }
    return { score: clampScore(score), factors: factors };
  }

  /** Writes confidenceScore / confidence / confidenceFactors on a suggestion. */
  function setConfidence(sug, score, factors) {
    sug.confidenceScore = score;
    sug.confidence = confidenceLabel(score);
    sug.confidenceFactors = factors;
    return sug;
  }

  /**
   * Rule evidence of one message: { acc: {specialty: entry}, order: [specialty], symptomTop }.
   * entry = { score (raw sum of weights), direct, best (reason), bestW, origin (remapped from), urgent,
   *           ev: [{rule, w, spec, eff, spans}], pediatric? }.
   */
  function gatherEvidence(tokens, isChild, avail) {
    var reasons = reasonsMap(), acc = {}, order = [], all = [];
    function entry(bestW, best) { return { score: 0, direct: 0, best: best || null, bestW: bestW, origin: null, urgent: [], ev: [] }; }
    var rs = rules();
    for (var i = 0; i < rs.length; i++) {
      var rule = rs[i];
      var spans = allSpans(tokens, rule.keywords);
      if (!spans.length) continue;
      var target = resolveSpecialty(rule.specialty, avail);
      if (!target) continue;
      if (!acc[target]) { acc[target] = entry(-1); order.push(target); }
      var a = acc[target], remapped = !sameSpecialty(target, rule.specialty);
      a.score += rule.weight;
      if (!remapped) a.direct += rule.weight;
      // The strongest matched rule decides the reason; on a tie a direct rule wins.
      if (rule.weight > a.bestW || (rule.weight === a.bestW && !remapped && a.origin)) {
        a.bestW = rule.weight;
        a.origin = remapped ? rule.specialty : null;
        a.best = remapped ? (reasons[canonSpecialty(target)] || reasons[target] || rule.reason) : rule.reason;
      }
      if (rule.urgent) a.urgent.push(rule.urgent);
      var item = evidenceItem(rule, i, spans);
      a.ev.push(item);
      all.push(item);
    }

    // Child adjustments.
    var symptomTop = 0;
    for (var k = 0; k < order.length; k++) symptomTop = Math.max(symptomTop, acc[order[k]].score);
    if (isChild) {
      if (acc["Orthopedics"] && has(avail, "Pediatric Orthopedics")) {
        var po = acc["Pediatric Orthopedics"] || (order.push("Pediatric Orthopedics"),
          acc["Pediatric Orthopedics"] = entry(0, reasons["Pediatric Orthopedics"]));
        po.score += acc["Orthopedics"].score; po.direct += acc["Orthopedics"].score;
        po.ev = po.ev.concat(acc["Orthopedics"].ev);
        delete acc["Orthopedics"];
      }
      var ped = resolveSpecialty("Pediatrics", avail);
      Object.keys(acc).forEach(function (s) { if (GENERALISTS[canonSpecialty(s)] && s !== ped) delete acc[s]; });
      if (ped) {
        var pedEntry = acc[ped] || (order.push(ped), acc[ped] = entry(0));
        pedEntry.score = Math.max(symptomTop + 1, 4);
        pedEntry.best = reasons["Pediatrics"];
        pedEntry.pediatric = true;
        pedEntry.origin = ped !== "Pediatrics" ? "Pediatrics" : null;
        if (ped !== "Pediatrics") pedEntry.best = reasons[canonSpecialty(ped)] || reasons[ped] || pedEntry.best;
        // A pediatrician sees every complaint of a child: all symptom evidence + the child itself.
        pedEntry.ev = all.concat([{ rule: -1, w: CONF_CFG.CHILD_W, spec: "moderate", eff: CONF_CFG.CHILD_W, spans: [], child: true }]);
      }
    }
    return { acc: acc, order: order, symptomTop: symptomTop };
  }

  /**
   * AI mode: re-scores model suggestions with the LOCAL rule evidence of the same conversation and
   * re-sorts them by confidenceScore (stable), so a no-evidence suggestion never sits above a
   * locally supported one. ctx = { text: the user's messages, answers: {who, duration, severity} }.
   * Mutates and returns `suggestions`.
   */
  function rateSuggestions(suggestions, ctx, availableSpecialties, lang) {
    ctx = ctx || {};
    var text = typeof ctx.text === "string" ? ctx.text : "";
    var tokens = tokenize(text), avail = resolveAvail(availableSpecialties);
    var found = text ? extractFacts(text) : emptyFacts(), answers = ctx.answers || {};
    var facts = {};
    FACT_IDS.forEach(function (id) { facts[id] = validFact(id, answers[id]) || found[id]; });
    var ev = gatherEvidence(tokens, facts.who === "child", avail);
    var cctx = { lang: lang, words: tokens.length, tokens: tokens, facts: facts, whoExplicit: !!validFact("who", answers.who) };
    var list = suggestions || [];
    list.forEach(function (s, n) {
      var e = ev.acc[s.specialty];
      s._n = n;
      if (e && e.ev.length) {
        var c = confidenceOf(s.specialty, ev.acc, cctx);
        setConfidence(s, c.score, c.factors);
      } else {
        var kimi = CONF_CFG.LLM_NO_LOCAL[s.confidence] || CONF_CFG.LLM_NO_LOCAL.Low;
        setConfidence(s, Math.min(CONF_CFG.LLM_CAP, kimi), [factor("match", "ai", lang)]);
      }
    });
    list.sort(function (a, b) { return b.confidenceScore - a.confidenceScore || a._n - b._n; });
    list.forEach(function (s) { delete s._n; });
    return list;
  }


  function baseResult(lang) {
    return { lang: lang, redFlag: false, redFlagReason: null, suggestions: [], followUp: null,
             urgencyNote: null, disclaimer: pick(T.DISCLAIMER, lang) };
  }

  /** A fact question (who/duration/severity) in natural language, with optional answer chips. */
  function makeFollowUp(id, lang, ctx) {
    ctx = ctx || {};
    var f = FOLLOWUPS[id][lang] || FOLLOWUPS[id].en;
    var q = ctx.who === "child" && f.qChild ? f.qChild : f.q;
    return { id: id, question: (ctx.hint ? pick(T.Q_HINT, lang) + " " : "") + q,
             options: f.o.map(function (o) { return { value: o[0], label: o[1] }; }) };
  }
  /** Open question about the symptom; n = how many were asked before in this round. No chips. */
  function makeClarify(lang, n) {
    var list = CLARIFY_Q[lang] || CLARIFY_Q.en;
    return { id: "clarify", question: list[(n || 0) % list.length], options: [] };
  }

  function emergencyResult(rule, lang) {
    var r = baseResult(lang);
    r.redFlag = true;
    r.redFlagReason = pick(rule.reason, lang) || pick(T.EMERGENCY, lang);
    r.urgencyNote = pick(T.EMERGENCY, lang);
    return r;
  }

  // ------------------------------------------------------------------ analyze
  function analyze(text, answers, availableSpecialties) {
    answers = answers || {};
    text = text == null ? "" : String(text);
    var lang = detectLanguage(text);
    var tokens = tokenize(text);

    // 1. Red flags ALWAYS first.
    var rf = checkRedFlags(tokens);
    if (rf) return emergencyResult(rf, lang);

    var result = baseResult(lang);
    var avail = resolveAvail(availableSpecialties);
    // turn = user messages in this round (1 when unknown); asked = questions already asked in it.
    var turn = Math.max(1, Math.floor(+answers.turn) || 1);
    var asked = Array.isArray(answers.asked) ? answers.asked : [];
    var canAsk = turn < MAX_TURNS;

    // 2. Context: explicit answers win, otherwise what extractFacts() finds in the text.
    var found = extractFacts(text);
    var who = validFact("who", answers.who) || found.who;
    var isChild = who === "child";
    var duration = validFact("duration", answers.duration) || found.duration;
    var severity = validFact("severity", answers.severity) || found.severity;
    result.context = { who: who, duration: duration, severity: severity };

    // 3. Score rules (+ 4. child adjustments) -> evidence per specialty.
    var urgentNotes = [];
    var ev = gatherEvidence(tokens, isChild, avail);
    var acc = ev.acc, order = ev.order, symptomTop = ev.symptomTop;
    // The who-bonus only counts an explicit answer (supplied in answers / answered when asked), not "I" / "mă".
    var whoExplicit = has(answers, "explicitWho") ? !!answers.explicitWho : !!validFact("who", answers.who);
    var cctx = { lang: lang, words: tokens.length, tokens: tokens, facts: { who: who, duration: duration, severity: severity },
      whoExplicit: whoExplicit };

    var list = [];
    for (var o = 0; o < order.length; o++) {
      var name = order[o], e = acc[name];
      if (!e || e.score < MIN_SCORE) continue;
      list.push({ name: name, e: e, idx: o });
    }
    list.sort(function (x, y) {
      if (!!y.e.pediatric !== !!x.e.pediatric) return y.e.pediatric ? 1 : -1;
      return y.e.score - x.e.score || x.idx - y.idx;
    });
    list = list.slice(0, 3);

    // 5. Nothing matched: open question about the symptom, until turn 5.
    if (!list.length) {
      if (canAsk) {
        result.followUp = makeClarify(lang, asked.filter(function (a) { return a === "clarify"; }).length);
        return result;
      }
      var fm = resolveSpecialty(GP, avail);
      if (fm) {
        var sug = setConfidence({ specialty: fm, reason: pick(T.FALLBACK_REASON, lang), score: 0 }, CONF_CFG.FALLBACK,
          [factor("vague", "fallback", lang)]);
        if (!sameSpecialty(fm, GP)) { sug.originalSpecialty = GP; sug.note = remapNote(GP, fm, lang); }
        result.suggestions.push(sug);
      }
      addUrgency(result, [], severity, duration, lang);
      return result;
    }

    // 6. Build suggestions.
    var prevScore = CONF_CFG.MAX;
    for (var s = 0; s < list.length; s++) {
      var cur = list[s], c = confidenceOf(cur.name, acc, cctx);
      var cs = Math.min(c.score, prevScore);              // never above the suggestion before it
      prevScore = cs;
      var out = setConfidence({ specialty: cur.name, reason: pick(cur.e.best, lang), score: cur.e.score }, cs, c.factors);
      if (cur.e.origin) {
        out.originalSpecialty = cur.e.origin;
        out.note = remapNote(cur.e.origin, cur.name, lang);
      }
      result.suggestions.push(out);
      for (var u = 0; u < cur.e.urgent.length; u++) {
        var un = pick(cur.e.urgent[u], lang);
        if (urgentNotes.indexOf(un) < 0) urgentNotes.push(un);
      }
    }
    if (!isChild) mixedComplaints(result, acc, avail, lang);
    addUrgency(result, urgentNotes, severity, duration, lang);

    // 7. One natural question for the first missing fact (each fact is asked at most once per round).
    if (canAsk) {
      var known = { who: who, duration: duration, severity: severity };
      var firstQ = !FACT_IDS.some(function (id) { return asked.indexOf(id) >= 0; });
      for (var fi = 0; fi < FACT_IDS.length; fi++) {
        var id = FACT_IDS[fi];
        if (known[id] || asked.indexOf(id) >= 0) continue;
        result.followUp = makeFollowUp(id, lang, { who: who, hint: firstQ });
        break;
      }
    }
    return result;
  }

  /**
   * Several unrelated complaints (MIXED_N+ body systems whose evidence does not overlap, none of them
   * High): the family doctor is the sensible first contact, so GP goes first. The specialists stay
   * after it (at most 3 suggestions, never more confident than GP). Mutates result.suggestions.
   */
  function mixedComplaints(result, acc, avail, lang) {
    var C = CONF_CFG, sugs = result.suggestions, gp = resolveSpecialty(GP, avail);
    if (!gp || !sugs.length || sugs[0].confidenceScore >= C.HIGH) return;
    var picked = [], spans = [];
    Object.keys(acc).sort(function (a, b) { return acc[b].score - acc[a].score; }).forEach(function (k) {
      var e = acc[k];
      if (GENERALISTS[canonSpecialty(k)] || e.pediatric || e.score < MIN_SCORE) return;
      if (picked.some(function (p) { return related(p, k); })) return;
      var own = [];
      e.ev.forEach(function (x) { own = own.concat(x.spans); });
      if (own.some(function (sp) { return spans.some(function (o) { return overlaps(o, sp); }); })) return;
      picked.push(k); spans = spans.concat(own);
    });
    if (picked.length < C.MIXED_N) return;
    var score = clampScore(Math.max(C.MIXED_MIN, Math.min(C.MIXED_MAX, sugs[0].confidenceScore)));
    var gpSug = setConfidence({ specialty: gp, reason: pick(T.MIXED_REASON, lang), score: sugs[0].score },
      score, [factor("conflict", "mixed", lang)]);
    if (!sameSpecialty(gp, GP)) { gpSug.originalSpecialty = GP; gpSug.note = remapNote(GP, gp, lang); }
    var rest = sugs.filter(function (s) { return s.specialty !== gp; }).slice(0, 2);
    rest.forEach(function (s) { if (s.confidenceScore > score) setConfidence(s, score, s.confidenceFactors); });
    result.suggestions = [gpSug].concat(rest);
  }

  /**
   * One rule-mode turn for a whole round of the conversation.
   *   userMessages: the user's messages in this round (oldest first; at most 10 are needed).
   *   asked: asked[i] = what the bot asked right before userMessages[i] ("who" | "duration" |
   *          "severity" | "clarify" | null).
   *   opts.base: facts carried over (e.g. who from an earlier round).
   * Returns analyze()'s result plus result.facts (the merged facts) and result.turn.
   */
  function converse(userMessages, asked, availableSpecialties, opts) {
    var msgs = (userMessages || []).filter(function (m) { return typeof m === "string" && m; });
    asked = Array.isArray(asked) ? asked : [];
    var facts = extractFacts(msgs, { asked: asked, base: opts && opts.base });
    var explicitWho = !!facts.who && (asked.indexOf("who") >= 0 || !!validFact("who", opts && opts.base && opts.base.who));
    var res = analyze(msgs.join("\n"), { who: facts.who, duration: facts.duration, severity: facts.severity,
      turn: msgs.length, asked: asked.filter(Boolean), explicitWho: explicitWho }, availableSpecialties);
    res.facts = facts;
    res.turn = msgs.length;
    return res;
  }

  /** "thanks" / "mulțumesc" / "ok" alone (no symptom): a closing remark after a recommendation. */
  function isThanks(text) {
    var t = tokenize(text);
    if (!t.length || t.length > 6) return false;
    var rest = blank(t, ["thank you", "thanks", "thx", "ty", "multumesc", "mersi", "multumim", "ms", "ok", "okay", "great",
      "super", "perfect", "bine", "foarte", "mult", "very", "much", "so", "a", "lot", "frumos", "va", "iti", "that", "helps", "cool"]);
    return rest.every(function (x) { return x === "_"; }) && hasAny(t, ["thank", "thanks", "thank you", "thx", "multumesc", "mersi", "multumim", "ms"]);
  }

  function addUrgency(result, notes, severity, duration, lang) {
    notes = notes.slice();
    if (severity === "severe") notes.push(pick(T.SEVERE, lang));
    if (duration === "gt2w") notes.push(pick(T.LONG, lang));
    result.urgencyNote = notes.length ? notes.join(" ") : null;
  }

  // ------------------------------------------------------------------ AI chat mode (Kimi via the proxy)
  var CONF_OK = { high: "High", medium: "Medium", low: "Low" };

  /** Local emergency check for a text. Returns the emergency result, or null. Never uses the network. */
  function checkRedFlagText(text) {
    var rf = checkRedFlags(tokenize(text));
    return rf ? emergencyResult(rf, detectLanguage(text)) : null;
  }

  function str(v, max) {
    if (typeof v !== "string") return null;
    v = v.replace(/^\s+|\s+$/g, "");
    return v ? v.slice(0, max) : null;
  }

  // ---- Output safety filter. Mirrors sanitize_reply() in server/proxy.py (defense in depth); the regex table is shared.
  // >>> generated safety patterns (identical table in server/proxy.py; regenerate both together)
  var SAFETY_PATTERNS = {
    DOSE: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii)(?:[\\s-]+(?:and\\s+|[șşs]i\\s+)?(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii))*\\s*(?:x\\s*)?(?:mgs?|milligrams?|miligram(?:e|i)?|mcg|micrograms?|µg|ug|g|grams?|gram(?:e|i)?|ml|mls|millilit(?:er|re)s?|mililit(?:ri|ru)|ui|iu|units?|unit[ăa][țţt]i|pic[ăa]tur[iă]|drops?|tablets?|tabs?|pills?|capsules?|caps|comprimat(?:e)?|pastil[ăae]|capsul[ăe]|plicuri|plic|sachets?|puffs?|pufuri|(?:tea|table)?spoons?(?:ful)?|linguri[țţ][ăae]|lingur[ăi]|doses?|doz[ăe])(?![\\wăâîșşțţĂÂÎȘŞȚŢ])", "i"],
    NXN: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])\\d+\\s*[x×*]\\s*\\d+(?![\\wăâîșşțţĂÂÎȘŞȚŢ])", "i"],
    FREQ: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])every\\s+(?:other\\s+)?(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii)(?:[\\s-]+(?:and\\s+|[șşs]i\\s+)?(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii))*\\s*(?:(?:-|to|or)\\s*(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii)(?:[\\s-]+(?:and\\s+|[șşs]i\\s+)?(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii))*\\s*)?(?:hours?|hrs?|h|days?)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])every\\s+(?:hour|few\\s+hours)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:once|twice|thrice|(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii)(?:[\\s-]+(?:and\\s+|[șşs]i\\s+)?(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii))*\\s*(?:x|times?))\\s*(?:a|per|/|each|every)?\\s*(?:day|daily|d|night|nightly)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:x|times?)\\s*/\\s*(?:day|zi|d)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])de\\s+(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii)(?:[\\s-]+(?:and\\s+|[șşs]i\\s+)?(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii))*\\s+ori\\s*(?:pe|/|la|într-o|intr-o)?\\s*(?:zi|zilnic|noapte|24)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])o\\s+dat[ăa]\\s+(?:pe|la)\\s+(?:zi|noapte|(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii)(?:[\\s-]+(?:and\\s+|[șşs]i\\s+)?(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii))*\\s+ore)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])|\\d\\s*/\\s*(?:zi|day|d)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])la\\s+(?:fiecare\\s+)?(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii)(?:[\\s-]+(?:and\\s+|[șşs]i\\s+)?(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii))*\\s*(?:ore|or[ăa]|h)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])", "i"],
    FREQ_SOFT: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:daily|zilnic|a\\s+day|per\\s+day|pe\\s+zi|each\\s+day|every\\s+day|at\\s+night|seara|diminea[țţ]a|weekly|(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii)(?:[\\s-]+(?:and\\s+|[șşs]i\\s+)?(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii))*\\s*times?\\s*(?:a|per)\\s*week)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])", "i"],
    NUMBER: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:\\d+(?:[.,]\\d+)*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|unu|una|doi|dou[ăa]|trei|patru|cinci|[șşs]ase|[șşs]apte|opt|nou[ăa]|zece|sut[ăa]|sute|mie|mii)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])", "i"],
    DRUG: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:paracetamol|acetaminophen|panadol|tylenol|ibuprofen|nurofen|advil|aspirin[ăae]?|aspenter|algocalmin|metamizol|no-?spa|ketoprofen|ketonal|diclofenac|voltaren|xanax|alprazolam|diazepam|lorazepam|clonazepam|amoxicilin[ăa]?|amoxicillin|augmentin|azitromicin[ăa]?|azithromycin|ciprofloxacin[ăa]?|metformin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|lisinopril[\\wăâîșşțţĂÂÎȘŞȚŢ]*|enalapril[\\wăâîșşțţĂÂÎȘŞȚŢ]*|bisoprolol[\\wăâîșşțţĂÂÎȘŞȚŢ]*|atorvastatin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|statin[ăe]?s?|warfarin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|insulin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|antidepressants?|antidepresiv[\\wăâîșşțţĂÂÎȘŞȚŢ]*|antibiotic[\\wăâîșşțţĂÂÎȘŞȚŢ]*|tramadol|codein[\\wăâîșşțţĂÂÎȘŞȚŢ]*|morphine?|morfin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|prednison[\\wăâîșşțţĂÂÎȘŞȚŢ]*|omeprazol[\\wăâîșşțţĂÂÎȘŞȚŢ]*|salbutamol|ventolin|sertralin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|fluoxetin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|cetirizin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|loratadin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|zyrtec|aerius|levothyrox[\\wăâîșşțţĂÂÎȘŞȚŢ]*|euthyrox|melatonin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|antihistamin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|painkillers?|analgezic[\\wăâîșşțţĂÂÎȘŞȚŢ]*|sedatives?|steroids?)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])", "i"],
    MEDWORD: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:medicines?|medications?|meds|drugs?|pills?|tablets?|capsules?|syrup|sirop[\\wăâîșşțţĂÂÎȘŞȚŢ]*|drops|medicament[\\wăâîșşțţĂÂÎȘŞȚŢ]*|pastil[\\wăâîșşțţĂÂÎȘŞȚŢ]*|comprimat[\\wăâîșşțţĂÂÎȘŞȚŢ]*|capsul[\\wăâîșşțţĂÂÎȘŞȚŢ]*|pic[ăa]turi|tratament[\\wăâîșşțţĂÂÎȘŞȚŢ]*|supozitoare|suppositor[\\wăâîșşțţĂÂÎȘŞȚŢ]*|doses?|doz[ăae])(?![\\wăâîșşțţĂÂÎȘŞȚŢ])", "i"],
    TAKE: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:take|taking|lua[țţt]i|ia[țţt]i|administra[\\wăâîșşțţĂÂÎȘŞȚŢ]*)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])", "i"],
    HALF: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:half|quarter|jum[ăa]tate|sfert)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])[^.!?\\n]{0,30}?(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:tablet|pill|capsule|dose|pastil|comprimat|capsul|doz|plic|lingur|spoon)", "i"],
    GIVE: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:give|giving|administer[\\wăâîșşțţĂÂÎȘŞȚŢ]*|d[ăa]-?i|da[țţt]i-?i|administra[țţt]i|administreaz[ăa]|oferi[țţt]i-?i)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])", "i"],
    CHILD: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:child|children|kids?|bab(?:y|ies)|infants?|toddlers?|newborns?|sons?|daughters?|copil[\\wăâîșşțţĂÂÎȘŞȚŢ]*|copii|sugar[\\wăâîșşțţĂÂÎȘŞȚŢ]*|bebelu[\\wăâîșşțţĂÂÎȘŞȚŢ]*|nou-n[ăa]scut[\\wăâîșşțţĂÂÎȘŞȚŢ]*|fiul[\\wăâîșşțţĂÂÎȘŞȚŢ]*|fiic[\\wăâîșşțţĂÂÎȘŞȚŢ]*)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])", "i"],
    MEDCHANGE: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:stop|stopping|quit|quitting|come\\s+off|coming\\s+off|get\\s+off|discontinue|skip|skipping|halve|double|cut\\s+down\\s+on|wean\\s+off)\\s+(?:taking\\s+|using\\s+|with\\s+)?(?:(?:the|your|all|my|his|her|their)\\s+)?(?!(?:scratching|smoking|drinking|alcohol|coffee|caffeine|eating|exercising|exercise|running|worrying|picking|rubbing|touching|it|that|this|there|and|if|when|now|immediately|right|for|to|at|by|activity|activities|sports?|screens?|sugar|junk|wearing)(?![\\wăâîșşțţĂÂÎȘŞȚŢ]))[\\wăâîșşțţĂÂÎȘŞȚŢ]+|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:start|starting|change|changing|increase|increasing|reduce|reducing|lower|lowering|raise|adjust|switch)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])[^.!?\\n]{0,40}?(?:(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:medicines?|medications?|meds|drugs?|pills?|tablets?|capsules?|syrup|sirop[\\wăâîșşțţĂÂÎȘŞȚŢ]*|drops|medicament[\\wăâîșşțţĂÂÎȘŞȚŢ]*|pastil[\\wăâîșşțţĂÂÎȘŞȚŢ]*|comprimat[\\wăâîșşțţĂÂÎȘŞȚŢ]*|capsul[\\wăâîșşțţĂÂÎȘŞȚŢ]*|pic[ăa]turi|tratament[\\wăâîșşțţĂÂÎȘŞȚŢ]*|supozitoare|suppositor[\\wăâîșşțţĂÂÎȘŞȚŢ]*|doses?|doz[ăae])(?![\\wăâîșşțţĂÂÎȘŞȚŢ])|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:paracetamol|acetaminophen|panadol|tylenol|ibuprofen|nurofen|advil|aspirin[ăae]?|aspenter|algocalmin|metamizol|no-?spa|ketoprofen|ketonal|diclofenac|voltaren|xanax|alprazolam|diazepam|lorazepam|clonazepam|amoxicilin[ăa]?|amoxicillin|augmentin|azitromicin[ăa]?|azithromycin|ciprofloxacin[ăa]?|metformin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|lisinopril[\\wăâîșşțţĂÂÎȘŞȚŢ]*|enalapril[\\wăâîșşțţĂÂÎȘŞȚŢ]*|bisoprolol[\\wăâîșşțţĂÂÎȘŞȚŢ]*|atorvastatin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|statin[ăe]?s?|warfarin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|insulin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|antidepressants?|antidepresiv[\\wăâîșşțţĂÂÎȘŞȚŢ]*|antibiotic[\\wăâîșşțţĂÂÎȘŞȚŢ]*|tramadol|codein[\\wăâîșşțţĂÂÎȘŞȚŢ]*|morphine?|morfin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|prednison[\\wăâîșşțţĂÂÎȘŞȚŢ]*|omeprazol[\\wăâîșşțţĂÂÎȘŞȚŢ]*|salbutamol|ventolin|sertralin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|fluoxetin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|cetirizin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|loratadin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|zyrtec|aerius|levothyrox[\\wăâîșşțţĂÂÎȘŞȚŢ]*|euthyrox|melatonin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|antihistamin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|painkillers?|analgezic[\\wăâîșşțţĂÂÎȘŞȚŢ]*|sedatives?|steroids?)(?![\\wăâîșşțţĂÂÎȘŞȚŢ]))|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:nu\\s+mai\\s+lua[țţt]i|nu\\s+mai\\s+lua|opri[țţt]i|opre[șşs]te|renun[țţt]a[țţt]i(?:\\s+la)?|renun[țţt][ăa](?:\\s+la)?|[îi]ntrerupe[țţt]i|[îi]ntrerupe|sista[țţt]i|sisti[țţt]i)\\s+(?!(?:fumatul|alcoolul|cafeaua|sc[ăa]rpinatul|efortul|sportul|dulciurile|zah[ăa]rul|s[ăa]|dac[ăa]|imediat|acum)(?![\\wăâîșşțţĂÂÎȘŞȚŢ]))[\\wăâîșşțţĂÂÎȘŞȚŢ]+|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:schimba[țţt]i|schimb[ăa]|m[ăa]ri[țţt]i|cre[șşs]te[țţt]i|reduce[țţt]i|sc[ăa]de[țţt]i|ajusta[țţt]i)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])[^.!?\\n]{0,40}?(?:(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:medicines?|medications?|meds|drugs?|pills?|tablets?|capsules?|syrup|sirop[\\wăâîșşțţĂÂÎȘŞȚŢ]*|drops|medicament[\\wăâîșşțţĂÂÎȘŞȚŢ]*|pastil[\\wăâîșşțţĂÂÎȘŞȚŢ]*|comprimat[\\wăâîșşțţĂÂÎȘŞȚŢ]*|capsul[\\wăâîșşțţĂÂÎȘŞȚŢ]*|pic[ăa]turi|tratament[\\wăâîșşțţĂÂÎȘŞȚŢ]*|supozitoare|suppositor[\\wăâîșşțţĂÂÎȘŞȚŢ]*|doses?|doz[ăae])(?![\\wăâîșşțţĂÂÎȘŞȚŢ])|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:paracetamol|acetaminophen|panadol|tylenol|ibuprofen|nurofen|advil|aspirin[ăae]?|aspenter|algocalmin|metamizol|no-?spa|ketoprofen|ketonal|diclofenac|voltaren|xanax|alprazolam|diazepam|lorazepam|clonazepam|amoxicilin[ăa]?|amoxicillin|augmentin|azitromicin[ăa]?|azithromycin|ciprofloxacin[ăa]?|metformin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|lisinopril[\\wăâîșşțţĂÂÎȘŞȚŢ]*|enalapril[\\wăâîșşțţĂÂÎȘŞȚŢ]*|bisoprolol[\\wăâîșşțţĂÂÎȘŞȚŢ]*|atorvastatin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|statin[ăe]?s?|warfarin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|insulin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|antidepressants?|antidepresiv[\\wăâîșşțţĂÂÎȘŞȚŢ]*|antibiotic[\\wăâîșşțţĂÂÎȘŞȚŢ]*|tramadol|codein[\\wăâîșşțţĂÂÎȘŞȚŢ]*|morphine?|morfin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|prednison[\\wăâîșşțţĂÂÎȘŞȚŢ]*|omeprazol[\\wăâîșşțţĂÂÎȘŞȚŢ]*|salbutamol|ventolin|sertralin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|fluoxetin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|cetirizin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|loratadin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|zyrtec|aerius|levothyrox[\\wăâîșşțţĂÂÎȘŞȚŢ]*|euthyrox|melatonin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|antihistamin[\\wăâîșşțţĂÂÎȘŞȚŢ]*|painkillers?|analgezic[\\wăâîșşțţĂÂÎȘŞȚŢ]*|sedatives?|steroids?)(?![\\wăâîșşțţĂÂÎȘŞȚŢ]))", "i"],
    PHONE: ["\\+?\\d[\\d \\t().\\-/]{7,}\\d", "g"],
    PRICE: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])\\d+(?:[.,]\\d+)*\\s*(?:de\\s+)?(?:lei|ron|eur|euro|euros|dolari|dollars?|usd|gbp|pounds?)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:lei|ron|eur|usd)\\s*\\d|[$€£]\\s*\\d|\\d\\s*[$€£]", "i"],
    DOCTOR: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:[Dd][Rr]\\.?|[Dd]octor(?:ul|i[țţ]a)?|[Dd]octori[țţ]a|Prof\\.?|Profesor(?:ul)?|[Dd]omnul\\s+doctor|[Dd]oamna\\s+doctor)\\s+[A-ZĂÂÎȘŞȚŢ]|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])[Dd][Rr]\\.\\s*[a-zăâîșşțţ]{2,}|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])[Dd][Rr]\\s+[a-zăâîșşțţ]{3,}\\s+[a-zăâîșşțţ]{3,}", ""],
    MDLINK: ["\\[([^\\]]{0,100})\\]\\([^)]*\\)", "g"],
    URL: ["<?(?:https?://|www\\.)[^\\s<>]+>?", "gi"],
    NUM911: ["(?<!\\d)9[\\s.\\-/]?1[\\s.\\-/]?1(?!\\d)|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])nine[\\s-]+one[\\s-]+one(?![\\wăâîșşțţĂÂÎȘŞȚŢ])|(?<!\\d)(?:999|988)(?!\\d)", "gi"],
    CALLNUM: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(call|dial|ring|phone|text|contact|sun[ăa]|suna[țţt]i|apela[țţt]i|apeleaz[ăa]|forma[țţt]i|formeaz[ăa])(?![\\wăâîșşțţĂÂÎȘŞȚŢ])([^.!?\\n\\d]{0,25}?)(?<!\\d)(?:000|111|101|999|988|911)(?!\\d)", "gi"],
    EMERGENCY: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:112|emergency|emergencies|ambulance[\\wăâîșşțţĂÂÎȘŞȚŢ]*|ambulan[țţt][\\wăâîșşțţĂÂÎȘŞȚŢ]*|salvarea|smurd|urgen[țţt][ăaei][\\wăâîșşțţĂÂÎȘŞȚŢ]*)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])", "i"],
    EMERGENCY_NEG: ["(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])(?:not|no|isn'?t|nu(?:\\s+(?:este|e|pare|reprezint[ăa]))?)\\s+(?:(?:an?|o|really|likely|necessarily|neap[ăa]rat|chiar)\\s+){0,2}(?:emergency|urgen[țţt][\\wăâîșşțţĂÂÎȘŞȚŢ]*)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])non-?emergency(?![\\wăâîșşțţĂÂÎȘŞȚŢ])|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])no\\s+need\\s+to\\s+(?:call|dial|go\\s+to)\\s+(?:112|the\\s+(?:er|emergency\\s+room)|an?\\s+ambulance)(?![\\wăâîșşțţĂÂÎȘŞȚŢ])|(?<![\\wăâîșşțţĂÂÎȘŞȚŢ])nu\\s+(?:e|este)\\s+(?:nevoie|necesar)\\s+s[ăa]\\s+(?:suna[țţt]i|apela[țţt]i|merge[țţt]i)\\s+(?:la\\s+)?(?:112|urgen[\\wăâîșşțţĂÂÎȘŞȚŢ]*|ambulan[\\wăâîșşțţĂÂÎȘŞȚŢ]*|salvare[\\wăâîșşțţĂÂÎȘŞȚŢ]*)", "i"]
  };
  // <<< generated safety patterns
  var RX = {};
  Object.keys(SAFETY_PATTERNS).forEach(function (k) { RX[k] = new RegExp(SAFETY_PATTERNS[k][0], SAFETY_PATTERNS[k][1]); });
  function rx(k) { RX[k].lastIndex = 0; return RX[k]; }

  /** Text used for matching only: NFKC (fullwidth) + Arabic-Indic digits -> ASCII. */
  function norm(t) {
    t = String(t || "");
    if (typeof t.normalize === "function") t = t.normalize("NFKC");
    return t.replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x660); })
            .replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 0x6F0); });
  }
  function hasPhone(t) {
    var m = String(t).match(rx("PHONE")) || [];
    for (var i = 0; i < m.length; i++) if (m[i].replace(/\D/g, "").length >= 9) return true;
    return false;
  }
  function isMedicalUnsafe(t) {
    var n = norm(t);
    if (rx("DOSE").test(n) || rx("NXN").test(n) || rx("FREQ").test(n) || rx("HALF").test(n) || rx("MEDCHANGE").test(n)) return true;
    var drugish = rx("DRUG").test(n) || rx("MEDWORD").test(n) || rx("TAKE").test(n);
    if (rx("FREQ_SOFT").test(n) && drugish) return true;
    if (rx("DRUG").test(n) && (rx("NUMBER").test(n) || rx("FREQ_SOFT").test(n))) return true;
    if (rx("GIVE").test(n) && rx("CHILD").test(n) && (rx("DRUG").test(n) || rx("MEDWORD").test(n))) return true;
    return false;
  }
  function isInventedFact(t) { var n = norm(t); return hasPhone(n) || rx("PRICE").test(n) || rx("DOCTOR").test(String(t)); }
  function fix112(t) {
    if (typeof t !== "string") return t;
    t = t.replace(rx("CALLNUM"), function (all, verb, gap) { return verb + gap + "112"; });
    return t.replace(rx("NUM911"), "112");
  }
  function stripLinks(t) {
    return String(t).replace(rx("MDLINK"), function (all, label) { return label; }).replace(rx("URL"), "").replace(/[ \t]{2,}/g, " ");
  }
  function mentionsEmergency(t) { return rx("EMERGENCY").test(String(t).replace(new RegExp(SAFETY_PATTERNS.EMERGENCY_NEG[0], "gi"), " ")); }

  /** Returns { text (null if almost nothing is left), emergency }. */
  function sanitizeReply(text, lang) {
    text = stripLinks(fix112(String(text || "")));
    var outLines = [], medRemoved = false, removed = false, keptChars = 0;
    text.split("\n").forEach(function (line) {
      var m = /^(\s*(?:[-•*]|\d+[.)])\s+)?([\s\S]*)$/.exec(line), prefix = m[1] || "", body = m[2];
      // split into sentences, but not after "Dr."
      var parts = body.replace(/([.!?])\s+/g, function (all, p, off) {
        return /[Dd]r$/.test(body.slice(Math.max(0, off - 2), off)) && p === "." ? all : p + "\u0000";
      }).split("\u0000");
      var keep = parts.filter(function (sent) {
        if (isMedicalUnsafe(sent)) { medRemoved = removed = true; return false; }
        if (isInventedFact(sent)) { removed = true; return false; }
        return /\S/.test(sent);
      });
      var body2 = keep.join(" ");
      if (/\S/.test(body2)) { outLines.push(prefix + body2); keptChars += body2.replace(/[^\wÀ-ɏ]/g, "").length; }
      else if (!/\S/.test(body)) outLines.push("");
    });
    if (keptChars === 0 || (removed && keptChars < 20)) return { text: null, emergency: false }; // (almost) nothing left
    var clean = outLines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/g, "");
    if (medRemoved) clean += "\n\n" + pick(T.ASK_PHARMACIST, lang === "ro" ? "ro" : "en");
    return { text: clean, emergency: mentionsEmergency(clean) };
  }

  function emptyFacts() { return { who: null, duration: null, severity: null }; }
  /** Local facts first; the model only fills the gaps (both already validated enums). */
  function mergeFacts(local, model) {
    var out = emptyFacts();
    FACT_IDS.forEach(function (id) { out[id] = validFact(id, local && local[id]) || validFact(id, model && model[id]); });
    return out;
  }

  function parseFlag(v) { return v === true || (typeof v === "string" && /^(true|yes|1)$/i.test(v.replace(/^\s+|\s+$/g, ""))); }

  /**
   * Client-side re-validation of the proxy answer. Returns a clean object or null.
   * ctx (optional) = { text: the user's messages, answers: {who, duration, severity} }: the model's
   * suggestions are re-scored with the local rule evidence of that text (rateSuggestions); the
   * model's own confidence label is never shown as High without local support.
   */
  function validateChat(data, availableSpecialties, lang, ctx) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    var raw = str(data.reply, 1500);
    if (!raw || /^[{\[][\s\S]*[}\]]$/.test(raw)) return null; // missing, or JSON smuggled inside the reply
    var san = sanitizeReply(raw, lang);
    if (!san.text) return null;
    var reply = san.text;
    // The signature is only valid for the exact text the server produced; if the client filter
    // changed it, the turn is simply not forwarded next time (no sig).
    var sig = reply === raw && typeof data.sig === "string" && /^[a-f0-9]{64}$/.test(data.sig) ? data.sig : null;
    if (parseFlag(data.redFlag) || san.emergency) return { reply: reply, redFlag: true, suggestions: [], facts: emptyFacts(), asking: null, sig: sig };
    var avail = resolveAvail(availableSpecialties), seen = {};
    var out = { reply: reply, redFlag: false, suggestions: [], facts: emptyFacts(), asking: null, sig: sig };
    // facts / asking: enums only; anything else is dropped. A legacy "followUp" is ignored (no options are ever shown).
    var fin = data.facts && typeof data.facts === "object" && !Array.isArray(data.facts) ? data.facts : {};
    FACT_IDS.forEach(function (id) { out.facts[id] = validFact(id, fin[id]); });
    out.asking = FACT_IDS.indexOf(data.asking) >= 0 ? data.asking : null;
    if (Array.isArray(data.suggestions)) {
      for (var i = 0; i < data.suggestions.length && out.suggestions.length < 3; i++) {
        var s = data.suggestions[i];
        var spName = s && typeof s.specialty === "string" ? availName(s.specialty, avail) : null; // alias-tolerant
        if (!spName || seen[spName]) continue;
        seen[spName] = true;
        var reason = fix112(str(s.reason, 300) || "");
        if (reason && (isMedicalUnsafe(reason) || isInventedFact(reason) || mentionsEmergency(reason))) reason = "";
        reason = stripLinks(reason);
        out.suggestions.push({ specialty: spName, reason: reason,
          confidence: CONF_OK[String(s.confidence || "").toLowerCase()] || "Low", score: 0 });
      }
    }
    if (out.suggestions.length) { out.asking = null; rateSuggestions(out.suggestions, ctx, availableSpecialties, lang); }
    return out;
  }

  /**
   * One AI chat turn. history: [{role: "user"|"assistant", content}] (in memory only).
   * Resolves { ok: true, data } or { ok: false, reason } and never rejects.
   * The caller MUST run checkRedFlagText() on the user's text first and skip this call on a red flag.
   */
  function chatWithLLM(history, answers, availableSpecialties, lang, opts) {
    var timeoutMs = (opts && opts.timeoutMs) || LLM_TIMEOUT_MS;
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (!done) { done = true; resolve(v); } }
      if (!USE_LLM && !(opts && opts.force)) { finish({ ok: false, reason: "disabled" }); return; }
      if (typeof XMLHttpRequest === "undefined") { finish({ ok: false, reason: "no-xhr" }); return; }
      var msgs = [];
      (history || []).forEach(function (m) {
        if (!m || typeof m.content !== "string" || !m.content) return;
        if (typeof m.n !== "number") return;
        if (m.role === "user") msgs.push({ role: "user", content: m.content.slice(0, LLM_MAX_CHARS), n: m.n });
        // Only server-signed assistant replies are sent back (the proxy drops anything else).
        else if (m.role === "assistant" && m.sig) msgs.push({ role: "assistant", content: m.content, sig: m.sig, n: m.n });
      });
      msgs = msgs.slice(-LLM_MAX_TURNS);
      if (!msgs.length || msgs[msgs.length - 1].role !== "user") { finish({ ok: false, reason: "bad-history" }); return; }
      // answers: {who, duration, severity, turn}; only valid enums and a small integer are sent.
      var clean = {};
      FACT_IDS.forEach(function (k) { var v = validFact(k, answers && answers[k]); if (v) clean[k] = v; });
      var turn = Math.floor(+(answers && answers.turn)) || 1;
      turn = Math.max(1, Math.min(turn, 50));
      // Local evidence for re-scoring the model's suggestions: the user's own messages + the known facts.
      var rateCtx = { text: msgs.filter(function (m) { return m.role === "user"; }).map(function (m) { return m.content; }).join("\n"),
        answers: clean };
      try {
        var avail = Object.keys(resolveAvail(availableSpecialties));
        var xhr = new XMLHttpRequest();
        xhr.open("POST", (opts && opts.endpoint) || LLM_ENDPOINT, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.timeout = timeoutMs;
        xhr.onload = function () {
          var parsed = null, v = null;
          try { if (xhr.status >= 200 && xhr.status < 300) parsed = JSON.parse(xhr.responseText); } catch (e) { parsed = null; }
          try { v = validateChat(parsed, availableSpecialties, lang, rateCtx); } catch (e2) { v = null; }
          finish(v ? { ok: true, data: v } : { ok: false, reason: "http-" + xhr.status });
        };
        xhr.onerror = function () { finish({ ok: false, reason: "network" }); };
        xhr.ontimeout = function () { finish({ ok: false, reason: "timeout" }); };
        xhr.onabort = function () { finish({ ok: false, reason: "abort" }); };
        setTimeout(function () { if (!done) { try { xhr.abort(); } catch (e) {} finish({ ok: false, reason: "timeout" }); } }, timeoutMs + 500);
        xhr.send(JSON.stringify({ conversationId: (opts && opts.conversationId) || "", messages: msgs, facts: clean,
          turn: turn, availableSpecialties: avail, lang: lang === "ro" ? "ro" : "en" }));
      } catch (err) {
        finish({ ok: false, reason: "exception" });
      }
    });
  }

  /** Rule-engine answer as a Promise (kept for compatibility; the chat UI uses chatWithLLM + analyze). */
  function analyzeAsync(text, answers, availableSpecialties) {
    return Promise.resolve(analyze(text, answers, availableSpecialties));
  }

  // ------------------------------------------------------------------ export
  root.MedIndex = root.MedIndex || {};
  root.MedIndex.engine = {
    normalize: normalize,
    tokenize: tokenize,
    wordMatch: wordMatch,
    phraseMatch: function (text, phrase) { return phraseMatch(tokenize(text), compile(phrase)); },
    matchesText: matchesText,
    detectLanguage: detectLanguage,
    resolveSpecialty: function (specialty, avail) { return resolveSpecialty(specialty, resolveAvail(avail)); },
    canonSpecialty: canonSpecialty,
    GP: GP,
    analyze: analyze,
    analyzeAsync: analyzeAsync,
    extractFacts: extractFacts,
    converse: converse,
    mergeFacts: mergeFacts,
    isThanks: isThanks,
    FACT_IDS: FACT_IDS.slice(),
    MAX_TURNS: MAX_TURNS,
    checkRedFlagText: checkRedFlagText,
    chatWithLLM: chatWithLLM,
    validateChat: validateChat,
    rateSuggestions: rateSuggestions,
    confidenceLabel: confidenceLabel,
    CONFIDENCE: { LOW_MAX: 39, MEDIUM_MIN: CONF_CFG.MEDIUM, HIGH_MIN: CONF_CFG.HIGH, REMAP_CAP: CONF_CFG.REMAP_CAP, LLM_CAP: CONF_CFG.LLM_CAP },
    sanitizeReply: sanitizeReply,
    SAFETY_PATTERNS: SAFETY_PATTERNS,
    USE_LLM: USE_LLM,
    FILE_MODE: FILE_MODE,
    LLM_ENDPOINT: LLM_ENDPOINT,
    LLM_NOTICE: T.LLM_NOTICE.en,
    LLM_NOTICE_I18N: T.LLM_NOTICE,
    QUICK_REPLIES: QUICK_REPLIES,
    WELCOME: T.WELCOME,
    EMERGENCY: T.EMERGENCY,
    DISCLAIMER: T.DISCLAIMER,
    FOLLOWUPS: FOLLOWUPS,
    text: function (key, lang) { return T[key] ? pick(T[key], lang || "en") : null; }
  };
})(typeof window !== "undefined" ? window : this);
