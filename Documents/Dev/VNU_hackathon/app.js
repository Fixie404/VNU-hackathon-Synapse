/* MedIndex – front end. Plain JS, no build step, works over file://. */
(function () {
  "use strict";

  /* ---------- Constants ---------- */

  var NETWORKS = ["Sanador", "MedLife", "Regina Maria", "Medicover"];
  var SENIOR_RANK = "Senior Consultant / Primary Physician";

  var AREAS = [
    { name: "Floreasca", lat: 44.4655, lng: 26.1010 },
    { name: "Pipera", lat: 44.5040, lng: 26.1210 },
    { name: "Aviatorilor", lat: 44.4600, lng: 26.0850 },
    { name: "Dorobanti", lat: 44.4570, lng: 26.0960 },
    { name: "Victoriei", lat: 44.4520, lng: 26.0860 },
    { name: "Unirii", lat: 44.4270, lng: 26.1040 },
    { name: "Militari", lat: 44.4350, lng: 26.0100 },
    { name: "Drumul Taberei", lat: 44.4200, lng: 26.0300 },
    { name: "Titan", lat: 44.4180, lng: 26.1720 },
    { name: "Berceni", lat: 44.3850, lng: 26.1150 },
    { name: "Tineretului", lat: 44.4110, lng: 26.1050 },
    { name: "Cotroceni", lat: 44.4330, lng: 26.0640 },
    { name: "Baneasa", lat: 44.4970, lng: 26.0800 },
    { name: "Obor", lat: 44.4500, lng: 26.1250 },
    { name: "Pantelimon", lat: 44.4400, lng: 26.1700 },
    { name: "Crangasi", lat: 44.4500, lng: 26.0450 },
    { name: "Rahova", lat: 44.4100, lng: 26.0500 },
    { name: "Vitan", lat: 44.4150, lng: 26.1350 },
    { name: "Universitate", lat: 44.4350, lng: 26.1020 },
    { name: "Romana", lat: 44.4460, lng: 26.0970 },
    { name: "Colentina", lat: 44.4600, lng: 26.1400 },
    { name: "Dristor", lat: 44.4180, lng: 26.1430 }
  ];

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* Static, hard-coded SVG icons (the only place innerHTML is used). */
  var ICONS = {
    pin: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cross: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6L2.5 9.3l6.6-.8z" fill="currentColor"/></svg>',
    external: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    hand: '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path d="M4 20h16M6 16l9.5-9.5 3 3L9 19H6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
  };

  ICONS.heart = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path class="heart-path" d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  ICONS.distinction = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6L2.5 9.3l6.6-.8z" fill="currentColor" stroke="#7a5200" stroke-width="1" stroke-linejoin="round"/></svg>';
  ICONS.info = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10.5v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.4" r="1.3" fill="currentColor"/></svg>';

  /* ---------- Translation helpers (js/i18n.js + js/i18n-directory.js + js/i18n-specialties.js) ---------- */

  function I18N() { return window.MedIndexI18n || null; }
  function uiLang() {
    var I = I18N();
    var l = I && typeof I.getLang === "function" ? I.getLang() : "en";
    return l === "ro" ? "ro" : "en";
  }
  /** tr(key, vars, lang?): lang = a specific language (e.g. a chat reply); default = the UI language. */
  function tr(key, vars, lang) {
    var L = lang === "ro" || lang === "en" ? lang : uiLang();
    var S = window.MedIndexStrings || {};
    var s = S[L] && Object.prototype.hasOwnProperty.call(S[L], key) ? S[L][key] : null;
    var I = I18N();
    if (s == null && !lang && I && typeof I.has === "function" && I.has(key)) s = I.t(key);
    if (s == null && S.en && Object.prototype.hasOwnProperty.call(S.en, key)) s = S.en[key];
    if (s == null) s = key;
    s = String(s);
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? String(vars[k]) : m;
      });
    }
    return s;
  }
  /** Plural form suffix: EN one/other; RO one / few (0, 2-19, x01-x19) / many ("de": 20+). */
  function pluralForm(n, lang) {
    n = Math.abs(Math.floor(Number(n) || 0));
    if ((lang || uiLang()) === "ro") {
      if (n === 1) return "one";
      var r = n % 100;
      return n === 0 || (r >= 1 && r <= 19) ? "few" : "many";
    }
    return n === 1 ? "one" : "other";
  }
  function trn(base, n, vars, lang) {
    var v = vars || {};
    if (v.n == null) v.n = n;
    return tr(base + "." + pluralForm(n, lang), v, lang);
  }
  function specLabel(spec, lang) {
    if (!spec) return "";
    var k = "spec." + spec, s = tr(k, null, lang);
    return s === k ? spec : s;
  }
  function rankLabel(rank, lang) {
    var k = "rank." + rank, s = tr(k, null, lang);
    return s === k ? rank : s;
  }
  function kmText(km) {
    var s = (Math.round(km * 10) / 10).toFixed(1);
    return uiLang() === "ro" ? s.replace(".", ",") : s;
  }
  /** Lowercased search text for a specialty: English + Romanian labels + aliases. */
  var specHayCache = {};
  function specHay(spec) {
    if (!spec) return "";
    if (specHayCache[spec] != null) return specHayCache[spec];
    var al = (window.MedIndexSpecAliases || {})[spec] || [];
    var h = [spec, specLabel(spec, "en"), specLabel(spec, "ro")].concat(al).map(normalizeText).join(" | ");
    if (window.MedIndexStrings) specHayCache[spec] = h;
    return h;
  }

  /* ---------- Pure helpers ---------- */

  /** Lowercase, strip diacritics (incl. Romanian ș/ş/ț/ţ), collapse spaces. */
  function normalizeText(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[șş]/g, "s")
      .replace(/[țţ]/g, "t")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Great-circle distance in km between two {lat, lng} points. */
  function haversineKm(a, b) {
    var R = 6371;
    var toRad = function (d) { return (d * Math.PI) / 180; };
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function hasCoords(d) {
    return typeof d.lat === "number" && typeof d.lng === "number" && isFinite(d.lat) && isFinite(d.lng);
  }

  /** Distance from origin, or null when unknown (never a fake value). */
  function distanceFor(doctor, origin) {
    if (!origin || !hasCoords(doctor)) return null;
    return haversineKm(origin, doctor);
  }

  function seniorityScore(d) {
    return d.medicalRank === SENIOR_RANK ? 1 : 0;
  }

  /** Filters combine with AND. Returns a new array. */
  function filterDoctors(doctors, filters) {
    var q = normalizeText(filters.query);
    return doctors.filter(function (d) {
      if (q) {
        var hay = normalizeText(d.name) + " | " + specHay(d.specialty);
        if (hay.indexOf(q) === -1) return false;
      }
      if (filters.specialty && d.specialty !== filters.specialty) return false;
      if (filters.hospitals && filters.hospitals.indexOf(d.hospital) === -1) return false;
      if (filters.cnasOnly && d.acceptsCNAS !== true) return false;
      return true;
    });
  }

  function byName(a, b) {
    return String(a.name).localeCompare(String(b.name), "ro");
  }

  function priceOf(d) {
    return typeof d.priceRON === "number" && isFinite(d.priceRON) ? d.priceRON : Infinity;
  }

  /** Sorts a copy. Distance tie-breaks fall back to name when there is no origin. */
  function sortDoctors(doctors, sortKey, origin) {
    var dist = function (d) {
      var km = distanceFor(d, origin);
      return km == null ? Infinity : km;
    };
    var byDistance = function (a, b) {
      if (!origin) return byName(a, b);
      return (dist(a) - dist(b)) || byName(a, b);
    };
    var byPriceAsc = function (a, b) { return priceOf(a) - priceOf(b); };
    var bySeniority = function (a, b) { return seniorityScore(b) - seniorityScore(a); };

    var cmp;
    switch (sortKey) {
      case "price-asc":
        cmp = function (a, b) { return byPriceAsc(a, b) || byDistance(a, b); };
        break;
      case "price-desc":
        cmp = function (a, b) { return byPriceAsc(b, a) || byDistance(a, b); };
        break;
      case "nearest":
        // Without a location: keep the order by price.
        cmp = origin
          ? function (a, b) { return (dist(a) - dist(b)) || byPriceAsc(a, b) || byName(a, b); }
          : function (a, b) { return byPriceAsc(a, b) || byName(a, b); };
        break;
      case "senior":
        cmp = function (a, b) { return bySeniority(a, b) || byDistance(a, b); };
        break;
      default: // recommended
        cmp = function (a, b) {
          return bySeniority(a, b) ||
            (origin ? dist(a) - dist(b) : 0) ||
            byPriceAsc(a, b) ||
            byName(a, b);
        };
    }
    return doctors.slice().sort(function (a, b) {
      var r = cmp(a, b);
      return isNaN(r) ? 0 : r;
    });
  }

  function initials(name) {
    // Strip every leading academic title (e.g. "Asist. Univ. Dr.", "Sef De Lucrari Dr.").
    var TITLE = /^\s*(?:dr|prof|conf|asist|univ|(?:s|ș|ş)ef\s+(?:de\s+)?lucr(?:a|ă)ri)\.?(?:\s+|$)/i;
    var rest = String(name || "");
    while (TITLE.test(rest)) rest = rest.replace(TITLE, "");
    var parts = rest
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "?";
    var first = parts[0].charAt(0);
    var last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
    return (first + last).toUpperCase();
  }

  function formatDate(iso) {
    if (!iso) return "";
    var I = I18N();
    if (I && typeof I.formatDate === "function") {
      var f = I.formatDate(iso, { day: "numeric", month: "short", year: "numeric" });
      if (f) return f;
    }
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }

  function formatKm(km) {
    return (Math.round(km * 10) / 10).toFixed(1) + " km";
  }

  function hospitalSlug(h) {
    return normalizeText(h).replace(/[^a-z0-9]+/g, "-");
  }

  function safeUrl(url) {
    // Only allow http(s) links from data.
    return /^https?:\/\//i.test(String(url || "")) ? String(url) : null;
  }

  /* ---------- DOM helpers ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(name, className) {
    var span = el("span", "icon" + (className ? " " + className : ""));
    span.innerHTML = ICONS[name]; // static SVG only
    return span;
  }

  function $(id) { return document.getElementById(id); }

  /* ---------- State ---------- */

  function hasValidPrice(d) {
    return d != null && Number.isInteger(d.priceRON) && d.priceRON > 0;
  }

  /** Pre-filter at load: drop records without a positive integer price (never show N/A or ranges). */
  var DOCTORS = (Array.isArray(window.DOCTORS) ? window.DOCTORS : []).filter(function (d) {
    if (hasValidPrice(d)) return true;
    console.warn("MedIndex: skipping record without a valid priceRON", d && d.id, d && d.name);
    return false;
  });
  var META = window.DOCTORS_META || {};

  var state = {
    query: "",
    specialty: "",
    hospitals: NETWORKS.slice(),
    cnasOnly: false,
    sort: "recommended",
    origin: null // { lat, lng, label, kind: "gps"|"area" }
  };
  var lastGpsOrigin = null; // last successful GPS fix, reused when the area is cleared
  state.highlight = null;   // doctor id from doctors.html?doctor=<id> (highlighted card)

  /* Location status: remembered as a key so it can be re-translated on a language switch. */
  var locStatus = null; // { key, vars }
  function setLocStatus(key, vars) {
    locStatus = { key: key, vars: vars || null };
    var n = $("location-status");
    if (n) n.textContent = tr(key, vars);
  }

  function distText(km, origin) {
    var k = kmText(km);
    return origin && origin.kind !== "gps" && origin.label
      ? tr("dir.distArea", { km: k, area: origin.label })
      : tr("dir.distYou", { km: k });
  }

  /* ---------- Premium: gold distinction + favourite hearts (the server enforces both) ---------- */
  var prem = {
    distinct: {},        // doctorId -> true (from GET /api/distinctions; never computed here)
    favs: {},            // doctorId -> true
    favLoaded: false,
    favDisabled: false,  // 401/403 -> hearts hidden
    favUser: undefined,
    favBusy: {},
    distSeq: 0,
    distTimer: null
  };

  function navUser() {
    var nav = window.MedIndexNav;
    return nav && nav.ready ? (nav.user || null) : null;
  }
  function premiumHint() {
    var u = navUser();
    return !!(u && u.premium && u.premium.active);
  }
  function apiReq(method, url, body, cb) {
    var a = window.MedIndexAPI;
    if (!a || typeof a.request !== "function") { setTimeout(function () { cb({ status: 0, error: "offline" }, null); }, 0); return; }
    try { a.request(method, url, body, cb); } catch (e) { cb({ status: -1, error: String(e) }, null); }
  }
  function validId(v) { return Number.isInteger(v) && v > 0 && v < 1e9; }
  function idSet(list) {
    var out = {};
    (Array.isArray(list) ? list : []).forEach(function (v) { if (validId(v)) out[v] = true; });
    return out;
  }
  function sameSet(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(function (k) { return b[k]; });
  }
  /* While a deep-linked card is pinned (doctors.html?doctor=<id>), re-renders keep it centred and focused. */
  var pinUntil = 0;
  function pinHighlighted() {
    if (state.highlight == null || Date.now() > pinUntil) return false;
    var li = document.querySelector('#grid li[data-doctor-id="' + state.highlight + '"]');
    if (!li) return false;
    li.scrollIntoView({ behavior: "auto", block: "center" });
    var card = li.querySelector(".card");
    if (card && document.activeElement !== card) { try { card.focus({ preventScroll: true }); } catch (e) { card.focus(); } }
    return true;
  }
  function rerenderKeepScroll() {
    if (!DOCTORS.length) return;
    var y = window.pageYOffset;
    render(state);
    if (pinHighlighted()) return;
    if (Math.abs(window.pageYOffset - y) > 1) window.scrollTo(0, y);
  }

  function setDistinctions(next) {
    if (sameSet(prem.distinct, next)) return;
    prem.distinct = next;
    rerenderKeepScroll();
  }
  function fetchDistinctions() {
    var seq = ++prem.distSeq;
    if (!premiumHint()) { setDistinctions({}); return; }
    apiReq("GET", "/api/distinctions", null, function (err, data) {
      if (seq !== prem.distSeq) return;
      if (err || !data || !Array.isArray(data.doctorIds)) { setDistinctions({}); return; } // silent
      setDistinctions(idSet(data.doctorIds));
    });
  }
  /** Debounced refetch (after reviews, sign-in or Premium changes). */
  function refreshDistinctions() {
    clearTimeout(prem.distTimer);
    prem.distTimer = setTimeout(fetchDistinctions, 120);
  }

  function heartsVisible() { return premiumHint() && prem.favLoaded && !prem.favDisabled; }
  function loadFavourites() {
    var u = navUser();
    var uid = u ? u.id : null;
    if (uid !== prem.favUser) { prem.favUser = uid; prem.favs = {}; prem.favLoaded = false; prem.favDisabled = false; }
    if (!premiumHint()) { if (prem.favLoaded) { prem.favLoaded = false; prem.favs = {}; } rerenderKeepScroll(); return; }
    if (prem.favLoaded) return; // once per user
    apiReq("GET", "/api/favorites", null, function (err, data) {
      if (prem.favUser !== uid) return;
      if (err) {
        if (err.status === 401 || err.status === 403) prem.favDisabled = true;
        rerenderKeepScroll();
        return;
      }
      prem.favs = idSet(data && data.doctorIds);
      prem.favLoaded = true;
      rerenderKeepScroll();
    });
  }
  function paintHeart(btn) {
    var id = +btn.getAttribute("data-fav-id");
    var on = !!prem.favs[id];
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", tr(on ? "fav.remove" : "fav.add"));
    btn.title = tr(on ? "fav.remove" : "fav.add");
    btn.classList.toggle("is-on", on);
  }
  function paintHearts() {
    Array.prototype.forEach.call(document.querySelectorAll(".fav-btn[data-fav-id]"), paintHeart);
  }
  function announce(text) {
    var live = $("mi-fav-live");
    if (!live) {
      live = el("p", "mi-sr-only");
      live.id = "mi-fav-live";
      live.setAttribute("role", "status");
      document.body.appendChild(live);
    }
    live.textContent = "";
    setTimeout(function () { live.textContent = text; }, 30);
    clearTimeout(announce.t);
    announce.t = setTimeout(function () { live.textContent = ""; }, 4000);
  }
  function toggleFavourite(id) {
    if (!validId(id) || prem.favBusy[id]) return;
    var was = !!prem.favs[id];
    if (was) delete prem.favs[id]; else prem.favs[id] = true; // optimistic
    prem.favBusy[id] = true;
    paintHearts();
    var cb = function (err, data) {
      delete prem.favBusy[id];
      if (err) {
        if (was) prem.favs[id] = true; else delete prem.favs[id]; // rollback
        if (err.status === 401 || err.status === 403) { prem.favDisabled = true; rerenderKeepScroll(); }
        else paintHearts();
        announce(tr("fav.error"));
        return;
      }
      if (data && Array.isArray(data.doctorIds)) prem.favs = idSet(data.doctorIds);
      paintHearts();
    };
    if (was) apiReq("DELETE", "/api/favorites/" + id, null, cb);
    else apiReq("POST", "/api/favorites", { doctorId: id }, cb);
  }
  function buildHeart(doctor) {
    if (!heartsVisible() || !validId(doctor.id)) return null;
    var b = el("button", "fav-btn");
    b.type = "button";
    b.setAttribute("data-fav-id", String(doctor.id));
    b.innerHTML = ICONS.heart; // static SVG only
    paintHeart(b);
    b.addEventListener("click", function () { toggleFavourite(doctor.id); });
    return b;
  }

  /* Distinction ⓘ popover: one open at a time; click/focus opens, Esc/blur/outside click closes. */
  var openPop = null; // { btn, pop }
  var popSeq = 0;
  function closePop() {
    if (!openPop) return;
    openPop.pop.hidden = true;
    openPop.btn.setAttribute("aria-expanded", "false");
    openPop = null;
  }
  function showPop(btn, pop) {
    if (openPop && openPop.pop === pop) return;
    closePop();
    pop.hidden = false;
    pop.style.left = "";
    btn.setAttribute("aria-expanded", "true");
    openPop = { btn: btn, pop: pop };
    var r = pop.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    if (r.right > vw - 8) pop.style.left = Math.round(parseFloat(getComputedStyle(pop).left) - (r.right - vw + 8)) + "px";
    r = pop.getBoundingClientRect();
    if (r.left < 8) pop.style.left = Math.round(parseFloat(getComputedStyle(pop).left) + (8 - r.left)) + "px";
  }
  document.addEventListener("click", function (e) {
    if (openPop && !openPop.btn.contains(e.target) && !openPop.pop.contains(e.target)) closePop();
  });

  function buildDistinction(doctor) {
    var wrap = el("span", "distinction");
    var star = el("span", "distinction-star");
    star.setAttribute("role", "img");
    star.setAttribute("aria-label", tr("star.label"));
    star.innerHTML = ICONS.distinction; // static SVG only
    wrap.appendChild(star);
    var btn = el("button", "distinction-info");
    btn.type = "button";
    btn.setAttribute("aria-label", tr("star.info"));
    btn.setAttribute("aria-expanded", "false");
    var pid = "distinction-pop-" + (++popSeq);
    btn.setAttribute("aria-controls", pid);
    btn.setAttribute("aria-describedby", pid);
    btn.innerHTML = ICONS.info; // static SVG only
    var pop = el("span", "distinction-pop", tr("star.text"));
    pop.id = pid;
    pop.setAttribute("role", "tooltip");
    pop.hidden = true;
    var byPointer = false;
    btn.addEventListener("pointerdown", function () { byPointer = true; });
    btn.addEventListener("focus", function () { if (!byPointer) showPop(btn, pop); });
    btn.addEventListener("click", function () {
      byPointer = false;
      if (openPop && openPop.pop === pop) closePop(); else showPop(btn, pop);
    });
    btn.addEventListener("blur", function () { byPointer = false; if (openPop && openPop.pop === pop) closePop(); });
    btn.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openPop && openPop.pop === pop) { e.preventDefault(); e.stopPropagation(); closePop(); }
    });
    wrap.appendChild(btn);
    wrap.appendChild(pop);
    return wrap;
  }

  /** <tag class id>name</tag> + the gold distinction (Premium, listed ids only), wrapped in a row. */
  function buildNameRow(tag, className, id, doctor) {
    var row = el("div", "name-row");
    var name = el(tag, className, doctor.name);
    if (id) name.id = id;
    row.appendChild(name);
    if (premiumHint() && prem.distinct[doctor.id]) row.appendChild(buildDistinction(doctor));
    return row;
  }

  /* Integration hooks for assistant/ui.js (see MedIndex.app below). */
  var customSorts = {};       // key -> { label, compare, enabled }
  var beforeRenderHooks = []; // cb(filteredList, state) before sorting/cards
  var renderHooks = [];       // cb(sortedList, state) after the grid is rendered

  /* ---------- Rendering ---------- */

  function buildAvatar(doctor) {
    var wrap = el("div", "avatar");
    var fallback = el("span", "avatar-initials", initials(doctor.name));
    fallback.setAttribute("aria-hidden", "true");

    var src = safeUrl(doctor.image) || (doctor.image && /^(data:image|\.{0,2}\/|[\w-]+\/)/.test(doctor.image) ? doctor.image : null);
    if (!src) {
      wrap.classList.add("is-fallback");
      wrap.setAttribute("role", "img");
      wrap.setAttribute("aria-label", doctor.name);
      wrap.appendChild(fallback);
      return wrap;
    }
    var img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.setAttribute("referrerpolicy", "no-referrer");
    img.alt = doctor.name;
    img.width = 72;
    img.height = 72;
    img.addEventListener("error", function () {
      img.remove();
      wrap.classList.add("is-fallback");
      wrap.setAttribute("role", "img");
      wrap.setAttribute("aria-label", doctor.name);
      wrap.appendChild(fallback);
    }, { once: true });
    img.src = src;
    wrap.appendChild(img);
    return wrap;
  }

  function buildCard(doctor, origin) {
    var li = el("li", "card-item");
    li.setAttribute("data-doctor-id", String(doctor.id));
    var card = el("article", "card");
    card.setAttribute("aria-labelledby", "doc-" + doctor.id + "-name");
    card.tabIndex = -1;
    if (state.highlight === doctor.id) card.classList.add("is-highlighted");
    li.appendChild(card);

    /* Top: avatar + identity */
    var top = el("div", "card-top");
    top.appendChild(buildAvatar(doctor));
    var ident = el("div", "card-ident");
    ident.appendChild(buildNameRow("h2", "card-name", "doc-" + doctor.id + "-name", doctor));
    ident.appendChild(el("p", "card-specialty", specLabel(doctor.specialty)));

    var badges = el("div", "badges");
    var hb = el("span", "badge badge-hospital badge-" + hospitalSlug(doctor.hospital), doctor.hospital);
    badges.appendChild(hb);
    if (doctor.medicalRank) {
      var senior = doctor.medicalRank === SENIOR_RANK;
      var rank = el("span", "badge badge-rank" + (senior ? " is-senior" : ""));
      if (senior) rank.appendChild(icon("star"));
      rank.appendChild(el("span", null, rankLabel(doctor.medicalRank)));
      badges.appendChild(rank);
    }
    if (doctor.manual === true) {
      var manual = el("span", "badge badge-manual");
      manual.appendChild(icon("hand"));
      manual.appendChild(el("span", null, tr("dir.manual")));
      manual.title = tr("dir.manualTitle");
      badges.appendChild(manual);
    }
    top.appendChild(ident);
    var heart = buildHeart(doctor);
    if (heart) top.appendChild(heart);
    card.appendChild(top);
    card.appendChild(badges);

    /* Price */
    var price = el("div", "price");
    var amount = el("p", "price-amount");
    amount.appendChild(el("span", "price-value", String(doctor.priceRON)));
    amount.appendChild(el("span", "price-currency", " RON"));
    price.appendChild(amount);
    var meta = el("p", "price-meta");
    if (doctor.priceService) meta.appendChild(el("span", "price-service", doctor.priceService));
    var srcUrl = safeUrl(doctor.priceSourceUrl);
    if (srcUrl) {
      if (meta.childNodes.length) meta.appendChild(document.createTextNode(" "));
      var srcWrap = el("span", "source-wrap", meta.childNodes.length ? "· " : "");
      var srcLink = el("a", "source-link", tr("dir.source"));
      srcLink.href = srcUrl;
      srcLink.target = "_blank";
      srcLink.rel = "noopener noreferrer";
      srcLink.setAttribute("aria-label", tr("dir.sourceAria", { name: doctor.name }));
      srcWrap.appendChild(srcLink);
      meta.appendChild(srcWrap);
    }
    price.appendChild(meta);
    var checked = formatDate(doctor.scrapedAt);
    if (checked) price.appendChild(el("p", "price-checked", tr("dir.checked", { date: checked })));
    card.appendChild(price);

    /* Location */
    var loc = el("div", "card-loc");
    if (doctor.clinicName) loc.appendChild(el("p", "clinic", doctor.clinicName));
    var where = el("p", "where");
    where.appendChild(icon("pin", "icon-pin"));
    var whereText = el("span", null, doctor.area || doctor.address || tr("dir.bucharest"));
    where.appendChild(whereText);
    var km = distanceFor(doctor, origin);
    if (km != null) {
      where.appendChild(el("span", "distance", distText(km, origin)));
    }
    loc.appendChild(where);
    if (doctor.address && doctor.area) loc.appendChild(el("p", "address", doctor.address));
    card.appendChild(loc);

    /* Footer: CNAS + profile */
    var foot = el("div", "card-foot");
    var cnas = el("p", "cnas " + (doctor.acceptsCNAS ? "is-yes" : "is-no"));
    cnas.appendChild(icon(doctor.acceptsCNAS ? "check" : "cross"));
    cnas.appendChild(el("span", null, tr(doctor.acceptsCNAS ? "dir.cnasYes" : "dir.cnasNo")));
    foot.appendChild(cnas);

    var profileUrl = safeUrl(doctor.profileUrl);
    if (profileUrl) {
      var btn = el("a", "btn btn-primary profile-btn");
      btn.href = profileUrl;
      btn.target = "_blank";
      btn.rel = "noopener noreferrer";
      btn.setAttribute("aria-label", tr("dir.profileAria", { name: doctor.name }));
      btn.appendChild(el("span", null, tr("dir.profile")));
      btn.appendChild(icon("external"));
      foot.appendChild(btn);
    }
    card.appendChild(foot);
    /* Assistant hook (assistant/ui.js): stars line, match chip, "Rate this doctor". */
    var ui = window.MedIndex && window.MedIndex.ui;
    if (ui && typeof ui.decorateCard === "function") {
      try { ui.decorateCard(card, doctor); } catch (e) { console.error(e); }
    }
    return li;
  }

  function render(s) {
    closePop();
    var list = filterDoctors(DOCTORS, {
      query: s.query,
      specialty: s.specialty,
      hospitals: s.hospitals,
      cnasOnly: s.cnasOnly
    });
    beforeRenderHooks.forEach(function (cb) { try { cb(list, s); } catch (e) { console.error(e); } });
    var custom = customSorts[s.sort];
    var sorted = custom && custom.enabled
      ? list.slice().sort(function (a, b) { return custom.compare(a, b) || byName(a, b); })
      : sortDoctors(list, s.sort, s.origin);

    var count = sorted.length;
    $("results-count").textContent = trn("dir.count", count);

    var grid = $("grid");
    var frag = document.createDocumentFragment();
    sorted.forEach(function (d) { frag.appendChild(buildCard(d, s.origin)); });
    grid.replaceChildren(frag);

    $("empty").hidden = count !== 0;
    grid.hidden = count === 0;
    $("sort-hint").hidden = !(s.sort === "nearest" && !s.origin);

    syncControls(s);
    renderHooks.forEach(function (cb) { try { cb(sorted, s); } catch (e) { console.error(e); } });
    pinHighlighted(); // deep-linked card stays centred + focused through early re-renders
  }

  function syncControls(s) {
    if ($("search").value !== s.query) $("search").value = s.query;
    $("specialty").value = s.specialty;
    $("sort").value = s.sort;
    var sw = $("cnas-switch");
    sw.setAttribute("aria-checked", s.cnasOnly ? "true" : "false");
    Array.prototype.forEach.call(document.querySelectorAll("#hospital-checks input"), function (cb) {
      cb.checked = s.hospitals.indexOf(cb.value) !== -1;
    });
    if (s.origin) {
      setLocStatus(s.origin.kind === "gps" ? "dir.loc.gps" : "dir.loc.area", s.origin.kind === "gps" ? null : { area: s.origin.label });
    }
  }

  /* ---------- Setup ---------- */

  function populateSpecialties() {
    var seen = {};
    DOCTORS.forEach(function (d) { if (d.specialty) seen[d.specialty] = true; });
    var select = $("specialty");
    var keep = select.value;
    Array.prototype.slice.call(select.options).forEach(function (o) { if (o.value) o.remove(); });
    var lang = uiLang();
    Object.keys(seen).sort(function (a, b) { return specLabel(a).localeCompare(specLabel(b), lang); }).forEach(function (s) {
      var opt = el("option", null, specLabel(s));
      opt.value = s;
      select.appendChild(opt);
    });
    select.value = keep;
  }

  /** doctors.html?specialty=<exact specialty>: preselects the filter if that specialty exists in the data. */
  function specialtyFromUrl() {
    var value = null;
    try { value = new URLSearchParams(window.location.search).get("specialty"); } catch (e) { return null; }
    if (!value) return null;
    return DOCTORS.some(function (d) { return d.specialty === value; }) ? value : null;
  }

  function populateHospitals() {
    var box = $("hospital-checks");
    NETWORKS.forEach(function (h) {
      var id = "hosp-" + hospitalSlug(h);
      var label = el("label", "check");
      label.setAttribute("for", id);
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = id;
      cb.value = h;
      cb.checked = true;
      cb.addEventListener("change", function () {
        var picked = [];
        Array.prototype.forEach.call(box.querySelectorAll("input"), function (c) {
          if (c.checked) picked.push(c.value);
        });
        state.hospitals = picked;
        render(state);
      });
      label.appendChild(cb);
      label.appendChild(el("span", "dot dot-" + hospitalSlug(h)));
      label.appendChild(el("span", null, h));
      box.appendChild(label);
    });
  }

  function populateAreas() {
    var select = $("area");
    AREAS.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (a) {
      var opt = el("option", null, a.name);
      opt.value = a.name;
      select.appendChild(opt);
    });
    select.addEventListener("change", function () {
      var area = AREAS.filter(function (a) { return a.name === select.value; })[0];
      // A picked area overrides GPS; clearing it falls back to the last GPS fix (if any).
      state.origin = area
        ? { lat: area.lat, lng: area.lng, label: area.name, kind: "area" }
        : (lastGpsOrigin ? Object.assign({}, lastGpsOrigin) : null);
      if (!state.origin) setLocStatus("dir.loc.notSet");
      render(state);
    });
  }

  function showAreaPicker(message) {
    $("area-picker").hidden = false;
    if (message) setLocStatus(message);
  }

  function requestLocation(userInitiated) {
    if (!("geolocation" in navigator)) {
      showAreaPicker("dir.loc.unavailable");
      return;
    }
    if (userInitiated) setLocStatus("dir.loc.finding");
    navigator.geolocation.getCurrentPosition(function (pos) {
      lastGpsOrigin = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        label: "you",
        kind: "gps"
      };
      // The automatic request on load must not override an area the user already picked;
      // an explicit "Use my location" click always switches back to GPS.
      if (!userInitiated && state.origin && state.origin.kind === "area") return;
      state.origin = Object.assign({}, lastGpsOrigin);
      $("area").value = "";
      render(state);
    }, function (err) {
      var msg = err && err.code === 1
        ? "dir.loc.denied"
        : "dir.loc.failed";
      if (!state.origin) showAreaPicker(msg);
      else $("area-picker").hidden = false;
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  function resetFilters() {
    state.query = "";
    state.specialty = "";
    state.hospitals = NETWORKS.slice();
    state.cnasOnly = false;
    state.sort = "recommended";
    $("search").value = "";
    render(state);
  }

  function renderFooter() {
    var dateIso = META.generatedAt;
    if (!dateIso) {
      dateIso = DOCTORS.reduce(function (max, d) {
        var t = Date.parse(d.scrapedAt);
        return !isNaN(t) && (max == null || t > Date.parse(max)) ? d.scrapedAt : max;
      }, null);
    }
    var when = formatDate(dateIso);
    $("footer-source").textContent = when ? tr("dir.footer.sourceDate", { date: when }) : tr("dir.footer.source");

    var manualCount = DOCTORS.filter(function (d) { return d.manual === true; }).length;
    if (manualCount) {
      var p = $("footer-manual");
      p.replaceChildren();
      var tag = el("span", "badge badge-manual");
      tag.appendChild(icon("hand"));
      tag.appendChild(el("span", null, tr("dir.manual")));
      p.appendChild(tag);
      p.appendChild(document.createTextNode(" " + trn("dir.footer.manual", manualCount)));
      p.hidden = false;
    }
  }

  function showNoData() {
    var notice = $("data-notice");
    notice.replaceChildren();
    notice.appendChild(el("h2", null, tr("dir.nodata.title")));
    var p = el("p", null, tr("dir.nodata.text"));
    notice.appendChild(p);
    notice.hidden = false;
    $("results-count").textContent = trn("dir.count", 0);
    $("grid").hidden = true;
    $("empty").hidden = true;
  }

  function setupMobileFilters() {
    var toggle = $("filters-toggle");
    var panel = $("filters-panel");
    var mq = window.matchMedia("(min-width: 1024px)");
    function apply() {
      if (mq.matches) {
        panel.classList.remove("is-collapsed");
      } else {
        panel.classList.toggle("is-collapsed", toggle.getAttribute("aria-expanded") !== "true");
      }
    }
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
      apply();
      if (!open) $("search").focus();
    });
    if (mq.addEventListener) mq.addEventListener("change", apply); else mq.addListener(apply);
    apply();
  }

  function init() {
    setLocStatus("dir.loc.notSet");
    if (window.MedIndexNav && window.MedIndexNav.ready) setTimeout(onAuth, 0);
    setupMobileFilters();
    populateHospitals();
    populateAreas();
    renderFooter();

    if (!DOCTORS.length) {
      showNoData();
      $("use-location").addEventListener("click", function () { requestLocation(true); });
      return;
    }

    populateSpecialties();
    var preset = specialtyFromUrl();
    if (preset) state.specialty = preset;
    var linked = doctorFromUrl();
    if (linked) revealDoctor(linked);

    $("filters-form").addEventListener("submit", function (e) { e.preventDefault(); });
    $("search").addEventListener("input", function (e) { state.query = e.target.value; render(state); });
    $("specialty").addEventListener("change", function (e) { state.specialty = e.target.value; render(state); });
    $("sort").addEventListener("change", function (e) { state.sort = e.target.value; render(state); });
    $("cnas-switch").addEventListener("click", function () { state.cnasOnly = !state.cnasOnly; render(state); });
    $("reset-filters").addEventListener("click", resetFilters);
    $("empty-reset").addEventListener("click", function () { resetFilters(); $("search").focus(); });
    $("use-location").addEventListener("click", function () { requestLocation(true); });

    render(state);
    if (linked) focusLinkedDoctor(linked);
    requestLocation(false);
  }

  /** doctors.html?doctor=<id>: validated positive integer that exists in the data. */
  function doctorFromUrl() {
    var v = null;
    try { v = new URLSearchParams(window.location.search).get("doctor"); } catch (e) { return null; }
    if (!v || !/^[1-9]\d{0,8}$/.test(v)) return null;
    var id = +v;
    return DOCTORS.filter(function (d) { return d.id === id; })[0] || null;
  }
  /** Clears only the filters that would hide this doctor. */
  function revealDoctor(d) {
    state.query = "";
    if (state.specialty && state.specialty !== d.specialty) state.specialty = "";
    if (state.hospitals.indexOf(d.hospital) === -1 && NETWORKS.indexOf(d.hospital) !== -1) state.hospitals.push(d.hospital);
    if (state.cnasOnly && d.acceptsCNAS !== true) state.cnasOnly = false;
    state.highlight = d.id;
  }
  function focusLinkedDoctor(d) {
    pinUntil = Date.now() + 3000;
    var unpin = function () {
      pinUntil = 0;
      ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (t) { window.removeEventListener(t, unpin, true); });
    };
    ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (t) { window.addEventListener(t, unpin, true); });
    setTimeout(unpin, 3000);
    var go = function () {
      var li = document.querySelector('#grid li[data-doctor-id="' + d.id + '"]');
      if (!li) return;
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      li.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      var card = li.querySelector(".card");
      if (card) { try { card.focus({ preventScroll: true }); } catch (e) { card.focus(); } }
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(function () { setTimeout(go, 30); }); else setTimeout(go, 30);
    setTimeout(function () {
      if (state.highlight !== d.id) return;
      state.highlight = null;
      Array.prototype.forEach.call(document.querySelectorAll("#grid .card.is-highlighted"), function (c) { c.classList.remove("is-highlighted"); });
    }, 8000);
  }

  /* Language switch: re-translate everything app.js renders, keeping filters, sort and scroll. */
  var langHooks = [];
  function onLangChange() {
    specHayCache = {};
    if ($("mi-fav-live")) $("mi-fav-live").textContent = "";
    if ($("specialty")) populateSpecialties();
    if (locStatus) setLocStatus(locStatus.key, locStatus.vars);
    if ($("footer-source")) renderFooter();
    langHooks.forEach(function (cb) { try { cb(uiLang()); } catch (e) { console.error(e); } });
    if (DOCTORS.length && $("grid")) rerenderKeepScroll();
    else if ($("results-count") && !DOCTORS.length) $("results-count").textContent = trn("dir.count", 0);
  }
  document.addEventListener("medindex:lang", onLangChange);

  /* Auth / Premium changes and new reviews: refetch distinctions; favourites load once per user. */
  function onAuth() { loadFavourites(); refreshDistinctions(); }
  document.addEventListener("medindex:auth", function () { setTimeout(onAuth, 0); });
  if (window.MedIndex && window.MedIndex.reviews && typeof window.MedIndex.reviews.onChange === "function") {
    window.MedIndex.reviews.onChange(function () { refreshDistinctions(); });
  }

  // Expose pure functions for console testing during the demo.
  // Object.assign keeps the engine/ranking/reviews namespaces loaded before app.js.
  function currentFilters() {
    return { query: state.query, specialty: state.specialty, hospitals: state.hospitals.slice(), cnasOnly: state.cnasOnly };
  }

  function sortOption(key) {
    return document.querySelector('#sort option[value="' + key + '"]');
  }

  function setSortEnabled(key, enabled) {
    var entry = customSorts[key];
    if (!entry) return;
    entry.enabled = !!enabled;
    var opt = sortOption(key);
    if (opt) opt.disabled = !enabled;
    if (!enabled && state.sort === key) state.sort = "recommended";
  }

  Object.assign(window.MedIndex = window.MedIndex || {}, {
    normalizeText: normalizeText,
    haversineKm: haversineKm,
    filterDoctors: filterDoctors,
    sortDoctors: sortDoctors,
    render: function () { render(state); },
    state: state
  });

  /* Small integration API used by assistant/ui.js. */
  window.MedIndex.app = {
    getState: function () {
      var f = currentFilters();
      f.sort = state.sort;
      f.origin = state.origin ? Object.assign({}, state.origin) : null;
      return f;
    },
    getFilters: currentFilters,
    /** The validated doctor list (same records the grid uses). */
    getDoctors: function () { return DOCTORS.slice(); },
    /** Doctors matching the CURRENT main-list filters. */
    filterCurrent: function (doctors) { return filterDoctors(doctors || DOCTORS, currentFilters()); },
    setSpecialty: function (specialty) {
      var exists = !specialty || DOCTORS.some(function (d) { return d.specialty === specialty; });
      state.specialty = exists ? (specialty || "") : "";
      render(state);
      return exists;
    },
    setSort: function (key) {
      if (customSorts[key] && !customSorts[key].enabled) return false;
      state.sort = key;
      render(state);
      return true;
    },
    getOrigin: function () { return state.origin ? Object.assign({}, state.origin) : null; },
    haversineKm: haversineKm,
    distanceFor: distanceFor,
    onRender: function (cb) { if (typeof cb === "function") renderHooks.push(cb); },
    onBeforeRender: function (cb) { if (typeof cb === "function") beforeRenderHooks.push(cb); },
    rerender: function () { render(state); },
    /** registerSort(key, label, compareFn(a, b), enabled): adds/updates a sort option. */
    registerSort: function (key, label, compare, enabled) {
      customSorts[key] = { label: label, compare: compare, enabled: false };
      var opt = sortOption(key);
      if (!opt) {
        opt = el("option", null, label);
        opt.value = key;
        $("sort").appendChild(opt);
      } else if (label) {
        opt.textContent = label;
      }
      setSortEnabled(key, enabled);
    },
    setSortEnabled: setSortEnabled,
    /* i18n + Premium helpers shared with assistant/ui.js */
    tr: tr,
    trn: trn,
    uiLang: uiLang,
    specLabel: specLabel,
    kmText: kmText,
    distText: distText,
    formatDate: formatDate,
    buildNameRow: buildNameRow,
    buildHeart: buildHeart,
    onLangChange: function (cb) { if (typeof cb === "function") langHooks.push(cb); },
    /** Test/debug snapshot. */
    premiumState: function () { return { distinctions: Object.keys(prem.distinct).map(Number), favourites: Object.keys(prem.favs).map(Number), favLoaded: prem.favLoaded, favDisabled: prem.favDisabled }; },
    refreshPremium: function () { prem.favLoaded = false; prem.favUser = undefined; onAuth(); }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
