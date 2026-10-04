/* MedIndex – assistant UI (chat panel, Top picks, ratings).
 * Classic script, no modules, no fetch. Loaded after app.js (defer keeps the order).
 * Uses MedIndex.engine / ranking / reviews / app. All dynamic text goes through textContent;
 * innerHTML is used only for the static SVG icon strings below.
 * The chat is never stored: it lives in memory and is gone on reload.
 *
 * Conversation: a natural chat. The bot asks one question at a time in plain language and the user
 * types the answer (or taps an optional answer chip, which sends its label as a normal message).
 * A "round" = the user's messages since the last recommendation; at most 10 per round.
 *
 * Turn flow (runTurn):
 *   1. Local red-flag check on the whole conversation. On a red flag: 112 banner, NOTHING is sent, no doctors.
 *   2. engine.extractFacts() reads who / how long / how strong from the round so far.
 *   3. AI mode (engine.USE_LLM): the in-memory history + the local facts + the message count go to the
 *      Kimi proxy; the reply is rendered as text only (paragraphs / "- " bullets), plus specialty cards
 *      when the model recommends, or answer chips for the fact it asks about ("asking").
 *      At the 10th message without a recommendation, the rule engine recommends instead.
 *   4. Rule mode, or any AI failure (offline proxy, timeout, quota, invalid output): engine.converse()
 *      answers that message (a question or the recommendation), with a short "basic mode" note on failure.
 *
 * Accounts (window.MedIndexAPI from js/api.js + window.MedIndexNav from js/nav.js, both optional; when
 * they are missing or the page is file://, everything behaves as logged out / offline):
 *   - Ratings and written reviews come from the server (assistant/reviews.js). "Rate this doctor" asks
 *     logged-out users to sign in; "Reviews (N)" opens a dialog with the reviews the server returns.
 *   - Premium cloud history: for premium users each conversation is saved as a server chat (created on the
 *     first user message, then each user message + bot reply with meta {suggestions, redFlag}). The server
 *     decides (403 = not premium -> silently not saved). A save failure never breaks the chat: one silent
 *     retry, then a small "History not saved" note. "History" lists saved chats; one opens read-only with
 *     "Continue this chat" / "New chat". Regular and logged-out users: nothing is saved.
 *   - Deep links: #assistant opens the panel; #assistant&chat=<id> also opens that saved chat (premium).
 */
(function () {
  "use strict";

  var MI = window.MedIndex = window.MedIndex || {};
  var engine = MI.engine, ranking = MI.ranking, reviews = MI.reviews, app = MI.app;
  if (!engine || !ranking || !reviews || !app) {
    console.warn("MedIndex assistant: a required module is missing; the assistant is disabled.");
    return;
  }

  var MAX_TURNS = engine.MAX_TURNS || 10;
  var MOBILE_MQ = window.matchMedia("(max-width: 1023px)");

  /* ---------- Static icons (only place innerHTML is used) ---------- */
  var STAR_PATH = "M12 2.5l2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6L2.5 9.3l6.6-.8z";
  var ICONS = {
    history: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8v4.5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chat: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 8.5h8M8 12h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 12l16-8-6 16-2.5-6.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    restart: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    phone: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" fill="currentColor"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 2.8 1.6 21h20.8z" fill="currentColor"/><path d="M12 9.5v5" stroke="#fff8e1" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.3" fill="#fff8e1"/></svg>',
    alert: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false"><path d="M12 3l10 18H2z" fill="currentColor"/><path d="M12 10v5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="18" r="1.4" fill="#fff"/></svg>',
    medal: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M7 2h4l2 5H9zM13 2h4l-2 5h-2z" fill="currentColor" opacity=".7"/><circle cx="12" cy="15" r="6.5" fill="currentColor"/><circle cx="12" cy="15" r="4.2" fill="none" stroke="#fff" stroke-width="1.4" opacity=".85"/></svg>',
    external: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    starFill: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + STAR_PATH + '" fill="currentColor"/></svg>',
    starLine: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + STAR_PATH + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  };

  /* ---------- UI strings (js/i18n-directory.js via app.tr; chat.* / dir.* / reviews.* keys) ---------- */
  function T(key, vars, lang) { return app.tr ? app.tr(key, vars, lang) : key; }
  function TN(base, n, vars, lang) { return app.trn ? app.trn(base, n, vars, lang) : base; }
  function S(key, lang) { return T("chat." + key, null, lang || "en"); }
  function confText(label, lang) { var k = "chat.conf." + label, v = T(k, null, lang); return v === k ? label : v; }
  function uiLang() { return app.uiLang ? app.uiLang() : "en"; }
  function spec(name) { return app.specLabel ? app.specLabel(name) : name; }
  /** Sets a UI-language text and marks it for js/i18n.js apply() on a language switch. */
  function L(node, key) { node.textContent = T(key); node.setAttribute("data-i18n", key); return node; }
  function LA(node, attr, key) {
    node.setAttribute(attr, T(key));
    var cur = (node.getAttribute("data-i18n-attr") || "").split(";").filter(function (p) { return p && p.indexOf(attr + ":") !== 0; });
    cur.push(attr + ":" + key);
    node.setAttribute("data-i18n-attr", cur.join(";"));
    return node;
  }
  function lbutton(className, key, iconName) {
    var b = button(className, null, iconName);
    b.appendChild(L(el("span"), key));
    return b;
  }

  /* ---------- State (in memory only, never persisted) ---------- */
  // history: [{role: "user"|"assistant", content}] sent to the AI with each turn; memory only.
  // redFlag: once an emergency was shown (local rules or the AI), every later turn shows the banner
  // again, sends nothing and shows no doctors, until Start over.
  // cid: random id of this conversation (new on Start over); every history item gets an increasing
  // index n. The proxy signs each AI reply with (cid, n, text), so turns can't be replayed or reordered.
  function newConversationId() {
    var a = new Uint8Array(16), out = "";
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a);
    else for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < a.length; j++) out += (a[j] < 16 ? "0" : "") + a[j].toString(16);
    return out;
  }
  // round: the user's messages since the last recommendation (msgs), what the bot asked right before
  // each one (asked[i]: "who" | "duration" | "severity" | "clarify" | null), the pending question
  // (lastAsked), facts carried over from the previous round (base: who), and whether it ended (done).
  function newRound(base, afterRec) {
    return { msgs: [], asked: [], lastAsked: null, base: base || {}, done: false, afterRec: !!afterRec, facts: null };
  }
  function newChat(turn) {
    return { text: "", lang: "en", turn: turn || 0, busy: false, history: [], redFlag: false,
             cid: newConversationId(), nextN: 0, round: newRound(), scores: {}, pending: null };
  }
  var chat = newChat(0);
  var ctx = { active: false, suggestions: [], lang: "en" };
  var preset = ranking.DEFAULT_PRESET || "best";
  var rankCache = { byId: {}, list: [] };

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
  function srOnly(text) { return el("span", "mi-sr-only", text); }
  function button(className, text, iconName) {
    var b = el("button", className);
    b.type = "button";
    if (iconName) b.appendChild(icon(iconName));
    if (text != null) b.appendChild(el("span", null, text));
    return b;
  }
  function safeUrl(url) { return /^https?:\/\//i.test(String(url || "")) ? String(url) : null; }
  function $(id) { return document.getElementById(id); }
  function isMobile() { return MOBILE_MQ.matches; }
  function hasCoords(d) {
    return d && typeof d.lat === "number" && typeof d.lng === "number" && isFinite(d.lat) && isFinite(d.lng);
  }

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  function focusables(container) {
    return Array.prototype.filter.call(container.querySelectorAll(FOCUSABLE), function (n) {
      return n.offsetParent !== null || n === document.activeElement;
    });
  }
  /** Keeps Tab / Shift+Tab inside container. */
  function trapTab(e, container) {
    if (e.key !== "Tab") return;
    var items = focusables(container);
    if (!items.length) { e.preventDefault(); return; }
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
      e.preventDefault(); first.focus();
    }
  }

  /* ---------- Stars ---------- */
  /** Five stars, partially filled to `value` (0..5). Decorative; the caller sets the label. */
  function starRow(value, className) {
    var wrap = el("span", "mi-stars" + (className ? " " + className : ""));
    for (var i = 1; i <= 5; i++) {
      var fill = Math.max(0, Math.min(1, (value || 0) - (i - 1)));
      fill = Math.round(fill * 2) / 2; // halves
      var star = el("span", "mi-star");
      star.appendChild(icon("starLine", "mi-star-line"));
      var f = icon("starFill", "mi-star-fill");
      f.style.width = (fill * 100) + "%";
      star.appendChild(f);
      wrap.appendChild(star);
    }
    return wrap;
  }

  function formatRating(v) { return (Math.round(v * 10) / 10).toFixed(1); }

  /** "★★★★☆ 4.6 (23) · Source" or empty stars + "No ratings yet" (never 0.0). */
  function buildStarsLine(doctor) {
    var c = reviews.combinedRating(doctor);
    var line = el("p", "mi-stars-line");
    var srcLabel = function (lab) { return lab === reviews.LABEL ? T("reviews.label") : lab; };
    if (c.count > 0 && typeof c.value === "number") {
      var v = formatRating(c.value);
      var stars = starRow(c.value);
      stars.setAttribute("role", "img");
      stars.setAttribute("aria-label", TN("reviews.starsAria", c.count, { v: app.uiLang && uiLang() === "ro" ? v.replace(".", ",") : v }));
      line.appendChild(stars);
      var num = el("span", "mi-stars-num", v + " (" + c.count + ")");
      num.setAttribute("aria-hidden", "true");
      line.appendChild(num);
      var src = el("span", "mi-stars-src");
      src.appendChild(document.createTextNode("· "));
      c.sources.forEach(function (s, i) {
        if (i) src.appendChild(document.createTextNode(", "));
        var url = safeUrl(s.url);
        if (url) {
          var a = el("a", "mi-src-link", srcLabel(s.label));
          a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
          a.setAttribute("aria-label", T("reviews.newTab", { label: srcLabel(s.label) }));
          src.appendChild(a);
        } else {
          src.appendChild(el("span", null, srcLabel(s.label)));
        }
      });
      line.appendChild(src);
    } else {
      var empty = starRow(0, "is-empty");
      empty.setAttribute("role", "img");
      empty.setAttribute("aria-label", T("reviews.noRatings"));
      line.appendChild(empty);
      var none = el("span", "mi-stars-none", T("reviews.noRatings"));
      none.setAttribute("aria-hidden", "true");
      line.appendChild(none);
    }
    return line;
  }

  function matchChip(result) {
    var chip = el("span", "badge mi-match", T("reviews.match", { n: result.score }));
    chip.title = T("reviews.matchTitle");
    return chip;
  }

  /* ---------- Accounts (optional js/api.js + js/nav.js) ---------- */
  function api() { return window.MedIndexAPI || null; }
  // auth.user: undefined = not known yet; null = logged out. js/nav.js starts with user = null and
  // ready = false, so its user only counts once ready is true or a "medindex:auth" event arrived.
  var auth = { user: undefined, eventSeen: false };
  function navReady() { var nav = window.MedIndexNav; return !!(nav && nav.ready === true); }
  function currentUser() {
    if (auth.eventSeen) return auth.user || null;
    if (navReady()) return window.MedIndexNav.user || null;
    return auth.user || null;
  }
  function authKnown() {
    if (auth.eventSeen || navReady()) return true;
    return !window.MedIndexNav && auth.user !== undefined;
  }
  /** UI hint only: the server decides what a user may do. */
  function isPremium() {
    var u = currentUser();
    return !!(u && u.premium && u.premium.active);
  }
  var SIGNIN_URL = "account.html?next=doctors.html";
  var SIGNUP_URL = "account.html?mode=register&next=doctors.html";
  function localServerMsg() { return T("reviews.localMsg"); }

  function formatDay(iso) {
    if (app.formatDate) return app.formatDate(iso);
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return "";
    var M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return d.getDate() + " " + M[d.getMonth()] + " " + d.getFullYear();
  }

  /* ---------- Card decoration (called by app.js for each grid card) ---------- */
  function decorateCard(card, doctor) {
    var box = el("div", "mi-card-rating");
    box.setAttribute("data-doctor-id", String(doctor.id));
    box.tabIndex = -1;
    box.appendChild(buildStarsLine(doctor));
    var actions = el("div", "mi-card-rating-actions");
    actions.appendChild(buildRateControl(doctor));
    actions.appendChild(buildReviewsButton(doctor));
    box.appendChild(actions);

    var badges = card.querySelector(".badges");
    var r = ctx.active ? rankCache.byId[doctor.id] : null;
    if (r && badges) badges.appendChild(matchChip(r));

    var price = card.querySelector(".price");
    if (price) card.insertBefore(box, price); else card.appendChild(box);
  }

  function buildRateControl(doctor) {
    var mine = reviews.getReview(doctor.id);
    if (mine) {
      var done = el("button", "btn btn-ghost mi-rate-btn is-done");
      done.type = "button";
      done.disabled = true;
      done.appendChild(el("span", null, T("reviews.rated")));
      var st = el("span", "mi-rated-stars", "★" + mine.stars);
      st.setAttribute("aria-hidden", "true");
      done.appendChild(st);
      done.appendChild(srOnly(TN("reviews.ratedSr", mine.stars)));
      return done;
    }
    var b = button("btn btn-ghost mi-rate-btn", T("reviews.rate"));
    b.setAttribute("aria-label", T("reviews.rateAria", { name: doctor.name }));
    b.setAttribute("aria-haspopup", "dialog");
    b.addEventListener("click", function () { onRateClick(doctor, b); });
    return b;
  }

  function buildReviewsButton(doctor) {
    var s = reviews.summaryFor ? reviews.summaryFor(doctor.id) : null;
    var n = s ? s.count : 0;
    var offline = reviews.isOffline && reviews.isOffline();
    var b = button("btn btn-ghost mi-reviews-btn", offline ? T("reviews.button") : T("reviews.buttonN", { n: n }));
    b.setAttribute("aria-haspopup", "dialog");
    b.setAttribute("aria-label", offline ? T("reviews.ariaOffline", { name: doctor.name })
      : TN("reviews.aria", n, { name: doctor.name }));
    b.addEventListener("click", function () { openReviews(doctor, b); });
    return b;
  }

  function onRateClick(doctor, trigger) {
    if (reviews.isOffline && reviews.isOffline()) {
      openInfoDialog(trigger, doctor.id, T("reviews.localTitle"), localServerMsg());
      return;
    }
    if (!currentUser()) { openSignIn(trigger, doctor.id); return; }
    // Logged in: ask the server whether this user already reviewed this doctor.
    trigger.setAttribute("aria-busy", "true");
    reviews.list(doctor.id, function () {
      trigger.removeAttribute("aria-busy");
      if (reviews.hasReviewed(doctor.id)) { app.rerender(); focusRatingBox(doctor.id); return; }
      openRating(doctor, trigger);
    });
  }

  function focusRatingBox(doctorId) {
    var box = document.querySelector('#grid .mi-card-rating[data-doctor-id="' + String(doctorId) + '"]');
    if (box) box.focus();
    return box;
  }

  /* ---------- Dialogs (rating, sign-in, reviews, info) ---------- */
  var rating = null; // the open dialog: { overlay, trigger, doctorId }

  /** Creates and opens an accessible modal; returns the dialog element. */
  function modalShell(titleText, trigger, doctorId, extraClass, describedBy) {
    if (rating) closeRating(false);
    var overlay = el("div", "mi-rate-overlay");
    var dlg = el("div", "mi-rate-dialog" + (extraClass ? " " + extraClass : ""));
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.setAttribute("aria-labelledby", "mi-rate-title");
    if (describedBy) dlg.setAttribute("aria-describedby", describedBy);
    overlay.appendChild(dlg);
    dlg.appendChild(el("h2", "mi-rate-title", titleText)).id = "mi-rate-title";
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) closeRating(true); });
    dlg.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeRating(true); return; }
      trapTab(e, dlg);
    });
    rating = { overlay: overlay, trigger: trigger, doctorId: doctorId };
    document.body.appendChild(overlay);
    document.documentElement.classList.add("mi-rate-open");
    return dlg;
  }
  function linkButton(className, text, href) {
    var a = el("a", className, text);
    a.href = href;
    return a;
  }

  function openInfoDialog(trigger, doctorId, title, text) {
    var dlg = modalShell(title, trigger, doctorId, "mi-info-dialog", "mi-info-text");
    var p = el("p", "mi-rate-help", text);
    p.id = "mi-info-text";
    dlg.appendChild(p);
    var actions = el("div", "mi-rate-actions");
    var ok = button("btn btn-primary", T("reviews.ok"));
    ok.addEventListener("click", function () { closeRating(true); });
    actions.appendChild(ok);
    dlg.appendChild(actions);
    ok.focus();
  }

  function openSignIn(trigger, doctorId) {
    var dlg = modalShell(T("reviews.signinTitle"), trigger, doctorId, "mi-signin-dialog", "mi-signin-text");
    var p = el("p", "mi-rate-help", T("reviews.signinText"));
    p.id = "mi-signin-text";
    dlg.appendChild(p);
    var actions = el("div", "mi-rate-actions");
    var signIn = linkButton("btn btn-primary mi-signin-link", T("reviews.signIn"), SIGNIN_URL);
    var create = linkButton("btn btn-secondary mi-signup-link", T("reviews.createAccount"), SIGNUP_URL);
    var cancel = button("btn btn-ghost mi-signin-cancel", T("reviews.cancel"));
    cancel.addEventListener("click", function () { closeRating(true); });
    actions.appendChild(signIn); actions.appendChild(create); actions.appendChild(cancel);
    dlg.appendChild(actions);
    signIn.focus();
  }

  function openRating(doctor, trigger) {
    var dlg = modalShell(T("reviews.rateTitle", { name: doctor.name }), trigger, doctor.id, null, "mi-rate-help");
    var help = el("p", "mi-rate-help", T("reviews.rateHelp"));
    help.id = "mi-rate-help";
    dlg.appendChild(help);

    var form = el("form", "mi-rate-form");
    form.noValidate = true;
    var fs = el("fieldset", "mi-rate-stars");
    fs.appendChild(el("legend", null, T("reviews.yourRating")));
    var row = el("div", "mi-rate-row");
    var labels = [];
    for (var i = 1; i <= 5; i++) {
      var id = "mi-rate-star-" + i;
      var input = el("input", "mi-rate-input");
      input.type = "radio"; input.name = "mi-rate-stars"; input.id = id; input.value = String(i);
      var lab = el("label", "mi-rate-star");
      lab.setAttribute("for", id);
      lab.appendChild(icon("starFill"));
      lab.appendChild(srOnly(TN("reviews.star", i)));
      row.appendChild(input);
      row.appendChild(lab);
      labels.push(lab);
    }
    fs.appendChild(row);
    var chosen = el("p", "mi-rate-chosen", T("reviews.noStars"));
    chosen.setAttribute("aria-hidden", "true");
    fs.appendChild(chosen);
    form.appendChild(fs);

    function paint(n) { labels.forEach(function (l, idx) { l.classList.toggle("is-on", idx < n); }); }
    function current() { var c = form.querySelector(".mi-rate-input:checked"); return c ? +c.value : 0; }
    row.addEventListener("change", function () {
      var n = current(); paint(n);
      chosen.textContent = n ? TN("reviews.chosen", n) : T("reviews.noStars");
      err.hidden = true;
    });
    labels.forEach(function (l, idx) {
      l.addEventListener("mouseenter", function () { paint(idx + 1); });
    });
    row.addEventListener("mouseleave", function () { paint(current()); });

    var cField = el("div", "mi-rate-field");
    var cLabel = el("label", null, T("reviews.comment"));
    cLabel.setAttribute("for", "mi-rate-comment");
    var ta = el("textarea", "mi-rate-comment");
    ta.id = "mi-rate-comment"; ta.rows = 3; ta.maxLength = reviews.MAX_COMMENT || 280;
    ta.setAttribute("aria-describedby", "mi-rate-count");
    var count = el("p", "mi-rate-count", T("reviews.chars", { n: 0, max: ta.maxLength }));
    count.id = "mi-rate-count";
    ta.addEventListener("input", function () { count.textContent = T("reviews.chars", { n: ta.value.length, max: ta.maxLength }); });
    cField.appendChild(cLabel); cField.appendChild(ta); cField.appendChild(count);
    form.appendChild(cField);

    var err = el("p", "mi-rate-error");
    err.setAttribute("role", "alert");
    err.hidden = true;
    form.appendChild(err);

    var actions = el("div", "mi-rate-actions");
    var submit = el("button", "btn btn-primary", T("reviews.submit"));
    submit.type = "submit";
    var cancel = button("btn btn-ghost", T("reviews.cancel"));
    cancel.addEventListener("click", function () { closeRating(true); });
    actions.appendChild(submit); actions.appendChild(cancel);
    form.appendChild(actions);
    dlg.appendChild(form);

    var mine = rating;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (submit.disabled) return;
      var stars = current();
      if (!stars) { showErr(T("reviews.errChoose")); form.querySelector(".mi-rate-input").focus(); return; }
      submit.disabled = true;
      reviews.addReview(doctor.id, stars, ta.value, function (e2) {
        if (rating !== mine) return; // the dialog was closed meanwhile
        submit.disabled = false;
        if (!e2) { closeRating(true); return; }
        if (e2.code === "auth") { openSignIn(mine.trigger, doctor.id); return; }
        if (e2.code === "duplicate") { showErr(T("reviews.errDuplicate")); return; }
        if (e2.code === "offline") { showErr(T("reviews.errOffline")); return; }
        showErr(e2.error || T("reviews.errSave"));
      });
    });
    function showErr(msg) { err.textContent = msg; err.hidden = false; }
    form.querySelector(".mi-rate-input").focus();
  }

  /** Written reviews viewer: renders exactly what the server returns (it limits non-premium users). */
  function openReviews(doctor, trigger) {
    var dlg = modalShell(T("reviews.title", { name: doctor.name }), trigger, doctor.id, "mi-reviews-dialog");
    var body = el("div", "mi-reviews-body");
    body.setAttribute("aria-live", "polite");
    dlg.appendChild(body);
    var actions = el("div", "mi-rate-actions");
    var close = button("btn btn-ghost mi-reviews-close", T("reviews.close"));
    close.addEventListener("click", function () { closeRating(true); });
    actions.appendChild(close);
    dlg.appendChild(actions);
    close.focus();
    var mine = rating;

    if (reviews.isOffline && reviews.isOffline()) {
      body.appendChild(el("p", "mi-rate-help", localServerMsg()));
      return;
    }
    body.setAttribute("aria-busy", "true");
    body.appendChild(el("p", "mi-reviews-loading", T("reviews.loading")));
    reviews.list(doctor.id, function (err, data) {
      if (rating !== mine) return;
      body.removeAttribute("aria-busy");
      body.replaceChildren();
      if (err || !data) {
        body.appendChild(el("p", "mi-rate-help", err && err.status === 0 ? localServerMsg() : T("reviews.loadErr")));
        return;
      }
      var shown = Array.isArray(data.shown) ? data.shown : [];
      var total = typeof data.total === "number" ? data.total : shown.length;
      body.appendChild(buildStarsLine(doctor));
      if (!shown.length) {
        body.appendChild(el("p", "mi-reviews-empty", T("reviews.empty")));
      } else {
        var ul = el("ul", "mi-reviews-list");
        ul.setAttribute("aria-label", T("reviews.list"));
        shown.forEach(function (r) {
          var li = el("li", "mi-review");
          var head = el("div", "mi-review-head");
          var n = Number.isInteger(r && r.stars) ? Math.max(1, Math.min(5, r.stars)) : 0;
          var st = starRow(n);
          st.setAttribute("role", "img");
          st.setAttribute("aria-label", T("reviews.reviewStars", { n: n }));
          head.appendChild(st);
          head.appendChild(el("span", "mi-review-author", (r && r.author) ? String(r.author) : T("reviews.anon")));
          var day = formatDay(r && r.createdAt);
          if (day) head.appendChild(el("span", "mi-review-date", day));
          li.appendChild(head);
          if (r && r.comment) li.appendChild(el("p", "mi-review-comment", String(r.comment)));
          ul.appendChild(li);
        });
        body.appendChild(ul);
      }
      if (data.limited) {
        var foot = el("p", "mi-reviews-limited");
        foot.appendChild(document.createTextNode(T("reviews.limited", { shown: shown.length, total: total })));
        foot.appendChild(linkButton("mi-premium-link", T("reviews.seePremium"), "premium.html"));
        body.appendChild(foot);
      }
      if (reviews.hasReviewed(doctor.id)) app.rerender(); // the "You rated" state may be new
    });
  }

  function closeRating(returnFocus) {
    if (!rating) return;
    var r = rating;
    rating = null;
    r.overlay.remove();
    document.documentElement.classList.remove("mi-rate-open");
    if (!returnFocus) return;
    if (r.trigger && document.body.contains(r.trigger) && !r.trigger.disabled) { r.trigger.focus(); return; }
    // The card was re-rendered (review saved): focus its rating area instead.
    if (!focusRatingBox(r.doctorId) && panelOpen()) input.focus();
  }

  /* ---------- Ranking (shared by Top picks and the "Best match" sort) ---------- */
  function buildContext() {
    var origin = app.getOrigin();
    return {
      targetSpecialties: ctx.suggestions.map(function (s) { return { specialty: s.specialty, confidence: s.confidence }; }),
      distanceKm: origin ? function (d) { return hasCoords(d) ? app.haversineKm(origin, d) : null; } : null
    };
  }

  /** Called by app.js with the list filtered by the CURRENT main-list filters. */
  function computeRanking(list, s) {
    rankCache = { byId: {}, list: [] };
    if (!ctx.active) return;
    var candidates = reviews.withRatings(list || []);
    var res = ranking.rankDoctors(candidates, buildContext(), preset, { cnasOnly: !!(s && s.cnasOnly) });
    res.forEach(function (r) { rankCache.byId[r.doctor.id] = r; });
    rankCache.list = res;
  }

  function compareBest(a, b) {
    var ra = rankCache.byId[a.id], rb = rankCache.byId[b.id];
    var ia = ra ? ra.rank : Infinity, ib = rb ? rb.rank : Infinity;
    return ia === ib ? 0 : (ia < ib ? -1 : 1);
  }

  function setBestEnabled(on) {
    var key = on ? "dir.sort.best" : "dir.sort.bestOff";
    app.registerSort("best", T(key), compareBest, on);
    var opt = document.querySelector('#sort option[value="best"]');
    if (opt) opt.setAttribute("data-i18n", key); // js/i18n.js apply() keeps the right label on a switch
  }

  /* ---------- Top picks ---------- */
  var picks = null; // { mount, chips: {key: btn}, list, empty, note, sub }

  function buildPicksShell(mount) {
    mount.replaceChildren();
    var head = el("div", "mi-picks-head");
    var h = L(el("h2", "mi-picks-title"), "dir.picks.title");
    h.id = "top-picks-title";
    h.tabIndex = -1;
    head.appendChild(h);
    var sub = el("p", "mi-picks-sub");
    head.appendChild(sub);
    mount.appendChild(head);

    var group = el("div", "mi-chips mi-priority");
    group.setAttribute("role", "group");
    LA(group, "aria-label", "dir.picks.priority");
    var chips = {};
    ["best", "price", "nearest", "rated", "senior"].forEach(function (key) {
      var p = ranking.WEIGHT_PRESETS[key];
      if (!p) return;
      var b = button("mi-chip", null);
      L(b, "dir.picks.preset." + key);
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () {
        if (preset === key) return;
        preset = key;
        app.rerender();
      });
      chips[key] = b;
      group.appendChild(b);
    });
    mount.appendChild(group);

    var note = el("p", "help hint mi-picks-note");
    note.hidden = true;
    mount.appendChild(note);

    var list = el("ol", "mi-picks-list");
    mount.appendChild(list);
    var empty = L(el("p", "mi-picks-empty"), "dir.picks.empty");
    empty.hidden = true;
    mount.appendChild(empty);
    mount.appendChild(L(el("p", "mi-picks-disclaimer"), "dir.picks.disclaimer"));
    picks = { mount: mount, chips: chips, list: list, empty: empty, note: note, sub: sub };
  }

  function reasonFor(specialty) {
    for (var i = 0; i < ctx.suggestions.length; i++) {
      if (ctx.suggestions[i].specialty === specialty) return ctx.suggestions[i].reason;
    }
    return null;
  }

  function buildPickCard(r, i) {
    var d = r.doctor;
    var li = el("li", "mi-pick");
    var card = el("article", "mi-pick-card");
    card.setAttribute("aria-labelledby", "pick-" + d.id + "-name");
    li.appendChild(card);

    var top = el("div", "mi-pick-top");
    var medal = el("span", "mi-medal mi-medal-" + (i + 1));
    medal.setAttribute("role", "img");
    medal.setAttribute("aria-label", T("dir.picks.medal", { n: i + 1 }));
    medal.appendChild(icon("medal"));
    medal.appendChild(el("span", "mi-medal-num", "#" + (i + 1)));
    top.appendChild(medal);
    var ident = el("div", "mi-pick-ident");
    if (app.buildNameRow) ident.appendChild(app.buildNameRow("h3", "mi-pick-name", "pick-" + d.id + "-name", d));
    else { var name = el("h3", "mi-pick-name", d.name); name.id = "pick-" + d.id + "-name"; ident.appendChild(name); }
    ident.appendChild(el("p", "mi-pick-meta", spec(d.specialty) + " · " + d.hospital));
    top.appendChild(ident);
    var heart = app.buildHeart ? app.buildHeart(d) : null;
    if (heart) top.appendChild(heart);
    card.appendChild(top);

    var tags = el("div", "badges mi-pick-tags");
    tags.appendChild(matchChip(r));
    if (r.unrated) tags.appendChild(el("span", "badge mi-unrated", T("dir.picks.unrated")));
    card.appendChild(tags);

    var price = el("p", "mi-pick-price");
    price.appendChild(el("span", "mi-pick-price-value", String(d.priceRON)));
    price.appendChild(el("span", "price-currency", " RON"));
    if (d.priceService) price.appendChild(el("span", "mi-pick-service", d.priceService));
    card.appendChild(price);

    card.appendChild(buildStarsLine(d));
    if (typeof r.distanceKm === "number") {
      var o = app.getOrigin();
      card.appendChild(el("p", "mi-pick-dist", app.distText ? app.distText(r.distanceKm, o) : (Math.round(r.distanceKm * 10) / 10).toFixed(1) + " km"));
    }
    var reason = reasonFor(d.specialty);
    if (reason) {
      var rp = el("p", "mi-pick-reason");
      rp.appendChild(el("span", "mi-pick-reason-label", T("dir.picks.reason")));
      rp.appendChild(document.createTextNode(reason));
      card.appendChild(rp);
    }

    var det = el("details", "mi-why");
    det.appendChild(el("summary", null, T("dir.picks.why")));
    var ul = el("ul", "mi-why-list");
    (r.components || []).forEach(function (c) {
      var pts = Number.isInteger(c.points) ? String(c.points) : c.points.toFixed(1);
      if (uiLang() === "ro") pts = pts.replace(".", ",");
      ul.appendChild(el("li", null, T("dir.why." + (c.note || c.key)) + " +" + pts));
    });
    det.appendChild(ul);
    det.appendChild(el("p", "mi-why-total", T("dir.picks.total", { n: r.score })));
    card.appendChild(det);

    var url = safeUrl(d.profileUrl);
    if (url) {
      var a = el("a", "btn btn-primary mi-pick-profile");
      a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", T("dir.profileAria", { name: d.name }));
      a.appendChild(el("span", null, T("dir.profile")));
      a.appendChild(icon("external"));
      card.appendChild(a);
    }
    return li;
  }

  function renderTopPicks() {
    var mount = $("top-picks");
    if (!mount) return;
    if (!ctx.active) {
      mount.hidden = true;
      mount.replaceChildren();
      picks = null;
      return;
    }
    if (!picks || picks.mount !== mount || !mount.contains(picks.list)) buildPicksShell(mount);
    Object.keys(picks.chips).forEach(function (k) { picks.chips[k].setAttribute("aria-pressed", k === preset ? "true" : "false"); });
    var names = ctx.suggestions.map(function (s) { return spec(s.specialty); });
    picks.sub.textContent = T("dir.picks.sub", { list: names.join(", ") });
    var origin = app.getOrigin();
    picks.note.hidden = !(preset === "nearest" && !origin);
    L(picks.note, "dir.picks.note");

    var top = rankCache.list.slice(0, 3);
    var frag = document.createDocumentFragment();
    top.forEach(function (r, i) { frag.appendChild(buildPickCard(r, i)); });
    picks.list.replaceChildren(frag);
    picks.list.hidden = !top.length;
    picks.empty.hidden = !!top.length;
    mount.hidden = false;
  }

  /* ---------- Chat panel ---------- */
  var fab, panel, log, form, input, sendBtn, privacy, headRestart, headHistory, histView, cloudNote, cloudStatus, warnMsg, welcomeMsg;
  /** The warning follows the UI language (EN exact text / RO); the class marks which one is shown. */
  function paintWarning() {
    if (!warnMsg) return;
    var ro = uiLang() === "ro";
    warnMsg.className = "mi-warning-msg " + (ro ? "mi-warning-ro-main" : "mi-warning-en");
    warnMsg.setAttribute("lang", ro ? "ro" : "en");
  }

  function buildPanel() {
    fab = el("button", "mi-fab");
    fab.type = "button";
    fab.id = "mi-fab";
    fab.setAttribute("aria-haspopup", "dialog");
    fab.setAttribute("aria-expanded", "false");
    fab.setAttribute("aria-controls", "mi-panel");
    fab.appendChild(icon("chat"));
    fab.appendChild(L(el("span"), "chat.fab"));
    fab.addEventListener("click", openPanel);

    panel = el("div", "mi-panel");
    panel.id = "mi-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "mi-panel-title");
    panel.hidden = true;

    var head = el("div", "mi-panel-head");
    var title = L(el("h2", "mi-panel-title"), "chat.title");
    title.id = "mi-panel-title";
    head.appendChild(title);
    headHistory = lbutton("mi-icon-btn mi-head-history", "chat.history", "history");
    LA(headHistory, "aria-label", "chat.historyAria");
    headHistory.setAttribute("aria-expanded", "false");
    headHistory.setAttribute("aria-controls", "mi-history");
    headHistory.hidden = true; // premium only (UI hint; the server decides)
    headHistory.addEventListener("click", function () { if (histOpen()) closeHistory(true); else openHistory(); });
    head.appendChild(headHistory);
    headRestart = lbutton("mi-icon-btn mi-head-restart", "chat.startOver", "restart");
    headRestart.addEventListener("click", startOver);
    head.appendChild(headRestart);
    var close = button("mi-icon-btn mi-close", null, "close");
    LA(close, "aria-label", "chat.close");
    close.addEventListener("click", function () { closePanel(true); });
    head.appendChild(close);
    panel.appendChild(head);

    histView = el("section", "mi-history");
    histView.id = "mi-history";
    histView.setAttribute("aria-labelledby", "mi-history-title");
    histView.hidden = true;
    panel.appendChild(histView);

    log = el("div", "mi-log");
    log.setAttribute("aria-live", "polite");
    log.setAttribute("aria-relevant", "additions");
    LA(log, "aria-label", "chat.conversation");
    log.setAttribute("role", "log");
    panel.appendChild(log);

    var foot = el("div", "mi-panel-foot");
    // Always-visible warning directly above the message input.
    var warn = el("div", "mi-warning");
    warn.id = "mi-warning";
    warn.setAttribute("role", "note");
    warn.appendChild(icon("warn", "mi-warning-icon"));
    var warnText = el("p", "mi-warning-text");
    warnMsg = L(el("span", "mi-warning-msg"), "chat.warning");
    warnText.appendChild(warnMsg);
    paintWarning();
    warn.appendChild(warnText);
    foot.appendChild(warn);
    form = el("form", "mi-form");
    form.noValidate = true;
    var lab = L(el("label", "mi-sr-only"), "chat.inputLabel");
    lab.setAttribute("for", "mi-input");
    input = el("input", "mi-input");
    input.type = "text";
    input.id = "mi-input";
    input.autocomplete = "off";
    input.maxLength = 500;
    LA(input, "placeholder", "chat.placeholder");
    input.setAttribute("aria-describedby", "mi-warning mi-privacy");
    var send = sendBtn = el("button", "btn btn-primary mi-send");
    send.type = "submit";
    send.appendChild(icon("send"));
    send.appendChild(L(el("span"), "chat.send"));
    form.appendChild(lab);
    form.appendChild(input);
    form.appendChild(send);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (viewing) return;
      var t = input.value.trim();
      if (!t) { input.focus(); return; }
      input.value = "";
      sendUser(t);
    });
    foot.appendChild(form);
    privacy = L(el("p", "mi-privacy"), engine.USE_LLM ? "chat.llmNotice" : "chat.privacy");
    privacy.id = "mi-privacy";
    foot.appendChild(privacy);
    cloudNote = L(el("p", "mi-cloud-note"), "chat.cloudNote");
    cloudNote.id = "mi-cloud-note";
    cloudNote.hidden = true;
    foot.appendChild(cloudNote);
    cloudStatus = L(el("p", "mi-cloud-status"), "chat.cloudStatus");
    cloudStatus.id = "mi-cloud-status";
    cloudStatus.setAttribute("role", "status");
    cloudStatus.hidden = true;
    foot.appendChild(cloudStatus);
    if (!engine.USE_LLM && engine.FILE_MODE) {
      // Opened from disk: rule mode only (the proxy accepts only http://127.0.0.1:8000).
      var hint = L(el("p", "mi-file-hint"), "chat.fileHint");
      hint.id = "mi-file-hint";
      foot.appendChild(hint);
    }
    panel.appendChild(foot);

    panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (histOpen()) closeHistory(true); else closePanel(true);
        return;
      }
      trapTab(e, panel);
    });

    document.body.appendChild(fab);
    document.body.appendChild(panel);
  }

  function panelOpen() { return panel && !panel.hidden; }

  function openPanel() {
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    document.documentElement.classList.add("mi-panel-open");
    input.focus();
  }

  function closePanel(returnFocus) {
    if (!panelOpen()) return;
    panel.hidden = true;
    fab.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("mi-panel-open");
    if (returnFocus) fab.focus();
  }

  /* ---------- Messages ---------- */
  function addMsg(role, lang) {
    var m = el("div", "mi-msg mi-msg-" + role);
    m.setAttribute("lang", lang || "en");
    // Speaker label is UI chrome: use the UI language, not the message language.
    var ul = uiLang();
    var who = srOnly(role === "user" ? S("you", ul) + " " : S("bot", ul) + " ");
    who.setAttribute("lang", ul);
    m.appendChild(who);
    log.appendChild(m);
    return m;
  }
  function scrollToMsg(m) {
    // Show the start of the newest message.
    var top = m.offsetTop - 8;
    if (log.scrollHeight - top > log.clientHeight) log.scrollTop = top;
    else log.scrollTop = log.scrollHeight;
  }

  function addUserMsg(text) {
    var m = addMsg("user", chat.lang);
    m.removeAttribute("lang");
    m.appendChild(el("p", null, text));
    scrollToMsg(m);
  }

  function chipRow(label) {
    var row = el("div", "mi-chips");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", label);
    return row;
  }

  function startOverButton(lang) {
    var b = button("btn btn-ghost mi-restart", S("startOver", lang), "restart");
    b.addEventListener("click", startOver);
    return b;
  }

  /** The welcome + quick replies follow the UI language (rebuilt in place on a language switch). */
  function fillWelcome(m) {
    var lang = uiLang();
    m.replaceChildren();
    m.setAttribute("lang", lang);
    m.appendChild(srOnly(S("bot", lang) + " "));
    m.appendChild(el("p", null, (engine.WELCOME && (engine.WELCOME[lang] || engine.WELCOME.en)) || ""));
    var row = chipRow(S("quick", lang));
    (engine.QUICK_REPLIES || []).forEach(function (q) {
      var b = button("mi-chip", q.label[lang] || q.label.en);
      b.addEventListener("click", function () { var l = uiLang(); sendUser(q.text[l] || q.text.en); });
      row.appendChild(b);
    });
    m.appendChild(row);
  }
  function renderWelcome() {
    var m = addMsg("bot", uiLang());
    m.classList.add("mi-welcome");
    fillWelcome(m);
    welcomeMsg = m;
  }

  /** Language of a reply: the user's message language; ambiguous text (chips, numbers, "adult") -> the UI language. */
  function replyLang(text) {
    if (!text || isLanguageNeutral(text)) return uiLang();
    return engine.detectLanguage(text) === "ro" ? "ro" : "en";
  }

  /** UI language switch: chrome is re-labelled by js/i18n.js (data-i18n); this handles the rest. State is kept. */
  function onUiLang() {
    paintWarning();
    if (welcomeMsg && log && log.contains(welcomeMsg)) fillWelcome(welcomeMsg);
    Array.prototype.forEach.call(document.querySelectorAll(".mi-sugg-name[data-spec]"), function (n) {
      n.textContent = spec(n.getAttribute("data-spec"));
    });
    Array.prototype.forEach.call(document.querySelectorAll(".mi-show[data-spec]"), function (b) {
      b.setAttribute("aria-label", S("showDoctors", b.getAttribute("lang") || "en") + ": " + spec(b.getAttribute("data-spec")));
    });
    if (input) LA(input, "placeholder", viewing ? "chat.continueHint" : "chat.placeholder");
    var opt = document.querySelector('#sort option[value="best"]');
    if (opt && opt.getAttribute("data-i18n")) opt.textContent = T(opt.getAttribute("data-i18n"));
    if (histOpen()) openHistory();
    picks = null; // the Top picks shell is rebuilt by the next render
  }

  function availableSpecialties() {
    var seen = {}, out = [];
    app.getDoctors().forEach(function (d) { if (d.specialty && !seen[d.specialty]) { seen[d.specialty] = true; out.push(d.specialty); } });
    return out;
  }

  /** sig: the server's HMAC for an AI reply; unsigned assistant turns are never forwarded. */
  function pushHistory(role, content, sig) {
    if (!content) return;
    var item = { role: role, content: String(content).slice(0, 1500), n: chat.nextN++ };
    if (sig) item.sig = sig;
    chat.history.push(item);
    if (chat.history.length > 40) chat.history = chat.history.slice(-40);
  }

  /** Every user message (typed or a chip) goes through here, then through runTurn(). */
  function sendUser(text) {
    if (chat.busy || !text || viewing) return;
    lockFactChips(); // the pending question is now answered (by chip or by text)
    addUserMsg(text);
    pushHistory("user", text);
    chat.text = chat.text ? chat.text + "\n" + text : text;
    var r = chat.round;
    if (r.done) {
      if (continuesRound(text)) { r.done = false; r.lastAsked = null; } // more detail on the same problem: evidence accumulates
      else r = chat.round = newRound({ who: r.facts && r.facts.who }, true); // a new, unrelated complaint -> new round
    }
    r.msgs.push(text);
    r.asked.push(r.lastAsked);
    r.lastAsked = null;
    chat.pending = { user: text };
    if (histOpen()) closeHistory(false);
    runTurn();
  }

  var NEW_PROBLEM_RX = /\b(something else|another (problem|issue|thing|question|symptom)|a different (problem|issue|thing)|new problem|altceva|alta problema|o alta problema|alt simptom|alta intrebare|alta treaba)\b/;
  var ADDITIVE_RX = /\b(also|too|as well|plus|and|additionally|si|de asemenea|tot|la fel|inca|in plus)\b/;

  /**
   * After a recommendation: does this message add detail to the same problem (true: keep accumulating
   * the round, so confidence can rise or fall with the new evidence) or start a new, unrelated one (false)?
   */
  function continuesRound(text) {
    var r = chat.round;
    if (!r.msgs.length || !ctx.active || !ctx.suggestions.length) return false;
    if (engine.isThanks(text)) return false;
    var norm = engine.normalize ? engine.normalize(text) : String(text).toLowerCase();
    if (NEW_PROBLEM_RX.test(norm)) return false;
    var a;
    try { a = engine.analyze(text, { turn: MAX_TURNS }, availableSpecialties()); } catch (e) { return true; }
    if (!a || a.redFlag) return true;
    var own = (a.suggestions || []).filter(function (s) { return s.score > 0; });
    if (!own.length) return true; // no new body system / symptom: more detail on the current one
    var current = ctx.suggestions.map(function (s) { return s.specialty; });
    if (own.some(function (s) { return current.indexOf(s.specialty) >= 0; })) return true;
    return ADDITIVE_RX.test(norm); // "my knee hurts too": same conversation, the conflict lowers confidence
  }

  /** A message without any English or Romanian marker words (a chip label, "adult", a number). */
  function isLanguageNeutral(text) {
    return engine.detectLanguage(text) === "en" && engine.detectLanguage(text + " si") === "ro";
  }

  function lockChips(row, chipBtn) {
    row.setAttribute("data-done", "1");
    Array.prototype.forEach.call(row.querySelectorAll("button"), function (b) { b.disabled = true; });
    if (chipBtn) {
      chipBtn.setAttribute("aria-pressed", "true");
      chipBtn.classList.add("is-chosen");
    }
  }
  function lockFactChips() {
    Array.prototype.forEach.call(log.querySelectorAll(".mi-fact-chips:not([data-done])"), function (row) { lockChips(row, null); });
  }

  /** Optional answer chips for a fact question; a chip sends its label as a normal user message. */
  function factChips(id, lang) {
    var f = engine.FOLLOWUPS && engine.FOLLOWUPS[id];
    var opts = f && (f[lang] || f.en);
    if (!opts || !opts.o || !opts.o.length) return null;
    var row = chipRow(S("quickAnswers", lang));
    row.classList.add("mi-fact-chips");
    row.setAttribute("data-fact", id);
    opts.o.forEach(function (o) {
      var b = button("mi-chip", o[1]);
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () {
        if (chat.busy || row.getAttribute("data-done")) return;
        lockChips(row, b);
        sendUser(o[1]);
      });
      row.appendChild(b);
    });
    return row;
  }

  function finishRound(facts) {
    chat.round.done = true;
    chat.round.facts = facts || null;
    chat.round.lastAsked = null;
  }

  function runTurn() {
    var turn = ++chat.turn;
    var round = chat.round;

    // 1. Safety first: a persisted red flag, then the local red-flag check, BEFORE any network call.
    if (chat.redFlag) {
      renderEmergency({ redFlag: true, redFlagReason: null });
      return;
    }
    var rf = engine.checkRedFlagText(chat.text);
    if (rf) {
      chat.lang = rf.lang === "ro" ? "ro" : "en";
      renderEmergency(rf);
      return;
    }

    // "thanks" right after a recommendation: a short reply, no new round of questions.
    if (round.afterRec && round.msgs.length === 1 && engine.isThanks(round.msgs[0])) {
      chat.lang = engine.detectLanguage(round.msgs[0]) === "ro" ? "ro" : chat.lang;
      var tm = addMsg("bot", chat.lang);
      tm.appendChild(el("p", "mi-ask", engine.text("THANKS", chat.lang)));
      pushHistory("assistant", engine.text("THANKS", chat.lang));
      saveTurn(engine.text("THANKS", chat.lang), [], false);
      finishRound(round.base);
      scrollToMsg(tm);
      return;
    }

    chat.busy = true;
    var lang = replyLang(chat.text);
    var facts = engine.extractFacts(round.msgs, { asked: round.asked, base: round.base });
    var typing = addMsg("bot", lang);
    typing.classList.add("mi-typing");
    typing.setAttribute("role", "status");
    typing.appendChild(el("p", null, engine.text("TYPING", lang) || S("thinking", lang)));
    scrollToMsg(typing);

    function done(fn) {
      return function (arg) {
        if (turn !== chat.turn) return; // Start over happened meanwhile
        chat.busy = false;
        typing.remove();
        try { fn(arg); } catch (err) {
          console.error(err);
          chat.pending = null;
          var m = addMsg("bot", chat.lang);
          m.appendChild(el("p", null, S("error", chat.lang)));
          m.appendChild(startOverButton(chat.lang));
        }
      };
    }

    chat.targetLang = lang;
    if (!engine.USE_LLM) { setTimeout(done(function () { answerWithRules(false); }), 0); return; }
    var payload = { who: facts.who, duration: facts.duration, severity: facts.severity, turn: Math.min(50, round.msgs.length) };
    engine.chatWithLLM(chat.history.slice(), payload, availableSpecialties(), lang, { conversationId: chat.cid })
      .then(done(function (r) {
        if (r && r.ok) { chat.lang = lang; answerWithAI(r.data, facts); }
        else answerWithRules(true);
      }), done(function () { answerWithRules(true); }));
  }

  function pushResultHistory(res) {
    var names = (res.suggestions || []).map(function (s) { return s.specialty; });
    pushHistory("assistant", names.length ? "Suggested specialists: " + names.join(", ") + "." : S("noMatch", chat.lang));
  }

  /** Basic mode: the rule engine answers this message (optionally with the "AI unavailable" note). */
  function answerWithRules(aiFailed) {
    var round = chat.round;
    var msgs = round.msgs;
    var target = chat.targetLang || chat.lang;
    if (target === "ro" && msgs.length && isLanguageNeutral(msgs.join("\n"))) {
      // Keep the conversation language: a neutral word ("si" = "and") only steers the reply language.
      msgs = msgs.slice(0, -1).concat([msgs[msgs.length - 1] + " si"]);
    }
    var res = engine.converse(msgs, round.asked, availableSpecialties(), { base: round.base });
    chat.lang = res.lang === "ro" ? "ro" : "en";
    if (res.redFlag) { renderEmergency(res); return; }
    if (res.followUp) {
      renderQuestion(res.followUp.question, res.followUp.id, aiFailed);
      round.lastAsked = res.followUp.id;
      pushHistory("assistant", res.followUp.question);
    } else {
      renderResult(res, aiFailed);
      finishRound(res.facts);
      pushResultHistory(res);
    }
  }

  function aiNote(lang) {
    var p = el("p", "mi-ai-note", engine.text("AI_FALLBACK", lang));
    return p;
  }

  /** Renders model text safely: textContent only; "- " / "• " / "* " lines become a list. */
  function appendFormatted(container, text) {
    var lines = String(text || "").split(/\r?\n/), ul = null;
    lines.forEach(function (raw) {
      var line = raw.replace(/^\s+|\s+$/g, "");
      if (!line) { ul = null; return; }
      var m = /^(?:[-•*]|\d+[.)])\s+(.*)$/.exec(line);
      if (m) {
        if (!ul) { ul = el("ul", "mi-reply-list"); container.appendChild(ul); }
        ul.appendChild(el("li", null, m[1]));
      } else {
        ul = null;
        container.appendChild(el("p", "mi-reply-p", line));
      }
    });
  }

  /** AI mode. localFacts: what extractFacts() found in this round (wins over the model's facts). */
  function answerWithAI(data, localFacts) {
    var round = chat.round, n = round.msgs.length;
    var facts = engine.mergeFacts(localFacts, data.facts);
    var sugg = data.suggestions || [];
    if (!data.redFlag && !sugg.length && n >= MAX_TURNS) {
      // 10th message and the model still asks: the rule engine recommends, using the combined facts.
      var res = engine.analyze(round.msgs.join("\n"), { who: facts.who, duration: facts.duration, severity: facts.severity,
        turn: MAX_TURNS, asked: round.asked.filter(Boolean) }, availableSpecialties());
      chat.lang = res.lang === "ro" ? "ro" : chat.lang;
      if (res.redFlag) { renderEmergency(res); return; }
      renderResult(res, false);
      finishRound(facts);
      pushResultHistory(res);
      return;
    }
    pushHistory("assistant", data.reply, data.sig);
    if (data.redFlag) { renderEmergency({ redFlag: true, redFlagReason: null }, data.reply); return; }
    var lang = chat.lang;
    var m = addMsg("bot", lang);
    m.classList.add("mi-msg-ai");
    var body = el("div", "mi-reply");
    appendFormatted(body, data.reply);
    m.appendChild(body);
    if (sugg.length) {
      m.appendChild(suggestionList(sugg, lang));
      m.appendChild(el("p", "mi-disclaimer", engine.text("DISCLAIMER", lang)));
      finishRound(facts);
    } else {
      // Chips only for the fact the model says it asks about, and only if that fact is still unknown.
      var asking = data.asking;
      if (asking && !facts[asking]) {
        var row = factChips(asking, lang);
        if (row) m.appendChild(row);
      }
      round.lastAsked = asking || null;
    }
    scrollToMsg(m);
    saveTurn(data.reply, sugg, false);
    if (sugg.length) {
      ctx = { active: true, suggestions: sugg.slice(), lang: lang };
      setBestEnabled(true);
      app.rerender();
    }
  }

  function clearAssistantContext() {
    ctx = { active: false, suggestions: [], lang: "en" };
    preset = ranking.DEFAULT_PRESET || "best";
    setBestEnabled(false); // falls back to "Recommended" if "Best match" was selected
    app.rerender();        // hides Top picks and removes Match chips; other filters untouched
  }

  function renderEmergency(res, aiReply) {
    var lang = chat.lang;
    var persisted = chat.redFlag;
    chat.redFlag = true;
    clearAssistantContext();
    var m = addMsg("bot", lang);
    var banner = el("div", "mi-emergency");
    banner.setAttribute("role", "alert");
    var t = el("p", "mi-emergency-title");
    t.appendChild(icon("alert"));
    t.appendChild(el("span", null, engine.text("EMERGENCY", lang)));
    banner.appendChild(t);
    if (res.redFlagReason && res.redFlagReason !== engine.text("EMERGENCY", lang)) {
      banner.appendChild(el("p", "mi-emergency-reason", res.redFlagReason));
    }
    var call = el("a", "mi-call");
    call.href = "tel:112";
    call.appendChild(icon("phone"));
    call.appendChild(el("span", null, S("call", lang)));
    banner.appendChild(call);
    if (persisted) banner.appendChild(el("p", "mi-emergency-reason mi-rf-mistake", engine.text("RF_MISTAKE", lang)));
    m.appendChild(banner);
    if (aiReply) { var body = el("div", "mi-reply"); appendFormatted(body, aiReply); m.appendChild(body); }
    m.appendChild(startOverButton(lang));
    scrollToMsg(m);
    var saved = engine.text("EMERGENCY", lang);
    if (res.redFlagReason && res.redFlagReason !== saved) saved += "\n" + res.redFlagReason;
    if (aiReply) saved += "\n\n" + aiReply;
    saveTurn(saved, [], true);
  }

  /** A follow-up question as a normal bot message; fact questions get optional answer chips. */
  function renderQuestion(question, id, aiFailed) {
    var lang = chat.lang;
    var m = addMsg("bot", lang);
    if (aiFailed) m.appendChild(aiNote(lang));
    m.appendChild(el("p", "mi-ask", question));
    var row = id && id !== "clarify" ? factChips(id, lang) : null;
    if (row) m.appendChild(row);
    scrollToMsg(m);
    saveTurn(question, [], false);
  }

  var CONF_CLASS = { High: "is-high", Medium: "is-medium", Low: "is-low" };

  function scoreOf(s) {
    var v = s && s.confidenceScore;
    return typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null;
  }
  function labelOf(s, score) {
    if (CONF_CLASS[s.confidence]) return s.confidence;
    if (score == null) return s.confidence || "Low";
    return score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  }
  var factorSeq = 0;

  /** Confidence label (always text) + optional meter (role=meter), caption, "Why?" factors and change hint. */
  function confidenceBlock(s, lang, track) {
    var score = scoreOf(s), label = labelOf(s, score);
    var wrap = el("div", "mi-confidence");
    var top = el("div", "mi-meter-top");
    var conf = el("span", "mi-conf " + (CONF_CLASS[label] || "is-low"));
    conf.appendChild(el("span", "mi-conf-dot"));
    conf.appendChild(el("span", null, S("confidence", lang) + ": " + confText(label, lang)));
    top.appendChild(conf);
    wrap.appendChild(top);
    if (score == null) return wrap;

    var prev = track ? chat.scores[s.specialty] : undefined;
    var pct = el("span", "mi-meter-pct", score + "%");
    pct.setAttribute("aria-hidden", "true");
    top.appendChild(pct);
    if (typeof prev === "number" && prev !== score) {
      var upward = score > prev;
      var hint = el("span", "mi-meter-delta " + (upward ? "is-up" : "is-down"));
      var arrow = el("span", null, upward ? "↑ " : "↓ ");
      arrow.setAttribute("aria-hidden", "true");
      hint.appendChild(arrow);
      hint.appendChild(el("span", null, S(upward ? "up" : "down", lang)));
      top.appendChild(hint);
    }
    var meter = el("div", "mi-meter");
    meter.setAttribute("role", "meter");
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", "100");
    meter.setAttribute("aria-valuenow", String(score));
    meter.setAttribute("aria-valuetext", score + "%, " + confText(label, lang));
    meter.setAttribute("aria-label", S("meterAria", lang) + " " + score + "%");
    var fill = el("span", "mi-meter-fill " + (CONF_CLASS[label] || "is-low"));
    meter.appendChild(fill);
    wrap.appendChild(meter);
    if (typeof prev === "number" && prev !== score) {
      // Animate from the previous score (CSS transition; none with reduced motion).
      fill.style.width = prev + "%";
      meter.setAttribute("data-from", String(prev));
      var go = function () { fill.style.width = score + "%"; };
      if (window.requestAnimationFrame) window.requestAnimationFrame(function () { window.requestAnimationFrame(go); });
      setTimeout(go, 60);
    } else {
      fill.style.width = score + "%";
    }
    wrap.appendChild(el("p", "mi-meter-caption", S("meterCaption", lang)));
    var factors = Array.isArray(s.confidenceFactors) ? s.confidenceFactors.filter(function (f) { return f && f.label; }) : [];
    if (factors.length) {
      var det = el("details", "mi-meter-why");
      det.appendChild(el("summary", null, S("why", lang)));
      var ul = el("ul", "mi-meter-factors");
      ul.id = "mi-factors-" + (++factorSeq);
      factors.forEach(function (f) {
        var kind = /^(match|specific|support|conflict|vague|followup|remap)$/.test(f.kind) ? f.kind : "other";
        var li = el("li", "mi-factor is-" + kind);
        var sign = el("span", "mi-factor-sign", kind === "conflict" || kind === "vague" ? "−" : kind === "followup" || kind === "other" ? "•" : "+");
        sign.setAttribute("aria-hidden", "true");
        li.appendChild(sign);
        li.appendChild(el("span", null, String(f.label)));
        ul.appendChild(li);
      });
      det.appendChild(ul);
      wrap.appendChild(det);
    }
    return wrap;
  }

  function suggestionList(sugg, lang, opts) {
    var track = !(opts && opts.track === false);
    var list = el("ol", "mi-sugg-list");
    sugg.forEach(function (s) {
      var li = el("li", "mi-sugg");
      var head = el("div", "mi-sugg-head");
      var nm = el("h3", "mi-sugg-name", spec(s.specialty));
      nm.setAttribute("data-spec", s.specialty);
      head.appendChild(nm);
      li.appendChild(head);
      li.appendChild(confidenceBlock(s, lang, track));
      if (s.reason) li.appendChild(el("p", "mi-sugg-reason", s.reason));
      if (s.note) li.appendChild(el("p", "mi-sugg-note", s.note));
      var show = button("btn btn-primary mi-show", S("showDoctors", lang));
      show.setAttribute("aria-label", S("showDoctors", lang) + ": " + spec(s.specialty));
      show.setAttribute("data-spec", s.specialty);
      show.setAttribute("lang", lang);
      show.addEventListener("click", function () { showDoctors(s, sugg); });
      li.appendChild(show);
      list.appendChild(li);
    });
    if (track) sugg.forEach(function (s) { var sc = scoreOf(s); if (sc != null) chat.scores[s.specialty] = sc; });
    return list;
  }

  function renderResult(res, aiFailed) {
    var lang = chat.lang;
    var m = addMsg("bot", lang);
    if (aiFailed) m.appendChild(aiNote(lang));
    var sugg = res.suggestions || [];
    if (sugg.length) {
      m.appendChild(el("p", null, sugg.length === 1 ? S("intro", lang) : S("introMany", lang)));
      m.appendChild(suggestionList(sugg, lang));
    } else {
      m.appendChild(el("p", null, S("noMatch", lang)));
    }
    if (res.urgencyNote) m.appendChild(el("p", "mi-urgency", res.urgencyNote));
    m.appendChild(el("p", "mi-disclaimer", res.disclaimer || engine.text("DISCLAIMER", lang)));
    m.appendChild(startOverButton(lang));
    scrollToMsg(m);
    var names = sugg.map(function (s) { return s.specialty; });
    var savedText = names.length ? (names.length === 1 ? S("intro", lang) : S("introMany", lang)) + " " + names.join(", ") + "." : S("noMatch", lang);
    if (res.urgencyNote) savedText += "\n" + res.urgencyNote;
    saveTurn(savedText, sugg, false);

    if (sugg.length) {
      ctx = { active: true, suggestions: sugg.slice(), lang: lang };
      setBestEnabled(true);
      app.rerender();
    }
  }

  function showDoctors(s, all) {
    if (!ctx.active) {
      if (!all || chat.redFlag) return;
      ctx = { active: true, suggestions: all.slice(), lang: chat.lang }; // from a saved chat
    }
    setBestEnabled(true);
    app.setSpecialty(s.specialty);
    app.setSort("best");
    var mount = $("top-picks");
    closePanel(false); // all screen sizes; the chat stays in memory for reopening
    if (mount && !mount.hidden) {
      var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      mount.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      var heading = $("top-picks-title");
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    }
  }

  function startOver() {
    chat = newChat(chat.turn + 1);
    cloud = newCloud(null);
    endViewing();
    if (histOpen()) closeHistory(false);
    cloudStatus.hidden = true;
    updateCloudUi();
    ctx = { active: false, suggestions: [], lang: "en" };
    preset = ranking.DEFAULT_PRESET || "best";
    log.replaceChildren();
    renderWelcome();
    setBestEnabled(false);
    app.rerender();
    if (panelOpen()) input.focus();
  }

  /* ---------- Premium cloud history ---------- */
  // One session per conversation: { id: server chat id | null, queue of save ops, flags }.
  // Old sessions keep saving to their own chat after Start over, so turns never mix.
  function newCloud(id) {
    return { id: id || null, createQueued: false, queue: [], running: false, disabled: false, noted: false };
  }
  var cloud = newCloud(null);
  var viewing = null; // { id, title } while a saved chat is shown read-only

  function chatsApi() {
    var a = api();
    return a && a.chats && typeof a.chats.create === "function" ? a.chats : null;
  }
  function saveEnabled() { return isPremium() && !!chatsApi() && !cloud.disabled; }

  function suggMeta(sugg) {
    return (sugg || []).map(function (s) {
      var o = { specialty: s.specialty, confidence: s.confidence || null };
      var sc = scoreOf(s);
      if (sc != null) o.confidenceScore = sc;
      return o;
    });
  }

  /** Called once per turn with the bot's reply; saves the pending user message + the reply (premium only). */
  function saveTurn(replyText, sugg, redFlag) {
    var p = chat.pending;
    chat.pending = null;
    if (!p || !saveEnabled()) return;
    var session = cloud, chats = chatsApi();
    var meta = { suggestions: suggMeta(sugg), redFlag: !!redFlag };
    if (!session.id && !session.createQueued) {
      session.createQueued = true;
      var title = String(p.user).replace(/\s+/g, " ").trim().slice(0, 60);
      enqueue(session, function (cb) { chats.create(title, cb); }, function (err, data) {
        var c = data && (data.chat || data);
        if (!err && c && c.id != null) session.id = c.id;
        else session.createQueued = false; // try again on the next turn
      });
    }
    enqueue(session, function (cb) { addMessage(session, "user", p.user, null, cb); });
    enqueue(session, function (cb) { addMessage(session, "assistant", String(replyText || "").slice(0, 4000), meta, cb); });
  }
  function addMessage(session, role, content, meta, cb) {
    if (session.id == null) { cb({ status: -1, error: "no chat" }); return; }
    chatsApi().addMessage(session.id, role, content, meta, cb);
  }

  /** Serial queue; each op gets one silent retry. 401/403 = not allowed: stop saving silently. */
  function enqueue(session, op, after) {
    session.queue.push({ op: op, after: after });
    pump(session);
  }
  function pump(session) {
    if (session.running || !session.queue.length) return;
    var item = session.queue.shift();
    session.running = true;
    var tries = 0;
    function finish(err, data) {
      session.running = false;
      if (item.after) { try { item.after(err, data); } catch (e) { /* ignore */ } }
      if (err) noteSaveFailed(session);
      pump(session);
    }
    (function attempt() {
      tries++;
      if (session.disabled) { finish({ status: 403 }, null); return; }
      try {
        item.op(function (err, data) {
          if (!err) { finish(null, data); return; }
          if (err.status === 401 || err.status === 403) {
            session.disabled = true;
            if (session === cloud) cloud.disabled = true;
            session.queue = [];
            session.running = false;
            if (session === cloud) updateCloudUi();
            if (item.after) { try { item.after(err, null); } catch (e) { /* ignore */ } }
            return;
          }
          if (tries < 2 && err.error !== "no chat") { setTimeout(attempt, 400); return; }
          finish(err, null);
        });
      } catch (e) { if (tries < 2) setTimeout(attempt, 400); else finish({ status: -1, error: String(e) }, null); }
    })();
  }
  function noteSaveFailed(session) {
    if (session.noted || session.disabled) return;
    session.noted = true;
    if (session === cloud && cloudStatus) cloudStatus.hidden = false;
  }

  function updateCloudUi() {
    var prem = isPremium() && !!chatsApi();
    if (headHistory) headHistory.hidden = !prem;
    if (cloudNote) cloudNote.hidden = !prem || cloud.disabled;
    if (!prem && histOpen()) closeHistory(false);
  }

  /* History list view (inside the panel) */
  function histOpen() { return histView && !histView.hidden; }
  function openHistory() {
    histView.hidden = false;
    panel.classList.add("is-history");
    headHistory.setAttribute("aria-expanded", "true");
    histView.replaceChildren();
    var head = el("div", "mi-history-head");
    var h = L(el("h3", "mi-history-title"), "chat.historyTitle");
    h.id = "mi-history-title";
    h.tabIndex = -1;
    head.appendChild(h);
    var back = lbutton("btn btn-ghost mi-history-back", "chat.back");
    back.addEventListener("click", function () { closeHistory(true); });
    head.appendChild(back);
    histView.appendChild(head);
    var body = el("div", "mi-history-body");
    body.setAttribute("aria-live", "polite");
    body.setAttribute("aria-busy", "true");
    body.appendChild(el("p", "mi-history-msg", T("chat.loadingChats")));
    histView.appendChild(body);
    h.focus();
    var chats = chatsApi();
    if (!chats || typeof chats.list !== "function") { showListMsg(body, T("chat.historyUnavailable")); return; }
    chats.list(function (err, data) {
      if (!histOpen()) return;
      body.removeAttribute("aria-busy");
      body.replaceChildren();
      if (err) {
        if (err.status === 403 || err.status === 401) {
          var p = el("p", "mi-history-msg", T("chat.historyPremium"));
          p.appendChild(linkButton("mi-premium-link", T("reviews.seePremium"), "premium.html"));
          body.appendChild(p);
        } else showListMsg(body, T("chat.historyUnavailable"));
        return;
      }
      var items = Array.isArray(data) ? data : (data && (data.chats || data.items)) || [];
      if (!items.length) { showListMsg(body, T("chat.noChats")); return; }
      var ul = el("ul", "mi-history-list");
      items.forEach(function (c) {
        if (!c || c.id == null) return;
        var li = el("li", "mi-history-item");
        var b = el("button", "mi-history-open");
        b.type = "button";
        b.appendChild(el("span", "mi-history-name", String(c.title || T("chat.untitled"))));
        var day = formatDay(c.updatedAt || c.createdAt);
        if (day) b.appendChild(el("span", "mi-history-date", day));
        b.addEventListener("click", function () { loadSavedChat(c.id); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      body.appendChild(ul);
    });
  }
  function showListMsg(body, text) {
    body.removeAttribute("aria-busy");
    body.replaceChildren(el("p", "mi-history-msg", text));
  }
  function closeHistory(focusBack) {
    if (!histView) return;
    histView.hidden = true;
    histView.replaceChildren();
    panel.classList.remove("is-history");
    headHistory.setAttribute("aria-expanded", "false");
    if (focusBack) { if (!headHistory.hidden) headHistory.focus(); else if (!input.disabled) input.focus(); }
  }

  /* Opening a saved chat: read-only view, the local state is rebuilt from the messages. */
  function validChatId(id) { return id != null && /^[A-Za-z0-9_-]{1,64}$/.test(String(id)); }

  function loadSavedChat(id, done) {
    var chats = chatsApi();
    if (!chats || !validChatId(id) || typeof chats.get !== "function") { if (done) done(false); return; }
    chats.get(id, function (err, data) {
      var c = data && (data.chat || data);
      if (err || !c) {
        if (histOpen()) showListMsg(histView.querySelector(".mi-history-body") || histView, err && err.status === 404 ? T("chat.notFound") : T("chat.cantOpen"));
        if (done) done(false);
        return;
      }
      if (histOpen()) closeHistory(false);
      showSavedChat(c);
      if (done) done(true);
    });
  }

  function inferAsked(content) {
    var F = engine.FOLLOWUPS || {}, found = null;
    ["who", "duration", "severity"].forEach(function (id) {
      ["en", "ro"].forEach(function (lg) {
        var f = F[id] && F[id][lg];
        if (!found && f && ((f.q && content.indexOf(f.q) >= 0) || (f.qChild && content.indexOf(f.qChild) >= 0))) found = id;
      });
    });
    return found;
  }

  /** Per-message safety pre-pass over a saved chat: filtered text, red-flag decision, and the overall lock. */
  function savedPrep(msgs) {
    var EM = [engine.text("EMERGENCY", "en"), engine.text("EMERGENCY", "ro")];
    var userText = "", out = { locked: false };
    msgs.forEach(function (m, i) {
      if (m.role === "user") { userText = userText ? userText + "\n" + m.content : m.content; return; }
      var meta = m.meta && typeof m.meta === "object" ? m.meta : {};
      var hasEm = EM.some(function (t) { return t && m.content.indexOf(t) >= 0; });
      var rest = m.content;
      EM.forEach(function (t) { if (t) rest = rest.split(t).join(""); });
      rest = rest.trim();
      var lang = engine.detectLanguage(userText || rest) === "ro" ? "ro" : "en";
      var san = rest ? engine.sanitizeReply(rest, lang) : { text: null, emergency: false };
      var rf = meta.redFlag === true || hasEm || !!(san && san.emergency) || !!(userText && engine.checkRedFlagText(userText));
      out[i] = { rf: rf, text: san ? san.text : null, rest: san ? san.text : null };
      if (rf) out.locked = true;
    });
    if (userText && engine.checkRedFlagText(userText)) out.locked = true;
    return out;
  }

  function savedEmergencyBox(lang) {
    var box = el("div", "mi-emergency");
    var tt = el("p", "mi-emergency-title");
    tt.appendChild(icon("alert"));
    tt.appendChild(el("span", null, engine.text("EMERGENCY", lang)));
    box.appendChild(tt);
    var call = el("a", "mi-call");
    call.href = "tel:112";
    call.appendChild(icon("phone"));
    call.appendChild(el("span", null, S("call", lang)));
    box.appendChild(call);
    return box;
  }

  /** Saved meta.suggestions: dataset specialties only; confidence recomputed locally; reasons from the engine. */
  function savedSuggestions(raw, roundText, round, lang) {
    var avail = availableSpecialties(), seen = {};
    var list = (Array.isArray(raw) ? raw : []).map(function (s) {
      var name = typeof s === "string" ? s : s && s.specialty;
      return typeof name === "string" ? name : null;
    }).filter(function (name) {
      if (!name || seen[name] || avail.indexOf(name) < 0) return false;
      seen[name] = true;
      return true;
    }).slice(0, 3).map(function (name) { return { specialty: name, confidence: "Low" }; });
    if (!list.length) return list;
    var reasons = {};
    try {
      var a = engine.analyze(roundText, { turn: MAX_TURNS, asked: round.asked.filter(Boolean) }, avail);
      (a && a.suggestions || []).forEach(function (s) { if (s.reason) reasons[s.specialty] = s.reason; });
    } catch (e) { /* no reasons */ }
    try {
      if (typeof engine.rateSuggestions === "function") engine.rateSuggestions(list, { text: roundText }, avail, lang);
    } catch (e) { list.forEach(function (s) { delete s.confidenceScore; delete s.confidenceFactors; }); }
    list.forEach(function (s) { if (reasons[s.specialty]) s.reason = reasons[s.specialty]; });
    return list;
  }

  function showSavedChat(c) {
    var msgs = (Array.isArray(c.messages) ? c.messages : []).filter(function (m) {
      return m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
    });
    // Rebuild the conversation state (rounds, 5-message logic, red-flag lock) from the messages.
    var fresh = newChat(chat.turn + 1);
    chat = fresh;
    ctx = { active: false, suggestions: [], lang: "en" };
    preset = ranking.DEFAULT_PRESET || "best";
    setBestEnabled(false);
    app.rerender();
    cloud = newCloud(c.id);
    cloudStatus.hidden = true;
    log.replaceChildren();

    var banner = el("div", "mi-saved-banner");
    banner.setAttribute("role", "status");
    var t = el("p", "mi-saved-title");
    t.appendChild(L(el("span", "mi-saved-label"), "chat.savedLabel"));
    t.appendChild(document.createTextNode(": " + String(c.title || T("chat.untitled"))));
    var day = formatDay(c.updatedAt || c.createdAt);
    if (day) t.appendChild(el("span", "mi-saved-date", " · " + day));
    banner.appendChild(t);
    var acts = el("div", "mi-saved-actions");
    var cont = lbutton("btn btn-primary mi-continue", "chat.continue");
    cont.addEventListener("click", continueSaved);
    var neu = lbutton("btn btn-ghost mi-newchat", "chat.newChat");
    neu.addEventListener("click", startOver);
    acts.appendChild(cont); acts.appendChild(neu);
    banner.appendChild(acts);
    log.appendChild(banner);

    // Saved data is untrusted (defense in depth): re-filter the text, re-check red flags locally.
    var prep = savedPrep(msgs), locked = prep.locked, bannerShown = false;
    msgs.forEach(function (m, i) {
      var meta = m.meta && typeof m.meta === "object" ? m.meta : {};
      var r = chat.round;
      if (m.role === "user") {
        if (r.done) r = chat.round = newRound({ who: r.facts && r.facts.who }, true);
        r.msgs.push(m.content);
        r.asked.push(r.lastAsked);
        r.lastAsked = null;
        chat.text = chat.text ? chat.text + "\n" + m.content : m.content;
        chat.lang = engine.detectLanguage(chat.text) === "ro" ? "ro" : "en";
        pushHistory("user", m.content);
        chat.turn++;
        var um = addMsg("user", chat.lang);
        um.removeAttribute("lang");
        um.appendChild(el("p", null, m.content));
        return;
      }
      pushHistory("assistant", m.content); // unsigned: the proxy drops it, which is fine
      var lang = chat.lang;
      var bm = addMsg("bot", lang);
      bm.classList.add("mi-msg-saved");
      var p = prep[i];
      if (p.rf) {
        chat.redFlag = true;
        bm.appendChild(savedEmergencyBox(lang));
        bannerShown = true;
        if (p.rest) { var rb = el("div", "mi-reply"); appendFormatted(rb, p.rest); bm.appendChild(rb); }
        finishRound(null);
        return;
      }
      if (p.text == null) bm.appendChild(el("p", "mi-removed", T("chat.removed")));
      else { var body = el("div", "mi-reply"); appendFormatted(body, p.text); bm.appendChild(body); }
      var sugg = locked ? [] : savedSuggestions(meta.suggestions, r.msgs.join("\n"), r, lang);
      if (sugg.length) {
        bm.appendChild(suggestionList(sugg, lang));
        bm.appendChild(el("p", "mi-disclaimer", engine.text("DISCLAIMER", lang)));
        finishRound(engine.extractFacts(r.msgs, { asked: r.asked, base: r.base }));
      } else {
        r.lastAsked = p.text ? inferAsked(p.text) : null;
      }
    });
    if (locked) {
      chat.redFlag = true;
      clearAssistantContext();
      if (!bannerShown) { var lm = addMsg("bot", chat.lang); lm.appendChild(savedEmergencyBox(chat.lang)); }
    }
    viewing = { id: c.id, title: c.title || "" };
    input.disabled = true;
    sendBtn.disabled = true;
    LA(input, "placeholder", "chat.continueHint");
    if (!panelOpen()) openPanel();
    log.scrollTop = 0;
    cont.focus();
  }

  function endViewing() {
    viewing = null;
    if (!input) return;
    input.disabled = false;
    sendBtn.disabled = false;
    LA(input, "placeholder", "chat.placeholder");
    var b = log && log.querySelector(".mi-saved-actions");
    if (b) b.remove();
  }

  function continueSaved() {
    if (!viewing) return;
    endViewing(); // new turns are appended to the same server chat (cloud.id)
    log.scrollTop = log.scrollHeight;
    input.focus();
  }

  /* ---------- Deep links: #assistant, #assistant&chat=<id> ---------- */
  var pendingChatId = null;
  function handleHash() {
    var h = String(location.hash || "").replace(/^#/, "");
    var parts = h.split("&");
    if (parts[0] !== "assistant") return;
    if (!panelOpen()) openPanel();
    var m = /(?:^|&)chat=([A-Za-z0-9_-]{1,64})(?:&|$)/.exec(h);
    if (!m) return;
    pendingChatId = m[1]; // loaded as soon as the sign-in state is known (any ordering)
    tryPendingChat();
  }

  function tryPendingChat() {
    if (!pendingChatId || !authKnown()) return;
    var id = pendingChatId;
    pendingChatId = null;
    if (isPremium()) loadSavedChat(id); // otherwise: just the fresh panel
  }

  function onAuthChange() {
    updateCloudUi();
    tryPendingChat();
  }

  function initAuth() {
    document.addEventListener("medindex:auth", function (e) {
      var u = e && e.detail ? e.detail.user : null;
      auth.user = u || null;
      auth.eventSeen = true;
      onAuthChange();
    });
    setTimeout(function () {
      if (authKnown()) { onAuthChange(); return; }
      var a = api();
      if (!a || typeof a.me !== "function") { auth.user = null; onAuthChange(); return; }
      if (window.MedIndexNav) { // js/nav.js will fire "medindex:auth"; poll "ready" in case the event was missed
        var tries = 0;
        (function poll() { if (authKnown()) { onAuthChange(); return; } if (++tries < 100) setTimeout(poll, 100); })();
        return;
      }
      a.me(function (err, data) {
        if (authKnown()) return;
        auth.user = err ? null : ((data && Object.prototype.hasOwnProperty.call(data, "user")) ? data.user : data) || null;
        onAuthChange();
      });
    }, 0);
  }

  /* ---------- Init ---------- */
  function init() {
    buildPanel();
    renderWelcome();
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (rating) { closeRating(true); return; }
      if (panelOpen()) closePanel(true);
    });
    initAuth();
    window.addEventListener("hashchange", handleHash);
    app.onBeforeRender(computeRanking);
    app.onRender(renderTopPicks);
    setBestEnabled(false);
    reviews.onChange(function () { app.rerender(); });
    if (app.onLangChange) app.onLangChange(onUiLang);
    app.rerender();
    handleHash();
  }

  MI.ui = {
    handlesDeepLinks: true, // js/nav.js skips its #assistant fallback when this is set
    decorateCard: decorateCard,
    open: openPanel,
    close: function () { closePanel(true); },
    send: function (t) { sendUser(String(t || "").trim()); },
    startOver: function () { startOver(); },
    setPreset: function (key) { if (ranking.WEIGHT_PRESETS[key]) { preset = key; app.rerender(); } },
    getContext: function () { return { active: ctx.active, suggestions: ctx.suggestions.slice(), preset: preset }; },
    getRanking: function () { return rankCache.list.slice(); },
    openHistory: function () { if (panel) { if (!panelOpen()) openPanel(); openHistory(); } },
    loadChat: function (id, cb) { loadSavedChat(id, cb); },
    continueChat: function () { continueSaved(); },
    /** Read-only snapshot for tests/debugging. */
    getCloud: function () { return { id: cloud.id, disabled: cloud.disabled, noted: cloud.noted, viewing: !!viewing, redFlag: chat.redFlag,
      roundMsgs: chat.round.msgs.length, roundDone: chat.round.done }; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
