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

  function navLink(href, label, key) {
    var li = el("li");
    var a = el("a", "mx-nav-link", label);
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
    brand.setAttribute("aria-label", "MedIndex home");
    brand.appendChild(logo(34));
    brand.appendChild(el("span", null, "MedIndex"));
    inner.appendChild(brand);

    burger = el("button", "mx-burger");
    burger.type = "button";
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-controls", "mx-nav");
    burger.appendChild(svg("0 0 24 24", 22, 22, [["path", { d: "M4 7h16M4 12h16M4 17h16", stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round" }]]));
    burger.appendChild(el("span", "mx-sr", "Menu"));
    inner.appendChild(burger);

    navEl = el("nav", "mx-nav");
    navEl.id = "mx-nav";
    navEl.setAttribute("aria-label", "Main");
    var ul = el("ul", "mx-nav-list");
    ul.appendChild(navLink("index.html", "Home", "home"));
    ul.appendChild(navLink("doctors.html", "Find Doctors", "doctors"));
    ul.appendChild(navLink("doctors.html#assistant", "AI Assistant", "assistant"));
    ul.appendChild(navLink("premium.html", "Premium", "premium"));
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
      if (menuOpen) { setMenu(false); var b = acctItem.querySelector(".mx-acct-btn"); if (b) b.focus(); }
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
    return true;
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
    p.appendChild(document.createTextNode("Offline mode: sign-in needs the local server ("));
    p.appendChild(el("code", null, "python3 server/proxy.py"));
    p.appendChild(document.createTextNode(")."));
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
      var a = el("a", "mx-nav-link mx-acct-signin", "Sign in");
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
      var name = String(u.displayName || "Account");
      wrap.appendChild(el("span", "mx-avatar", name.trim().charAt(0).toUpperCase() || "?"));
      var nm = el("span", "mx-acct-name", name);
      wrap.appendChild(nm);
      var premium = !!(u.premium && u.premium.active);
      if (premium) wrap.appendChild(el("span", "mx-badge-premium", "Premium"));
      btn.setAttribute("aria-label", "Account menu for " + name + (premium ? " (Premium)" : ""));
      menu.appendChild(menuLink("account.html", "Account", "account.html"));
      if (premium) menu.appendChild(menuLink("cloud.html", "Medical Cloud", "cloud.html"));
      else menu.appendChild(menuLink("premium.html", "Upgrade to Premium", null));
      menu.appendChild(el("li", "mx-menu-sep"));
      var li = el("li");
      var out = el("button", "mx-nav-link", "Sign out");
      out.type = "button";
      out.addEventListener("click", signOut);
      li.appendChild(out);
      menu.appendChild(li);
    } else {
      wrap.appendChild(el("span", null, "Sign in"));
      btn.setAttribute("aria-label", "Sign in (offline mode)");
      var noteLi = el("li");
      noteLi.appendChild(offlineNote());
      menu.appendChild(noteLi);
      menu.appendChild(menuLink("account.html", "Go to the account page", "account.html"));
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
