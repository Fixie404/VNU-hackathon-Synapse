/* MedIndex – page transitions. Pairs with css/transitions.css.
   - Enter: content below the sticky header fades in with a small upward move.
   - Leave: internal .html link clicks fade the content out (~150 ms), then navigate.
   - Browsers with cross-document View Transitions get the same effect natively, and the
     JS fade is skipped so nothing animates twice.
   - prefers-reduced-motion: no movement, no delay, no View Transition.
   - window.MedIndexTransitions = { enter(el), leave(el, cb) } for in-page view swaps.
   No inline styles, no focus changes; every hidden state is a JS-added class with a timeout. */
(function () {
  "use strict";

  var IN_MS = 300, OUT_MS = 150, NAV_MAX_MS = 170;
  var root = document.documentElement;
  var reduceMq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var vtCaught = false;

  function reduced() { return !!(reduceMq && reduceMq.matches); }

  // Cross-document View Transitions (Chrome 126+, Safari 18.2+), opted in by css/transitions.css.
  var vtApi = "onpagereveal" in window && typeof document.startViewTransition === "function" &&
              typeof window.CSSViewTransitionRule === "function";
  var vtOptIn = null;
  function vtSupported() {
    if (!vtApi) return false;
    if (vtOptIn === null) {
      vtOptIn = false;
      try {
        var sheets = document.styleSheets;
        for (var i = 0; i < sheets.length && !vtOptIn; i++) {
          var rules = sheets[i].cssRules;
          for (var j = 0; j < rules.length; j++) {
            if (rules[j] instanceof window.CSSViewTransitionRule && rules[j].navigation === "auto") { vtOptIn = true; break; }
          }
        }
      } catch (_) { vtOptIn = false; }
    }
    return vtOptIn;
  }

  window.addEventListener("pagereveal", function (e) {
    if (e.viewTransition) vtCaught = true;
  });

  function vtRunning() {
    if (vtCaught || document.activeViewTransition) return true;
    if (typeof document.getAnimations !== "function") return false;
    var list = document.getAnimations();
    for (var i = 0; i < list.length; i++) {
      var fx = list[i].effect;
      if (fx && fx.pseudoElement && fx.pseudoElement.indexOf("::view-transition") === 0) return true;
    }
    return false;
  }

  /* ---------- targets: the page content, never the header or fixed layers ---------- */

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, LINK: 1, TEMPLATE: 1, NOSCRIPT: 1, HEADER: 0 };

  function targets() {
    var out = [];
    if (!document.body) return out;
    var kids = document.body.children;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (SKIP_TAGS[n.tagName] || n.id === "site-header" || n.hidden) continue;
      if (n.hasAttribute("data-no-transition")) continue;
      var pos = getComputedStyle(n).position;
      if (pos === "fixed" || pos === "absolute" || pos === "sticky") continue;   // skip links, overlays, FAB
      out.push(n);
    }
    return out;
  }

  /* ---------- class-based animation with a hard timeout ---------- */

  function animate(el, cls, ms, done) {
    var finished = false;
    function end(e) {
      if (finished || (e && e.target !== el)) return;
      finished = true;
      el.removeEventListener("animationend", end);
      el.removeEventListener("animationcancel", end);
      clearTimeout(timer);
      if (done) done(el); else el.classList.remove(cls);
    }
    el.classList.remove("mx-tx-in", "mx-tx-out", "mx-tx-view-in", "mx-tx-view-out");
    void el.offsetWidth;   // restart the animation if the class was just removed
    el.classList.add(cls);
    el.addEventListener("animationend", end);
    el.addEventListener("animationcancel", end);
    var timer = setTimeout(end, ms + 120);
    return end;
  }

  function clearAll() {
    var nodes = document.querySelectorAll(".mx-tx-in, .mx-tx-out");
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove("mx-tx-in", "mx-tx-out");
    root.classList.remove("mx-tx-leaving");
    leaving = false;
  }

  /* ---------- page enter ---------- */

  function alreadyPainted() {
    // If the content was already on screen before this deferred script ran, fading it
    // from 0 would blink. Only animate when nothing has been painted yet (or just now).
    try {
      var p = performance.getEntriesByType("paint");
      for (var i = 0; i < p.length; i++) {
        if (p[i].name === "first-contentful-paint" && performance.now() - p[i].startTime > 50) return true;
      }
    } catch (_) { /* old browser: animate */ }
    return false;
  }

  function enter() {
    if (reduced() || vtRunning() || alreadyPainted()) return;
    var list = targets();
    for (var i = 0; i < list.length; i++) animate(list[i], "mx-tx-in", IN_MS);
  }

  /* ---------- page leave ---------- */

  var leaving = false;

  function internalTarget(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a.hasAttribute("download") || a.hasAttribute("data-no-transition")) return null;
    if (a.closest("[data-no-transition]")) return null;
    var t = (a.getAttribute("target") || "").toLowerCase();
    if (t && t !== "_self") return null;
    var url;
    try { url = new URL(a.href, location.href); } catch (_) { return null; }
    if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return null;
    if (!/(\.html|\/)$/i.test(url.pathname)) return null;
    // Same document, only the hash differs (or nothing): let the browser handle it.
    if (url.pathname === location.pathname && url.search === location.search &&
        (url.hash || a.getAttribute("href").charAt(0) === "#")) return null;
    return url;
  }

  document.addEventListener("click", function (e) {
    if (leaving) return;
    // Native View Transitions animate the swap; reduced motion navigates instantly.
    if (reduced() || vtSupported()) return;
    var url = internalTarget(e);
    if (!url) return;
    var list = targets();
    if (!list.length) return;
    e.preventDefault();
    leaving = true;
    root.classList.add("mx-tx-leaving");
    var href = url.href, gone = false;
    function go() {
      if (gone) return;
      gone = true;
      location.assign(href);
      // If the navigation never happens (blocked, offline error page in a new tab…), restore.
      setTimeout(function () { if (document.visibilityState === "visible") clearAll(); }, 3000);
    }
    for (var i = 0; i < list.length; i++) {
      animate(list[i], "mx-tx-out", OUT_MS, i === 0 ? go : function () {});
    }
    setTimeout(go, NAV_MAX_MS);   // never hold the navigation longer than this
  }, false);

  // bfcache: a page restored with back/forward must never come back faded out.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) clearAll();
  });

  /* ---------- in-page view helper ---------- */

  window.MedIndexTransitions = {
    enter: function (el) {
      if (!el || reduced()) return;
      animate(el, "mx-tx-view-in", 260);
    },
    leave: function (el, cb) {
      if (!el || reduced()) { if (cb) cb(); return; }
      animate(el, "mx-tx-view-out", 140, function () {
        try { if (cb) cb(); }
        finally { el.classList.remove("mx-tx-view-out"); }
      });
    }
  };

  enter();
})();
