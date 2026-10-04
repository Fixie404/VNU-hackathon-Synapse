/* MedIndex – shared site header. Renders into <header id="site-header">.
   Exposes window.MedIndexNav = { refresh(), user, offline, ready } and fires
   a "medindex:auth" CustomEvent on document whenever the auth state is known or changes.
   Plain JS, no innerHTML with data (all text via textContent). */
(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var FILE_MODE = location.protocol === "file:";

  var nav = window.MedIndexNav = { user: null, offline: FILE_MODE, ready: false, refresh: refresh };
  var header, burger, navEl, acctItem, menuOpen = false;
  var langWrap, langBtn, langList, langOpen = false;

  /* ---------- i18n (nav.* + lang.* live here so every page has them) ---------- */

  var I18N = window.MedIndexI18n || null;
  var NAV_DICT = {
    en: {
      "nav.main": "Main", "nav.brandHome": "MedIndex home", "nav.menu": "Menu",
      "nav.home": "Home", "nav.doctors": "Find Doctors", "nav.assistant": "AI Assistant",
      "nav.premium": "Premium", "nav.account": "Account", "nav.signIn": "Sign in", "nav.signOut": "Sign out",
      "nav.cloud": "Medical Cloud", "nav.upgrade": "Upgrade to Premium", "nav.accountFallback": "Account",
      "nav.acctMenuFor": "Account menu for {name}", "nav.acctMenuForPremium": "Account menu for {name} (Premium)",
      "nav.signInOffline": "Sign in (offline mode)",
      "nav.offlineBefore": "Offline mode: sign-in needs the local server (", "nav.offlineAfter": ").",
      "nav.goAccount": "Go to the account page",
      "lang.label": "Language", "lang.choose": "Language: {name}. Change language",
      "lang.en": "English", "lang.ro": "Română"
    },
    ro: {
      "nav.main": "Principal", "nav.brandHome": "MedIndex – pagina principală", "nav.menu": "Meniu",
      "nav.home": "Acasă", "nav.doctors": "Caută medici", "nav.assistant": "Asistent AI",
      "nav.premium": "Premium", "nav.account": "Cont", "nav.signIn": "Autentificare", "nav.signOut": "Deconectare",
      "nav.cloud": "Cloud Medical", "nav.upgrade": "Treci la Premium", "nav.accountFallback": "Cont",
      "nav.acctMenuFor": "Meniul contului pentru {name}", "nav.acctMenuForPremium": "Meniul contului pentru {name} (Premium)",
      "nav.signInOffline": "Autentificare (mod offline)",
      "nav.offlineBefore": "Mod offline: autentificarea are nevoie de serverul local (", "nav.offlineAfter": ").",
      "nav.goAccount": "Mergi la pagina contului",
      "lang.label": "Limbă", "lang.choose": "Limbă: {name}. Schimbă limba",
      "lang.en": "English", "lang.ro": "Română"
    }
  };
  if (I18N) { I18N.register("en", NAV_DICT.en); I18N.register("ro", NAV_DICT.ro); }

  function T(key, vars) {
    if (I18N) return I18N.t(key, vars);
    var s = NAV_DICT.en[key] || key;
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? String(vars[k]) : m; }) : s;
  }
  function curLang() { return I18N ? I18N.getLang() : "en"; }
  var LANGS = [{ code: "en", flag: "\uD83C\uDDEC\uD83C\uDDE7" }, { code: "ro", flag: "\uD83C\uDDF7\uD83C\uDDF4" }];

  /* ---------- helpers ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(viewBox, w, h, parts) {
    var s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", viewBox);
    s.setAttribute("width", w);
    s.setAttribute("height", h);
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("focusable", "false");
    parts.forEach(function (p) {
      var n = document.createElementNS(SVG_NS, p[0]);
      Object.keys(p[1]).forEach(function (k) { n.setAttribute(k, p[1][k]); });
      s.appendChild(n);
    });
    return s;
  }
  function logo(size) {
    return svg("0 0 40 40", size, size, [
      ["rect", { x: 1, y: 1, width: 38, height: 38, rx: 10, fill: "currentColor" }],
      ["path", { d: "M16 9h8v7h7v8h-7v7h-8v-7H9v-8h7z", fill: "#fff" }],
      ["circle", { cx: 29.5, cy: 29.5, r: 5, fill: "none", stroke: "#fff", "stroke-width": 2.4 }],
      ["path", { d: "M33 33l3.2 3.2", stroke: "#fff", "stroke-width": 2.6, "stroke-linecap": "round" }]
    ]);
  }
  function caret() {
    var s = svg("0 0 24 24", 16, 16, [["path", { d: "M6 9l6 6 6-6", fill: "none", stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round" }]]);
    s.setAttribute("class", "mx-caret");
    return s;
  }

  function currentPage() {
    var p = location.pathname.split("/").pop().toLowerCase();
    return p === "" ? "index.html" : p;
  }
  function onDoctors() { return currentPage() === "doctors.html"; }

  function emit() {
    nav.ready = true;
    var detail = { user: nav.user, offline: nav.offline };
    var ev;
    try { ev = new CustomEvent("medindex:auth", { detail: detail }); }
    catch (e) { ev = document.createEvent("CustomEvent"); ev.initCustomEvent("medindex:auth", false, false, detail); }
    document.dispatchEvent(ev);
  }

  function api() { return window.MedIndexAPI || null; }

  /* ---------- render ---------- */

  function navLink(href, i18nKey, key) {
    var li = el("li");
    var a = el("a", "mx-nav-link", T(i18nKey));
    a.setAttribute("data-i18n", i18nKey);
    a.href = href;
    a.setAttribute("data-nav", key);
    li.appendChild(a);
    return li;
  }

  function markCurrent() {
    var page = currentPage();
    var assistant = onDoctors() && isAssistantHash();
    var active = page === "index.html" ? "home"
      : page === "doctors.html" ? (assistant ? "assistant" : "doctors")
      : page === "premium.html" ? "premium"
      : (page === "account.html" || page === "cloud.html") ? "account" : "";
    Array.prototype.forEach.call(header.querySelectorAll("[data-nav]"), function (a) {
      if (a.getAttribute("data-nav") === active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function build() {
    header = document.getElementById("site-header");
    if (!header) return false;
    header.classList.add("mx-header");
    while (header.firstChild) header.removeChild(header.firstChild);

    var inner = el("div", "mx-header-inner");
    var brand = el("a", "mx-brand");
    brand.href = "index.html";
    brand.setAttribute("aria-label", T("nav.brandHome"));
    brand.setAttribute("data-i18n-attr", "aria-label:nav.brandHome");
    brand.appendChild(logo(34));
    brand.appendChild(el("span", null, "MedIndex"));
    inner.appendChild(brand);

    burger = el("button", "mx-burger");
    burger.type = "button";
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-controls", "mx-nav");
    burger.appendChild(svg("0 0 24 24", 22, 22, [["path", { d: "M4 7h16M4 12h16M4 17h16", stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round" }]]));
    var bsr = el("span", "mx-sr", T("nav.menu"));
    bsr.setAttribute("data-i18n", "nav.menu");
    burger.appendChild(bsr);
    inner.appendChild(burger);

    navEl = el("nav", "mx-nav");
    navEl.id = "mx-nav";
    navEl.setAttribute("aria-label", T("nav.main"));
    navEl.setAttribute("data-i18n-attr", "aria-label:nav.main");
    var ul = el("ul", "mx-nav-list");
    ul.appendChild(buildLang());
    ul.appendChild(navLink("index.html", "nav.home", "home"));
    ul.appendChild(navLink("doctors.html", "nav.doctors", "doctors"));
    ul.appendChild(navLink("doctors.html#assistant", "nav.assistant", "assistant"));
    ul.appendChild(navLink("premium.html", "nav.premium", "premium"));
    acctItem = el("li", "mx-acct");
    ul.appendChild(acctItem);
    navEl.appendChild(ul);
    inner.appendChild(navEl);
    header.appendChild(inner);

    burger.addEventListener("click", function () {
      setBurger(burger.getAttribute("aria-expanded") !== "true");
    });

    var asst = header.querySelector('[data-nav="assistant"]');
    asst.addEventListener("click", function (e) {
      if (!onDoctors()) return;           // other pages: normal navigation
      e.preventDefault();
      setBurger(false);
      if (!isAssistantHash()) {
        if (uiHandlesDeepLinks()) { location.hash = "assistant"; return; }   // ui.js reacts to the hash change
        history.replaceState(null, "", "#assistant");
      }
      markCurrent();
      openAssistant(0, true);   // same hash: no hashchange fires, so open the panel directly
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (langOpen) { setLang(false); langBtn.focus(); }
      else if (menuOpen) { setMenu(false); var b = acctItem.querySelector(".mx-acct-btn"); if (b) b.focus(); }
      else if (burger.getAttribute("aria-expanded") === "true") { setBurger(false); burger.focus(); }
    });
    document.addEventListener("click", function (e) {
      if (menuOpen && !acctItem.contains(e.target)) setMenu(false);
    });
    // Close the account menu / mobile panel when keyboard focus leaves them.
    acctItem.addEventListener("focusout", function (e) {
      if (menuOpen && e.relatedTarget && !acctItem.contains(e.relatedTarget)) setMenu(false);
    });
    navEl.addEventListener("focusout", function (e) {
      if (burger.getAttribute("aria-expanded") !== "true" || !e.relatedTarget) return;
      if (!navEl.contains(e.relatedTarget) && e.relatedTarget !== burger) setBurger(false);
    });
    window.addEventListener("hashchange", function () {
      markCurrent();
      if (onDoctors() && isAssistantHash()) openAssistant(0, false);
    });

    renderAccount();
    markCurrent();
    var onLang = function () { renderLang(); renderAccount(); };
    if (I18N) I18N.onChange(onLang);
    return true;
  }

  /* ---------- language selector ---------- */

  function langName(code) { return T("lang." + code); }

  function buildLang() {
    var li = el("li", "mx-lang-item");
    langWrap = el("div", "mx-lang");
    langBtn = el("button", "mx-nav-link mx-lang-btn");
    langBtn.type = "button";
    langBtn.id = "mx-lang-btn";
    langBtn.setAttribute("aria-haspopup", "listbox");
    langBtn.setAttribute("aria-expanded", "false");
    langBtn.setAttribute("aria-controls", "mx-lang-list");
    langBtn.appendChild(el("span", "mx-flag"));
    langBtn.appendChild(el("span", "mx-lang-name"));
    var code = el("span", "mx-lang-code");
    code.setAttribute("aria-hidden", "true");
    langBtn.appendChild(code);
    langBtn.appendChild(caret());
    langList = el("ul", "mx-lang-list");
    langList.id = "mx-lang-list";
    langList.setAttribute("role", "listbox");
    langList.hidden = true;
    LANGS.forEach(function (L) {
      var o = el("li", "mx-lang-opt");
      o.id = "mx-lang-opt-" + L.code;
      o.setAttribute("role", "option");
      o.setAttribute("data-lang", L.code);
      o.setAttribute("lang", L.code);
      o.tabIndex = -1;
      var f = el("span", "mx-flag", L.flag);
      f.setAttribute("aria-hidden", "true");
      o.appendChild(f);
      o.appendChild(el("span", "mx-lang-opt-name", langName(L.code)));
      o.addEventListener("click", function (e) { e.stopPropagation(); chooseLang(L.code); });
      langList.appendChild(o);
    });
    langWrap.appendChild(langBtn);
    langWrap.appendChild(langList);
    li.appendChild(langWrap);

    langBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (langOpen) setLang(false); else { setLang(true); focusOpt(selectedIdx()); }
    });
    langBtn.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setLang(true);
        focusOpt(e.key === "ArrowUp" ? LANGS.length - 1 : selectedIdx());
      } else if (e.key === "Escape" && langOpen) {
        e.preventDefault(); e.stopPropagation(); setLang(false);
      }
    });
    langList.addEventListener("keydown", function (e) {
      var opts = options(), i = opts.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); focusOpt(Math.min(i + 1, opts.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); focusOpt(Math.max(i - 1, 0)); }
      else if (e.key === "Home") { e.preventDefault(); focusOpt(0); }
      else if (e.key === "End") { e.preventDefault(); focusOpt(opts.length - 1); }
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (i >= 0) chooseLang(opts[i].getAttribute("data-lang"));
      } else if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation(); setLang(false); langBtn.focus();
      } else if (e.key === "Tab") { setLang(false); }
    });
    langWrap.addEventListener("focusout", function (e) {
      if (langOpen && e.relatedTarget && !langWrap.contains(e.relatedTarget)) setLang(false);
    });
    document.addEventListener("click", function (e) {
      if (langOpen && !langWrap.contains(e.target)) setLang(false);
    });
    renderLang();
    return li;
  }

  function options() { return Array.prototype.slice.call(langList.querySelectorAll("[role=option]")); }
  function selectedIdx() {
    var c = curLang();
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === c) return i;
    return 0;
  }
  function focusOpt(i) { var o = options()[i]; if (o) o.focus(); }

  function setLang(open) {
    langOpen = open;
    langBtn.setAttribute("aria-expanded", open ? "true" : "false");
    langList.hidden = !open;
    if (open) setMenu(false);
  }

  function chooseLang(code) {
    setLang(false);
    langBtn.focus();
    if (code !== curLang() && I18N) I18N.setLang(code);
    else renderLang();
  }

  function renderLang() {
    if (!langBtn) return;
    var c = curLang(), L = LANGS[selectedIdx()];
    var parts = langBtn.children;
    parts[0].textContent = L.flag;
    parts[0].setAttribute("aria-hidden", "true");
    parts[1].textContent = langName(c);
    parts[2].textContent = c.toUpperCase();
    langBtn.setAttribute("aria-label", T("lang.choose", { name: langName(c) }));
    langList.setAttribute("aria-label", T("lang.label"));
    options().forEach(function (o) {
      var sel = o.getAttribute("data-lang") === c;
      o.setAttribute("aria-selected", sel ? "true" : "false");
      o.querySelector(".mx-lang-opt-name").textContent = langName(o.getAttribute("data-lang"));
    });
  }

  function setBurger(open) {
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    navEl.classList.toggle("is-open", open);
    if (!open) setMenu(false);
  }

  function setMenu(open) {
    menuOpen = open;
    var b = acctItem && acctItem.querySelector(".mx-acct-btn");
    var m = acctItem && acctItem.querySelector(".mx-menu");
    if (!b || !m) return;
    b.setAttribute("aria-expanded", open ? "true" : "false");
    m.hidden = !open;
  }

  function offlineNote() {
    var p = el("p", "mx-menu-note");
    p.appendChild(document.createTextNode(T("nav.offlineBefore")));
    p.appendChild(el("code", null, "python3 server/proxy.py"));
    p.appendChild(document.createTextNode(T("nav.offlineAfter")));
    return p;
  }

  function menuLink(href, label, key) {
    var li = el("li");
    var a = el("a", "mx-nav-link", label);
    a.href = href;
    if (key) a.setAttribute("data-nav-sub", key);
    if (key && currentPage() === key) a.setAttribute("aria-current", "page");
    li.appendChild(a);
    return li;
  }

  function renderAccount() {
    while (acctItem.firstChild) acctItem.removeChild(acctItem.firstChild);
    menuOpen = false;
    var u = nav.user;

    if (!u && !nav.offline) {
      var a = el("a", "mx-nav-link mx-acct-signin", T("nav.signIn"));
      a.href = "account.html";
      a.setAttribute("data-nav", "account");
      acctItem.appendChild(a);
      markCurrent();
      return;
    }

    var btn = el("button", "mx-nav-link mx-acct-btn");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", "mx-acct-menu");
    btn.setAttribute("aria-haspopup", "true");
    var wrap = el("span", "mx-acct-wrap");
    var menu = el("ul", "mx-menu");
    menu.id = "mx-acct-menu";
    menu.hidden = true;

    if (u) {
      var name = String(u.displayName || T("nav.accountFallback"));
      wrap.appendChild(el("span", "mx-avatar", name.trim().charAt(0).toUpperCase() || "?"));
      var nm = el("span", "mx-acct-name", name);
      wrap.appendChild(nm);
      var premium = !!(u.premium && u.premium.active);
      if (premium) wrap.appendChild(el("span", "mx-badge-premium", "Premium"));
      btn.setAttribute("aria-label", T(premium ? "nav.acctMenuForPremium" : "nav.acctMenuFor", { name: name }));
      menu.appendChild(menuLink("account.html", T("nav.account"), "account.html"));
      if (premium) menu.appendChild(menuLink("cloud.html", T("nav.cloud"), "cloud.html"));
      else menu.appendChild(menuLink("premium.html", T("nav.upgrade"), null));
      menu.appendChild(el("li", "mx-menu-sep"));
      var li = el("li");
      var out = el("button", "mx-nav-link", T("nav.signOut"));
      out.type = "button";
      out.addEventListener("click", signOut);
      li.appendChild(out);
      menu.appendChild(li);
    } else {
      wrap.appendChild(el("span", null, T("nav.signIn")));
      btn.setAttribute("aria-label", T("nav.signInOffline"));
      var noteLi = el("li");
      noteLi.appendChild(offlineNote());
      menu.appendChild(noteLi);
      menu.appendChild(menuLink("account.html", T("nav.goAccount"), "account.html"));
    }
    btn.setAttribute("data-nav", "account");
    btn.appendChild(wrap);
    btn.appendChild(caret());
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      setMenu(!menuOpen);
    });
    acctItem.appendChild(btn);
    acctItem.appendChild(menu);
    markCurrent();
  }

  function focusSignIn() {
    var t = acctItem && acctItem.querySelector(".mx-acct-signin, .mx-acct-btn");
    if (t) t.focus();
  }

  function signOut() {
    var A = api();
    setMenu(false);
    if (!A || typeof A.logout !== "function") { nav.user = null; renderAccount(); emit(); focusSignIn(); return; }
    A.logout(function () { refresh(focusSignIn); });
  }

  /* ---------- auth ---------- */

  function refresh(cb) {
    var A = api();
    if (!A || typeof A.me !== "function") {
      nav.user = null;
      nav.offline = true;
      if (acctItem) renderAccount();
      emit();
      if (typeof cb === "function") cb(null, nav.user);
      return;
    }
    A.me(function (err, data) {
      if (err) {
        nav.user = null;
        nav.offline = FILE_MODE || err.status === 0;
      } else {
        nav.user = (data && data.user) || null;
        nav.offline = false;
      }
      if (acctItem) renderAccount();
      emit();
      if (typeof cb === "function") cb(err || null, nav.user);
    });
  }

  /* ---------- assistant deep link (doctors.html#assistant) ----------
     Fallback only: when assistant/ui.js sets MedIndex.ui.handlesDeepLinks it owns the
     hash, and nav.js only opens the panel on an explicit same-hash nav click. */

  function isAssistantHash() { return /^#assistant(&|$)/.test(location.hash); }

  function uiHandlesDeepLinks() {
    return !!(window.MedIndex && window.MedIndex.ui && window.MedIndex.ui.handlesDeepLinks);
  }

  function panelIsOpen(fab) {
    if (fab && fab.getAttribute("aria-expanded") === "true") return true;
    if (document.documentElement.classList.contains("mi-panel-open")) return true;
    var panel = document.querySelector(".mi-panel");
    return !!(panel && !panel.hidden && panel.offsetParent !== null);
  }

  function openAssistant(tries, explicit) {
    if (!explicit && uiHandlesDeepLinks()) return;
    var fab = document.getElementById("mi-fab");
    if (fab) {
      if (!panelIsOpen(fab)) fab.click();
      return;
    }
    if (tries < 40) setTimeout(function () { openAssistant(tries + 1, explicit); }, 100);
  }

  /* ---------- start ---------- */

  function start() {
    if (!build()) return;
    refresh();
    if (onDoctors() && isAssistantHash()) {
      // Decide only after every deferred script (incl. ui.js) has run.
      if (document.readyState === "complete") openAssistant(0, false);
      else window.addEventListener("load", function () { openAssistant(0, false); });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
