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
        var hay = normalizeText(d.name) + " | " + normalizeText(d.specialty);
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
    var card = el("article", "card");
    card.setAttribute("aria-labelledby", "doc-" + doctor.id + "-name");
    li.appendChild(card);

    /* Top: avatar + identity */
    var top = el("div", "card-top");
    top.appendChild(buildAvatar(doctor));
    var ident = el("div", "card-ident");
    var name = el("h2", "card-name", doctor.name);
    name.id = "doc-" + doctor.id + "-name";
    ident.appendChild(name);
    ident.appendChild(el("p", "card-specialty", doctor.specialty));

    var badges = el("div", "badges");
    var hb = el("span", "badge badge-hospital badge-" + hospitalSlug(doctor.hospital), doctor.hospital);
    badges.appendChild(hb);
    if (doctor.medicalRank) {
      var senior = doctor.medicalRank === SENIOR_RANK;
      var rank = el("span", "badge badge-rank" + (senior ? " is-senior" : ""));
      if (senior) rank.appendChild(icon("star"));
      rank.appendChild(el("span", null, doctor.medicalRank));
      badges.appendChild(rank);
    }
    if (doctor.manual === true) {
      var manual = el("span", "badge badge-manual");
      manual.appendChild(icon("hand"));
      manual.appendChild(el("span", null, "Manually collected"));
      manual.title = "Entered by hand from the network's public page";
      badges.appendChild(manual);
    }
    top.appendChild(ident);
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
      var srcLink = el("a", "source-link", "Source");
      srcLink.href = srcUrl;
      srcLink.target = "_blank";
      srcLink.rel = "noopener noreferrer";
      srcLink.setAttribute("aria-label", "Price source for " + doctor.name + " (opens in a new tab)");
      srcWrap.appendChild(srcLink);
      meta.appendChild(srcWrap);
    }
    price.appendChild(meta);
    var checked = formatDate(doctor.scrapedAt);
    if (checked) price.appendChild(el("p", "price-checked", "Checked on " + checked));
    card.appendChild(price);

    /* Location */
    var loc = el("div", "card-loc");
    if (doctor.clinicName) loc.appendChild(el("p", "clinic", doctor.clinicName));
    var where = el("p", "where");
    where.appendChild(icon("pin", "icon-pin"));
    var whereText = el("span", null, doctor.area || doctor.address || "Bucharest");
    where.appendChild(whereText);
    var km = distanceFor(doctor, origin);
    if (km != null) {
      where.appendChild(el("span", "distance",
        formatKm(km) + " from " + (origin.kind === "gps" ? "you" : origin.label)));
    }
    loc.appendChild(where);
    if (doctor.address && doctor.area) loc.appendChild(el("p", "address", doctor.address));
    card.appendChild(loc);

    /* Footer: CNAS + profile */
    var foot = el("div", "card-foot");
    var cnas = el("p", "cnas " + (doctor.acceptsCNAS ? "is-yes" : "is-no"));
    cnas.appendChild(icon(doctor.acceptsCNAS ? "check" : "cross"));
    cnas.appendChild(el("span", null, doctor.acceptsCNAS ? "CNAS accepted" : "Private pay only"));
    foot.appendChild(cnas);

    var profileUrl = safeUrl(doctor.profileUrl);
    if (profileUrl) {
      var btn = el("a", "btn btn-primary profile-btn");
      btn.href = profileUrl;
      btn.target = "_blank";
      btn.rel = "noopener noreferrer";
      btn.setAttribute("aria-label", "View profile of " + doctor.name + " (opens in a new tab)");
      btn.appendChild(el("span", null, "View profile"));
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
    $("results-count").textContent = count + (count === 1 ? " doctor" : " doctors");

    var grid = $("grid");
    var frag = document.createDocumentFragment();
    sorted.forEach(function (d) { frag.appendChild(buildCard(d, s.origin)); });
    grid.replaceChildren(frag);

    $("empty").hidden = count !== 0;
    grid.hidden = count === 0;
    $("sort-hint").hidden = !(s.sort === "nearest" && !s.origin);

    syncControls(s);
    renderHooks.forEach(function (cb) { try { cb(sorted, s); } catch (e) { console.error(e); } });
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
    var status = $("location-status");
    if (s.origin) {
      status.textContent = s.origin.kind === "gps" ? "Using your current location." : "Distances from " + s.origin.label + ".";
    }
  }

  /* ---------- Setup ---------- */

  function populateSpecialties() {
    var seen = {};
    DOCTORS.forEach(function (d) { if (d.specialty) seen[d.specialty] = true; });
    var select = $("specialty");
    Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, "en"); }).forEach(function (s) {
      var opt = el("option", null, s);
      opt.value = s;
      select.appendChild(opt);
    });
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
      if (!state.origin) $("location-status").textContent = "Location not set.";
      render(state);
    });
  }

  function showAreaPicker(message) {
    $("area-picker").hidden = false;
    if (message) $("location-status").textContent = message;
  }

  function requestLocation(userInitiated) {
    if (!("geolocation" in navigator)) {
      showAreaPicker("Location is not available in this browser. Pick an area instead.");
      return;
    }
    if (userInitiated) $("location-status").textContent = "Finding your location…";
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
        ? "Location permission was denied. Pick an area instead."
        : "We couldn't get your location. Pick an area instead.";
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
    $("footer-source").textContent =
      "Data collected from public pages of each network" + (when ? " on " + when : "") +
      ". Prices may change; confirm with the clinic before booking.";

    var manualCount = DOCTORS.filter(function (d) { return d.manual === true; }).length;
    if (manualCount) {
      var p = $("footer-manual");
      p.replaceChildren();
      var tag = el("span", "badge badge-manual");
      tag.appendChild(icon("hand"));
      tag.appendChild(el("span", null, "Manually collected"));
      p.appendChild(tag);
      p.appendChild(document.createTextNode(
        " " + manualCount + (manualCount === 1 ? " record was" : " records were") +
        " copied by hand from the network's public website where automatic collection was not possible."));
      p.hidden = false;
    }
  }

  function showNoData() {
    var notice = $("data-notice");
    notice.replaceChildren();
    notice.appendChild(el("h2", null, "No data yet, run the scraper"));
    var p = el("p", null, "The file data/doctors.js was not found or contains no doctors. Run the scraper to generate it, then reload this page.");
    notice.appendChild(p);
    notice.hidden = false;
    $("results-count").textContent = "0 doctors";
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

    $("filters-form").addEventListener("submit", function (e) { e.preventDefault(); });
    $("search").addEventListener("input", function (e) { state.query = e.target.value; render(state); });
    $("specialty").addEventListener("change", function (e) { state.specialty = e.target.value; render(state); });
    $("sort").addEventListener("change", function (e) { state.sort = e.target.value; render(state); });
    $("cnas-switch").addEventListener("click", function () { state.cnasOnly = !state.cnasOnly; render(state); });
    $("reset-filters").addEventListener("click", resetFilters);
    $("empty-reset").addEventListener("click", function () { resetFilters(); $("search").focus(); });
    $("use-location").addEventListener("click", function () { requestLocation(true); });

    render(state);
    requestLocation(false);
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
    setSortEnabled: setSortEnabled
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
