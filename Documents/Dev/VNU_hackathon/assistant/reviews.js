/*
 * MedIndex reviews ("MedIndex reviews"), server-backed.
 * Classic script (works from file://). Exposes window.MedIndex.reviews.
 *
 * Source of truth: the local server, through window.MedIndexAPI (js/api.js, callback style cb(err, data)).
 *   - reviews.summary(cb) -> { ratings: { "<doctorId>": { avg, count } } }  loaded once at startup
 *     and again after every review, into an in-memory cache (never stored in the browser).
 *   - reviews.create(doctorId, stars, comment, cb) -> 201 { review } | 401 (signed out) | 409 (already reviewed)
 *   - reviews.list(doctorId, cb) -> { doctorId, total, shown, limited, limit, mine }
 * If MedIndexAPI is missing or answers { status: 0 } (file://), the module is "offline": every doctor shows
 * "No ratings yet" and addReview() reports that reviews need the local server.
 * The old device-only store (localStorage "medindex.reviews.v1") is removed once and never read.
 * No reviews or ratings are ever seeded or invented.
 */
(function () {
  "use strict";
  window.MedIndex = window.MedIndex || {};

  var LABEL = "MedIndex reviews";
  var MAX_COMMENT = 280;
  var LEGACY_KEY = "medindex.reviews.v1";

  var summary = {};      // doctorId -> { avg, count }
  var mine = {};         // doctorId -> { stars, comment, createdAt } for the signed-in user (from list/create)
  var state = "idle";    // idle | loading | ready | offline | error
  var listeners = [];
  var loadSeq = 0;

  try { if (window.localStorage) window.localStorage.removeItem(LEGACY_KEY); } catch (e) { /* storage blocked: nothing to clean */ }

  /** UI-language message (js/i18n-directory.js reviews.* keys; English fallback). */
  function msg(key, fallback, vars) {
    var app = window.MedIndex && window.MedIndex.app;
    var out = app && typeof app.tr === "function" ? app.tr("reviews." + key, vars) : null;
    if (!out || out === "reviews." + key) out = fallback;
    return out;
  }

  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function api() {
    var a = window.MedIndexAPI;
    return a && a.reviews && typeof a.reviews.summary === "function" ? a : null;
  }
  function isOfflineErr(err) { return !err || err.status === 0 || err.error === "offline"; }

  function notify(doctorId) {
    listeners.slice().forEach(function (cb) {
      try { cb(doctorId); } catch (e) { /* a broken listener must not break others */ }
    });
  }

  function cleanSummary(data) {
    var out = {}, src = data && data.ratings;
    if (!src || typeof src !== "object") return out;
    Object.keys(src).forEach(function (id) {
      var r = src[id];
      if (r && isNum(r.avg) && isNum(r.count) && r.count > 0 && r.avg >= 1 && r.avg <= 5) {
        out[String(id)] = { avg: r.avg, count: Math.floor(r.count) };
      }
    });
    return out;
  }

  /** load(cb?): (re)loads the ratings summary. cb(err|null). */
  function load(cb) {
    var a = api(), seq = ++loadSeq;
    if (!a) { state = "offline"; summary = {}; notify(null); if (cb) cb({ status: 0, error: "offline" }); return; }
    if (state !== "ready") state = "loading";
    try {
      a.reviews.summary(function (err, data) {
        if (seq !== loadSeq) return;
        if (err) {
          state = isOfflineErr(err) ? "offline" : "error";
          if (state === "offline") summary = {};
        } else {
          state = "ready";
          summary = cleanSummary(data);
        }
        notify(null);
        if (cb) cb(err || null);
      });
    } catch (e) { state = "error"; notify(null); if (cb) cb({ status: -1, error: String(e) }); }
  }

  function validReview(r) {
    return r && typeof r === "object" && Number.isInteger(r.stars) && r.stars >= 1 && r.stars <= 5;
  }

  /** getReview(doctorId) -> the signed-in user's review { stars, comment, createdAt } | null (when known). */
  function getReview(doctorId) {
    var r = mine[String(doctorId)];
    if (!validReview(r)) return null;
    return { stars: r.stars, comment: String(r.comment || ""), createdAt: r.createdAt || null };
  }
  function hasReviewed(doctorId) { return getReview(doctorId) !== null; }

  function rememberMine(doctorId, r) {
    if (validReview(r)) mine[String(doctorId)] = { stars: r.stars, comment: r.comment || "", createdAt: r.createdAt || null };
  }

  /** summaryFor(doctorId) -> { avg, count } | null (server ratings only). */
  function summaryFor(doctorId) {
    var s = summary[String(doctorId)];
    return s ? { avg: s.avg, count: s.count } : null;
  }

  /**
   * addReview(doctorId, stars, comment, cb) -> { ok: true, pending: true } | { ok: false, error, code }
   * cb(err, { review }) where err = { code: "invalid"|"auth"|"duplicate"|"offline"|"error", status, error }.
   */
  function addReview(doctorId, stars, comment, cb) {
    var done = typeof cb === "function" ? cb : function () {};
    function fail(code, msg, status) {
      var e = { ok: false, code: code, error: msg, status: status || 0 };
      done(e, null);
      return e;
    }
    if (doctorId === null || doctorId === undefined || doctorId === "") return fail("invalid", msg("errMissingId", "Missing doctor id."));
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return fail("invalid", msg("errStars", "Stars must be a whole number from 1 to 5."));
    var text = comment == null ? "" : String(comment).trim();
    if (text.length > MAX_COMMENT) return fail("invalid", msg("errComment", "Comment must be at most " + MAX_COMMENT + " characters.", { max: MAX_COMMENT }));
    var a = api();
    if (!a || state === "offline") return fail("offline", msg("errOfflineRun", "Reviews need the local server. Run it and open http://127.0.0.1:8000."));
    try {
      a.reviews.create(doctorId, stars, text, function (err, data) {
        if (err) {
          if (err.status === 401) { done({ ok: false, code: "auth", status: 401, error: msg("errSignIn", "Sign in to leave a review.") }, null); return; }
          if (err.status === 409) {
            done({ ok: false, code: "duplicate", status: 409, error: msg("errDuplicate", "You have already reviewed this doctor.") }, null);
            list(doctorId, function () { notify(doctorId); }); // learn the existing review for the "You rated" state
            return;
          }
          if (isOfflineErr(err)) { state = "offline"; notify(null); }
          done({ ok: false, code: isOfflineErr(err) ? "offline" : "error", status: err.status || 0,
                 error: isOfflineErr(err) ? msg("errOfflineShort", "Reviews need the local server.") : msg("errSave", "Your review could not be saved. Please try again.") }, null);
          return;
        }
        var review = (data && data.review) || { stars: stars, comment: text, createdAt: new Date().toISOString() };
        rememberMine(doctorId, { stars: Number.isInteger(review.stars) ? review.stars : stars, comment: review.comment, createdAt: review.createdAt });
        // Optimistic update so the card changes at once; the summary reload below confirms it.
        var s = summary[String(doctorId)];
        summary[String(doctorId)] = s ? { avg: (s.avg * s.count + stars) / (s.count + 1), count: s.count + 1 } : { avg: stars, count: 1 };
        notify(doctorId);
        done(null, { review: review });
        load();
      });
    } catch (e) { return fail("error", msg("errSave", "Your review could not be saved. Please try again.")); }
    return { ok: true, pending: true };
  }

  /** list(doctorId, cb): written reviews from the server; caches the user's own review (data.mine). */
  function list(doctorId, cb) {
    var done = typeof cb === "function" ? cb : function () {};
    var a = api();
    if (!a || typeof a.reviews.list !== "function") { done({ status: 0, error: "offline" }, null); return; }
    try {
      a.reviews.list(doctorId, function (err, data) {
        if (!err && data) {
          if (validReview(data.mine)) rememberMine(doctorId, data.mine);
          else if (data.mine === null || data.mine === false) delete mine[String(doctorId)];
        } else if (err && isOfflineErr(err)) { state = "offline"; }
        done(err || null, data || null);
      });
    } catch (e) { done({ status: -1, error: String(e) }, null); }
  }

  function publishedOf(doctor) {
    // withRatings() keeps the original published values here, so it is idempotent.
    var hasPub = doctor && Object.prototype.hasOwnProperty.call(doctor, "publishedRatingValue");
    var value = hasPub ? doctor.publishedRatingValue : doctor && doctor.ratingValue;
    var count = hasPub ? doctor.publishedRatingCount : doctor && doctor.ratingCount;
    if (!isNum(value) || !isNum(count) || count <= 0) return null;
    return { value: value, count: count };
  }

  /**
   * combinedRating(doctor) -> { value: number|null, count: number, sources: [{ label, value, count, url|null }] }
   * Count-weighted average of a published rating (if the data ever has one) and the MedIndex reviews summary.
   */
  function combinedRating(doctor) {
    var sources = [];
    var pub = publishedOf(doctor);
    if (pub) {
      sources.push({
        label: doctor.ratingSource || (doctor.hospital ? doctor.hospital + " site" : "Published rating"),
        value: pub.value, count: pub.count, url: doctor.ratingSourceUrl || null
      });
    }
    var s = doctor && doctor.id != null ? summary[String(doctor.id)] : null;
    if (s) sources.push({ label: LABEL, value: s.avg, count: s.count, url: null });
    var sum = 0, count = 0;
    sources.forEach(function (x) { sum += x.value * x.count; count += x.count; });
    return { value: count > 0 ? sum / count : null, count: count, sources: sources };
  }

  /** withRatings(doctors) -> NEW array of shallow copies with combined ratingValue/ratingCount + ratingSources. */
  function withRatings(doctors) {
    return (doctors || []).map(function (d) {
      var copy = {};
      for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) copy[k] = d[k];
      if (!Object.prototype.hasOwnProperty.call(d, "publishedRatingValue")) {
        copy.publishedRatingValue = isNum(d.ratingValue) ? d.ratingValue : null;
        copy.publishedRatingCount = isNum(d.ratingCount) ? d.ratingCount : 0;
      }
      var c = combinedRating(copy);
      copy.ratingValue = c.value;
      copy.ratingCount = c.count;
      copy.ratingSources = c.sources;
      return copy;
    });
  }

  /** onChange(cb) -> unsubscribe(). cb(doctorId|null) fires after a summary load, a review or a sign-in change. */
  function onChange(callback) {
    if (typeof callback !== "function") return function () {};
    listeners.push(callback);
    return function () {
      var i = listeners.indexOf(callback);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  // A different user (or none) means a different "own review" set.
  try {
    document.addEventListener("medindex:auth", function () { mine = {}; notify(null); });
  } catch (e) { /* no document events: ignore */ }

  window.MedIndex.reviews = {
    LABEL: LABEL,
    LOCAL_LABEL: LABEL, // old name, kept for compatibility
    MAX_COMMENT: MAX_COMMENT,
    getReview: getReview,
    hasReviewed: hasReviewed,
    addReview: addReview,
    list: list,
    load: load,
    summaryFor: summaryFor,
    status: function () { return state; },
    isOffline: function () { return state === "offline" || !api(); },
    combinedRating: combinedRating,
    withRatings: withRatings,
    onChange: onChange,
    /** Test hook: forget cached data (simulates a reload). */
    _reset: function () { summary = {}; mine = {}; state = "idle"; loadSeq++; }
  };

  // Load once at startup (after the other deferred scripts so js/api.js is ready wherever it is placed).
  function start() { load(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else setTimeout(start, 0);
})();
