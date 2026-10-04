/*
 * MedIndex ranking: pure functions, no DOM, no storage, never mutates inputs.
 * Classic script (works from file://). Exposes window.MedIndex.ranking.
 *
 * DISTANCE CONVENTION: context.distanceKm is a FUNCTION (doctor) => number|null
 * (km from the user's location, e.g. built from app.js haversineKm). If it is
 * missing or returns null for every candidate, the location is unknown and every
 * doctor gets a neutral proximity of 0.5. That is not a fake distance, just a
 * neutral value; explain() prints "Distance: unknown (neutral)". A single doctor
 * with null distance (no coordinates) in a set where others are known also gets
 * 0.5 and sorts last on the distance tie-break.
 *
 * RATINGS: doctors may carry ratingValue (number|null) and ratingCount (number).
 * Use MedIndex.reviews.withRatings(doctors) first to merge in-app reviews.
 * Unrated doctors (ratingCount 0) use the Bayesian prior C (neutral) and are
 * flagged unrated: true. They are never zeroed.
 *
 * PRIOR C (deliberate deviation from "C = plain mean of rated doctors"):
 *   C = (n * mean + K * 4.0) / (n + K), K = 10, n = number of rated doctors,
 *   C = 4.0 when n = 0. With a plain mean, a single 1-star review anywhere would
 *   set C = 1 and zero the rating points of every unrated doctor, and a single
 *   5-star review would set C = 5 and leave that doctor tied with the unrated
 *   ones. Anchoring C to 4.0 satisfies "never punish unrated doctors".
 *   rankDoctors computes C over ALL doctors it is given, before the cnasOnly
 *   filter (unless context.stats is supplied), so filtering never shifts the prior.
 *
 * SPECIALTY MATCH: 1st suggested specialty = 1, 2nd = 0.8, 3rd = 0.6, else 0,
 * multiplied by confidence (High 1, Medium 0.9, Low 0.8, missing = 1).
 * If context.targetSpecialties is empty/missing, every doctor gets a neutral 0.5.
 */
(function () {
  "use strict";
  window.MedIndex = window.MedIndex || {};

  var SENIOR_RANK = "Senior Consultant / Primary Physician";
  var DEFAULT_M = 10;
  var DEFAULT_C = 4.0;
  var PRIOR_K = 10; // pseudo-doctors at DEFAULT_C anchoring the prior C

  var WEIGHT_PRESETS = {
    best:    { label: { en: "Best overall",   ro: "Cea mai bună potrivire" }, match: 35, rating: 25, seniority: 15, proximity: 15, price: 10 },
    price:   { label: { en: "Lowest price",   ro: "Cel mai mic preț" },       match: 25, rating: 15, seniority: 5,  proximity: 10, price: 45 },
    nearest: { label: { en: "Nearest",        ro: "Cel mai aproape" },        match: 25, rating: 15, seniority: 5,  proximity: 45, price: 10 },
    rated:   { label: { en: "Highest rated",  ro: "Cele mai bune recenzii" }, match: 25, rating: 45, seniority: 10, proximity: 10, price: 10 },
    senior:  { label: { en: "Most experienced", ro: "Cea mai mare experiență" }, match: 25, rating: 15, seniority: 40, proximity: 10, price: 10 }
  };
  var DEFAULT_PRESET = "best";

  var COMPONENT_KEYS = ["match", "rating", "seniority", "proximity", "price"];
  var LABELS = {
    en: { match: "Match", rating: "Rating", seniority: "Seniority", proximity: "Distance", price: "Price",
          distUnknown: "Distance: unknown (neutral)", unrated: "Rating: no reviews yet (neutral)",
          noSpecialty: "Match: no specialty given (neutral)" },
    ro: { match: "Potrivire", rating: "Rating", seniority: "Experiență", proximity: "Distanță", price: "Preț",
          distUnknown: "Distanță: necunoscută (neutru)", unrated: "Rating: fără recenzii încă (neutru)",
          noSpecialty: "Potrivire: nicio specialitate indicată (neutru)" }
  };
  var CONFIDENCE = { high: 1, medium: 0.9, low: 0.8 };
  var POSITION = [1, 0.8, 0.6];

  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
  function round1(x) { return Math.round(x * 10) / 10; }

  /** Resolves a preset key or a weights object to a plain weights object. */
  function resolveWeights(weights) {
    var src = typeof weights === "string" ? WEIGHT_PRESETS[weights] : weights;
    if (!src) src = WEIGHT_PRESETS[DEFAULT_PRESET];
    var out = {};
    COMPONENT_KEYS.forEach(function (k) { out[k] = isNum(src[k]) ? src[k] : 0; });
    return out;
  }

  function ratingCountOf(d) { return isNum(d.ratingCount) && d.ratingCount > 0 ? d.ratingCount : 0; }
  function isRated(d) { return ratingCountOf(d) > 0 && isNum(d.ratingValue); }

  /** { C: (n*mean + 10*4.0)/(n + 10) over rated doctors (4.0 if none), m: 10 }. See PRIOR C above. */
  function computeStats(doctors) {
    var sum = 0, n = 0;
    (doctors || []).forEach(function (d) {
      if (d && isRated(d)) { sum += d.ratingValue; n++; }
    });
    return { C: (sum + PRIOR_K * DEFAULT_C) / (n + PRIOR_K), m: DEFAULT_M };
  }

  /** (v/(v+m))*R + (m/(v+m))*C; unrated -> C exactly. */
  function bayesianRating(doctor, stats) {
    stats = stats || { C: DEFAULT_C, m: DEFAULT_M };
    var C = isNum(stats.C) ? stats.C : DEFAULT_C;
    var m = isNum(stats.m) ? stats.m : DEFAULT_M;
    if (!doctor || !isRated(doctor)) return C;
    var v = ratingCountOf(doctor), R = doctor.ratingValue;
    return (v / (v + m)) * R + (m / (v + m)) * C;
  }

  function distanceOf(doctor, context) {
    if (!context || typeof context.distanceKm !== "function") return null;
    var km = context.distanceKm(doctor);
    return isNum(km) ? km : null;
  }

  function specialtyFactor(doctor, targets) {
    if (!targets || !targets.length) return { value: 0.5, neutral: true };
    var spec = norm(doctor.specialty), best = 0;
    for (var i = 0; i < targets.length && i < POSITION.length; i++) {
      var t = targets[i];
      var name = typeof t === "string" ? t : t && t.specialty;
      if (norm(name) !== spec || !spec) continue;
      var conf = t && typeof t === "object" && t.confidence != null ? CONFIDENCE[norm(t.confidence)] : 1;
      if (!isNum(conf)) conf = 1;
      best = Math.max(best, POSITION[i] * conf);
    }
    return { value: best, neutral: false };
  }

  /** Min-max where lower is better; min==max -> 1; null -> neutral 0.5. */
  function lowerIsBetter(x, min, max) {
    if (!isNum(x) || !isNum(min) || !isNum(max)) return 0.5;
    if (max === min) return 1;
    return clamp01((max - x) / (max - min));
  }

  /** Fills stats/priceMin/priceMax/distMin/distMax from candidates when absent. Returns a new context. */
  function completeContext(candidates, context) {
    var ctx = {};
    var k;
    for (k in (context || {})) if (Object.prototype.hasOwnProperty.call(context, k)) ctx[k] = context[k];
    if (!ctx.stats) ctx.stats = computeStats(candidates);
    var prices = [], dists = [];
    candidates.forEach(function (d) {
      if (isNum(d.priceRON)) prices.push(d.priceRON);
      var km = distanceOf(d, ctx);
      if (km != null) dists.push(km);
    });
    if (!isNum(ctx.priceMin)) ctx.priceMin = prices.length ? Math.min.apply(null, prices) : null;
    if (!isNum(ctx.priceMax)) ctx.priceMax = prices.length ? Math.max.apply(null, prices) : null;
    if (!isNum(ctx.distMin)) ctx.distMin = dists.length ? Math.min.apply(null, dists) : null;
    if (!isNum(ctx.distMax)) ctx.distMax = dists.length ? Math.max.apply(null, dists) : null;
    return ctx;
  }

  /**
   * matchScore(doctor, context, weights) -> { score 0..100 int, components[], unrated, bayesian, distanceKm }
   * components: [{ key, label, labelRo, raw (0..1), points (1 decimal), max, note|null }]
   */
  function matchScore(doctor, context, weights) {
    var ctx = context || {};
    if (!ctx.stats || !("priceMin" in ctx) || !("distMin" in ctx)) ctx = completeContext([doctor], ctx);
    var w = resolveWeights(weights);
    var unrated = !isRated(doctor);
    var bayes = bayesianRating(doctor, ctx.stats);
    var km = distanceOf(doctor, ctx);
    var spec = specialtyFactor(doctor, ctx.targetSpecialties);

    var raw = {
      match: spec.value,
      rating: clamp01((bayes - 1) / 4),
      seniority: doctor.medicalRank === SENIOR_RANK ? 1 : 0.6,
      proximity: km == null ? 0.5 : lowerIsBetter(km, ctx.distMin, ctx.distMax),
      price: lowerIsBetter(doctor.priceRON, ctx.priceMin, ctx.priceMax)
    };
    var notes = {
      match: spec.neutral ? "noSpecialty" : null,
      rating: unrated ? "unrated" : null,
      seniority: null,
      proximity: km == null ? "distUnknown" : null,
      price: null
    };

    var total = 0;
    var components = COMPONENT_KEYS.map(function (key) {
      var exact = raw[key] * w[key];
      total += exact;
      return {
        key: key, label: LABELS.en[key], labelRo: LABELS.ro[key],
        raw: raw[key], points: round1(exact), max: w[key], note: notes[key]
      };
    });
    var maxTotal = COMPONENT_KEYS.reduce(function (s, k) { return s + w[k]; }, 0);
    var score = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0;
    return { score: score, components: components, unrated: unrated, bayesian: bayes, distanceKm: km };
  }

  function cmpName(a, b) { return String(a.name || "").localeCompare(String(b.name || ""), "ro"); }

  /**
   * rankDoctors(doctors, context, weights, { cnasOnly }) -> NEW array of
   * { doctor, score, components, unrated, bayesian, distanceKm, rank }.
   * Sort: score desc, bayesian desc, distance asc (null last), priceRON asc, name asc.
   */
  function rankDoctors(doctors, context, weights, options) {
    var opts = options || {};
    var all = (doctors || []).filter(function (d) { return !!d; });
    var candidates = all.filter(function (d) {
      return !opts.cnasOnly || d.acceptsCNAS === true;
    });
    var base = context || {};
    if (!base.stats) {
      // Prior C from the full set (before cnasOnly), so the filter never shifts it.
      var withStats = {};
      for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) withStats[k] = base[k];
      withStats.stats = computeStats(all);
      base = withStats;
    }
    var ctx = completeContext(candidates, base);
    var results = candidates.map(function (d) {
      var r = matchScore(d, ctx, weights);
      return { doctor: d, score: r.score, components: r.components, unrated: r.unrated,
               bayesian: r.bayesian, distanceKm: r.distanceKm, rank: 0 };
    });
    results.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.bayesian !== a.bayesian) return b.bayesian - a.bayesian;
      var da = a.distanceKm, db = b.distanceKm;
      if (da !== db) {
        if (da == null) return 1;
        if (db == null) return -1;
        return da - db;
      }
      var pa = isNum(a.doctor.priceRON) ? a.doctor.priceRON : Infinity;
      var pb = isNum(b.doctor.priceRON) ? b.doctor.priceRON : Infinity;
      if (pa !== pb) return pa < pb ? -1 : 1;
      return cmpName(a.doctor, b.doctor);
    });
    results.forEach(function (r, i) { r.rank = i + 1; });
    return results;
  }

  /** explain(result, lang) -> "Match +35 / Rating +21 / Seniority +15 / Distance +9 / Price +6" */
  function explain(result, lang) {
    var L = LABELS[lang === "ro" ? "ro" : "en"];
    if (!result || !result.components) return "";
    return result.components.map(function (c) {
      var label = c.note ? L[c.note] : L[c.key];
      return label + " +" + (Number.isInteger(c.points) ? c.points : c.points.toFixed(1));
    }).join(" / ");
  }

  window.MedIndex.ranking = {
    WEIGHT_PRESETS: WEIGHT_PRESETS,
    DEFAULT_PRESET: DEFAULT_PRESET,
    LABELS: LABELS,
    resolveWeights: resolveWeights,
    computeStats: computeStats,
    bayesianRating: bayesianRating,
    matchScore: matchScore,
    rankDoctors: rankDoctors,
    explain: explain
  };
})();
