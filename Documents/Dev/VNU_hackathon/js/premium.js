/* MedIndex – Premium page: plan toggle, account status and the DEMO checkout.
   Server calls only through window.MedIndexAPI. Card data is kept only in the
   form fields until submit, then cleared; it is never written to any storage. */
(function () {
  "use strict";

  var PRICES = { monthly: 5.99, yearly: 65.99 };
  var SAVE_PCT = Math.round((1 - PRICES.yearly / (PRICES.monthly * 12)) * 1000) / 10;   // 8.2
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var FIELDS = ["name", "number", "exp", "cvc"];

  var plan = "monthly";
  var auth = { user: null, offline: location.protocol === "file:", known: false };
  var step = 1, busy = false, lastFocus = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function api() { return window.MedIndexAPI || null; }
  function money(v) { return "$" + v.toFixed(2); }
  function planLabel(p) { return p === "yearly" ? "Premium · Yearly" : "Premium · Monthly"; }

  function toDate(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtDate(v) {
    var d = toDate(v);
    if (!d) return "—";
    try { return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }
    catch (e) { return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); }
  }
  function renewPreview(p) {
    var d = new Date();
    if (p === "yearly") d.setFullYear(d.getFullYear() + 1); else d.setMonth(d.getMonth() + 1);
    return fmtDate(d);
  }

  /* ---------- billing toggle ---------- */

  function setPlan(p) {
    plan = p;
    $("bill-monthly").setAttribute("aria-pressed", p === "monthly" ? "true" : "false");
    $("bill-yearly").setAttribute("aria-pressed", p === "yearly" ? "true" : "false");
    if (p === "yearly") {
      $("prem-amount").textContent = money(PRICES.yearly);
      $("prem-per").textContent = "/ year";
      $("prem-alt").textContent = "That's " + money(PRICES.yearly / 12) + " a month — save " + SAVE_PCT + "% vs monthly (" + money(PRICES.monthly * 12) + " a year).";
    } else {
      $("prem-amount").textContent = money(PRICES.monthly);
      $("prem-per").textContent = "/ month";
      $("prem-alt").textContent = "Or " + money(PRICES.yearly) + " a year and save " + SAVE_PCT + "%.";
    }
    renderCta();
  }

  /* ---------- status + CTA ---------- */

  function isPremium() { return !!(auth.user && auth.user.premium && auth.user.premium.active); }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function link(href, cls, text) { var a = el("a", cls, text); a.href = href; return a; }

  function renderStatus(message, kind) {
    var box = $("pr-status");
    clear(box);
    box.className = "mx-status";
    var h = el("h2"); h.id = "pr-status-title";
    var actions = el("div", "mx-status-actions");

    if (!auth.known) {
      h.textContent = "Checking your account…";
      box.appendChild(h);
      return;
    }

    if (isPremium()) {
      var pr = auth.user.premium;
      box.className = "mx-status mx-status-premium";
      h.textContent = "You're on Premium";
      box.appendChild(h);
      var dl = el("dl");
      dl.appendChild(el("dt", null, "Plan"));
      dl.appendChild(el("dd", null, pr.plan === "yearly" ? "Yearly (" + money(PRICES.yearly) + " / year)" : pr.plan === "monthly" ? "Monthly (" + money(PRICES.monthly) + " / month)" : "Premium"));
      if (pr.since) { dl.appendChild(el("dt", null, "Member since")); dl.appendChild(el("dd", null, fmtDate(pr.since))); }
      dl.appendChild(el("dt", null, "Renews on"));
      dl.appendChild(el("dd", null, fmtDate(pr.renewsAt)));
      box.appendChild(dl);
      actions.appendChild(link("cloud.html", "mx-btn mx-btn-primary", "Open Medical Cloud"));
      var cancel = el("button", "mx-btn mx-btn-danger", "Cancel Premium (demo)");
      cancel.type = "button";
      cancel.id = "pr-cancel";
      cancel.addEventListener("click", function () { renderCancelConfirm(); });
      actions.appendChild(cancel);
      box.appendChild(actions);
    } else if (auth.user) {
      h.textContent = "Hi " + String(auth.user.displayName || "there") + ", you're on the free Regular plan";
      box.appendChild(h);
      box.appendChild(el("p", null, "Upgrade any time to read every review and get your 5 GB Secure Medical Cloud (demo: only file details are saved, not the files themselves)."));
    } else if (auth.offline) {
      h.textContent = "Offline mode";
      box.appendChild(h);
      var p = el("p");
      p.appendChild(document.createTextNode("Sign-in and checkout need the local server. Run "));
      p.appendChild(el("code", null, "python3 server/proxy.py"));
      p.appendChild(document.createTextNode(" and open http://127.0.0.1:8000/premium.html."));
      box.appendChild(p);
    } else {
      h.textContent = "Sign in to get Premium";
      box.appendChild(h);
      box.appendChild(el("p", null, "Premium is linked to your MedIndex account. Sign in or create a free account, then come back here to upgrade."));
      actions.appendChild(link("account.html?next=premium.html", "mx-btn mx-btn-primary", "Sign in"));
      actions.appendChild(link("account.html?next=premium.html", "mx-btn mx-btn-secondary", "Create an account"));
      box.appendChild(actions);
    }

    if (message) box.appendChild(el("p", kind === "error" ? "mx-msg-err" : "mx-msg-ok", message));
  }

  function renderCancelConfirm() {
    var box = $("pr-status");
    var old = $("pr-cancel-confirm");
    if (old) { old.querySelector("button").focus(); return; }
    var wrap = el("div", "mx-status-actions");
    wrap.id = "pr-cancel-confirm";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Confirm cancellation");
    var q = el("p", null, "Cancel Premium now? Your account goes back to the free Regular plan.");
    q.style.flexBasis = "100%";
    wrap.appendChild(q);
    var yes = el("button", "mx-btn mx-btn-danger", "Yes, cancel Premium");
    yes.type = "button";
    var no = el("button", "mx-btn mx-btn-secondary", "Keep Premium");
    no.type = "button";
    wrap.appendChild(yes);
    wrap.appendChild(no);
    box.appendChild(wrap);
    no.focus();
    no.addEventListener("click", function () { box.removeChild(wrap); var c = $("pr-cancel"); if (c) c.focus(); });
    yes.addEventListener("click", function () {
      var A = api();
      if (!A || !A.premium || typeof A.premium.cancel !== "function") { renderStatus("Cancelling needs the local server.", "error"); return; }
      yes.disabled = true; no.disabled = true;
      yes.textContent = "Cancelling…";
      A.premium.cancel(function (err) {
        if (err) {
          renderStatus(err.status === 401 ? "Your session has expired. Please sign in again." : "Could not cancel: " + String(err.error || "unknown error") + ".", "error");
          if (err.status === 401) refreshNav();
          return;
        }
        refreshNav("Premium cancelled. You're back on the free Regular plan.");
      });
    });
  }

  function renderCta() {
    var a = $("prem-cta");
    var reg = $("reg-cta");
    var btn;
    if (isPremium()) {
      btn = el("a", "mx-btn mx-btn-secondary", "Open Medical Cloud");
      btn.href = "cloud.html";
      reg.textContent = "Start searching";
    } else if (auth.user) {
      btn = el("button", "mx-btn mx-btn-primary", "Upgrade to Premium · " + money(PRICES[plan]) + (plan === "yearly" ? "/yr" : "/mo"));
      btn.type = "button";
      btn.addEventListener("click", function () { openCheckout(btn); });
      reg.textContent = "Start searching";
    } else {
      btn = el("a", "mx-btn mx-btn-primary", auth.offline ? "Get Premium (needs the local server)" : "Sign in to get Premium");
      btn.href = "account.html?next=premium.html";
      reg.textContent = "Start searching";
    }
    btn.id = "prem-cta";
    $("reg-current").hidden = !(auth.user && !isPremium());
    $("prem-current").hidden = !isPremium();
    a.parentNode.replaceChild(btn, a);
  }

  function onAuth(detail) {
    auth.user = (detail && detail.user) || null;
    auth.offline = !!(detail && detail.offline);
    auth.known = true;
    if (!$("co").hidden && !auth.user && step !== 4) closeCheckout();
    renderStatus();
    renderCta();
  }

  function refreshNav(message) {
    var N = window.MedIndexNav;
    if (N && typeof N.refresh === "function") {
      N.refresh(function () { renderStatus(message); });
    } else {
      renderStatus(message);
    }
  }

  /* ---------- checkout modal ---------- */

  function focusables(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"),
      function (n) { return n.offsetParent !== null; });
  }

  var STEP_NAMES = ["", "Step 1 of 3: plan summary", "Step 2 of 3: card details", "Step 3 of 3: processing", "Payment complete"];

  function showStep(n) {
    step = n;
    for (var i = 1; i <= 4; i++) $("co-step-" + i).hidden = i !== n;
    Array.prototype.forEach.call(document.querySelectorAll(".mx-steps-bar li"), function (li, idx) {
      li.classList.toggle("is-done", idx < Math.min(n, 3));
    });
    $("co-close").disabled = n === 3;
    $("co-stepname").textContent = STEP_NAMES[n];
    $("co-title").textContent = n === 2 ? "Card details" : n === 4 ? "Welcome to Premium" : "Upgrade to Premium";
    if (n === 1) $("co-next").focus();
    else if (n === 2) $("cc-name").focus();
    else if (n === 3) $("co-title").focus();
    else if (n === 4) $("co-title").focus();
  }

  function openCheckout(trigger) {
    if (!auth.user) { location.href = "account.html?next=premium.html"; return; }
    lastFocus = trigger || document.activeElement;
    $("co-plan").textContent = planLabel(plan);
    $("co-billing").textContent = plan === "yearly" ? money(PRICES.yearly) + " / year (save " + SAVE_PCT + "%)" : money(PRICES.monthly) + " / month";
    $("co-renews").textContent = renewPreview(plan);
    $("co-total").textContent = money(PRICES[plan]) + " (demo)";
    $("co-pay").textContent = "Pay " + money(PRICES[plan]) + " (demo)";
    clearForm(true);
    $("co").hidden = false;
    document.documentElement.classList.add("mx-modal-open");
    showStep(1);
  }

  function closeCheckout() {
    if (busy) return;
    clearForm(true);
    $("co").hidden = true;
    document.documentElement.classList.remove("mx-modal-open");
    var target = $("prem-cta") || lastFocus;
    if (target && target.focus) target.focus();
  }

  function fieldInput(f) { return $("cc-" + f); }

  function setFieldError(f, msg) {
    var input = fieldInput(f), err = $("cc-" + f + "-err");
    if (!input || !err) return;
    if (msg) { input.setAttribute("aria-invalid", "true"); err.textContent = msg; err.hidden = false; }
    else { input.removeAttribute("aria-invalid"); err.textContent = ""; err.hidden = true; }
  }

  function clearErrors() {
    FIELDS.forEach(function (f) { setFieldError(f, ""); });
    $("co-err").hidden = true;
    $("co-err").textContent = "";
  }

  /** Wipe card fields. `all` also clears the name and expiry. */
  function clearForm(all) {
    $("cc-number").value = "";
    $("cc-cvc").value = "";
    if (all) { $("cc-name").value = ""; $("cc-exp").value = ""; clearErrors(); }
  }

  /* Format-as-you-type helpers (hints only; the server validates). */
  function formatNumber() {
    var input = $("cc-number");
    var digits = input.value.replace(/\D/g, "").slice(0, 19);
    var out = digits.replace(/(\d{4})(?=\d)/g, "$1 ");
    if (out !== input.value) input.value = out;
  }
  function formatExp(e) {
    var input = $("cc-exp");
    var deleting = e && e.inputType && e.inputType.indexOf("delete") === 0;
    var digits = input.value.replace(/\D/g, "").slice(0, 4);
    if (digits.length === 1 && +digits > 1) digits = "0" + digits;
    var out = digits.length > 2 ? digits.slice(0, 2) + "/" + digits.slice(2) : (digits.length === 2 && !deleting ? digits + "/" : digits);
    if (out !== input.value) input.value = out;
  }
  function formatCvc() {
    var input = $("cc-cvc");
    var out = input.value.replace(/\D/g, "").slice(0, 4);
    if (out !== input.value) input.value = out;
  }

  function hintErrors(card) {
    var errs = {};
    if (!card.name.trim()) errs.name = "Enter the name on the card.";
    if (card.number.length < 12) errs.number = "Enter the full card number (try 4242 4242 4242 4242).";
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(card.exp)) errs.exp = "Use the format MM/YY, for example 12/29.";
    if (!/^\d{3,4}$/.test(card.cvc)) errs.cvc = "Enter 3 or 4 digits.";
    return errs;
  }

  function serverField(f) {
    f = String(f || "").replace(/^card\./, "").toLowerCase();
    if (f === "expiry" || f === "expiration") return "exp";
    if (f === "cardnumber") return "number";
    if (f === "cvv") return "cvc";
    return FIELDS.indexOf(f) >= 0 ? f : null;
  }

  function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    clearErrors();
    var card = {
      name: $("cc-name").value.trim(),
      number: $("cc-number").value.replace(/\D/g, ""),
      exp: $("cc-exp").value.trim(),
      cvc: $("cc-cvc").value.trim()
    };
    var errs = hintErrors(card), first = null;
    FIELDS.forEach(function (f) { if (errs[f]) { setFieldError(f, errs[f]); if (!first) first = f; } });
    if (first) { card = null; fieldInput(first).focus(); return; }

    var A = api();
    if (!A || !A.premium || typeof A.premium.checkout !== "function") {
      card = null;
      clearForm(false);
      $("co-err").textContent = "Checkout needs the local server (python3 server/proxy.py).";
      $("co-err").hidden = false;
      return;
    }

    // Clear the sensitive fields right away; the values live only in this call.
    clearForm(false);
    busy = true;
    showStep(3);
    var started = Date.now();
    var chosen = plan;
    A.premium.checkout(chosen, card, function (err, data) {
      card = null;
      var wait = Math.max(0, 1100 - (Date.now() - started));   // keep the processing state readable
      setTimeout(function () {
        busy = false;
        if (err) {
          if (err.status === 401) {
            closeCheckout();
            renderStatus("Your session has expired. Please sign in again.", "error");
            refreshNav();
            return;
          }
          showStep(2);
          var f = serverField(err.field);
          var msg = String(err.error || "The payment could not be completed.");
          if (err.status === 0) msg = "Can't reach the server. Is python3 server/proxy.py running?";
          if (!/[.!?]$/.test(msg)) msg += ".";
          $("co-err").textContent = msg + " Card number and CVC were cleared for your safety.";
          $("co-err").hidden = false;
          if (f) { setFieldError(f, msg); fieldInput(f).focus(); }
          return;
        }
        clearForm(true);
        var pr = data && data.premium;
        $("co-success-text").textContent = "Your " + (chosen === "yearly" ? "yearly" : "monthly") + " Premium plan is active" +
          (pr && pr.renewsAt ? " until " + fmtDate(pr.renewsAt) : "") + ". You can now read every review and use your 5 GB Secure Medical Cloud (demo: only file details are saved, not the files themselves).";
        showStep(4);
        refreshNav("Welcome to Premium! Your plan is active.");
      }, wait);
    });
  }

  function onKeydown(e) {
    if ($("co").hidden) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeCheckout(); return; }
    if (e.key !== "Tab") return;
    var f = focusables($("co-dialog"));
    if (!f.length) { e.preventDefault(); return; }
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !$("co-dialog").contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------- init ---------- */

  function init() {
    $("save-pct").textContent = "Save " + SAVE_PCT + "%";
    $("bill-monthly").addEventListener("click", function () { setPlan("monthly"); });
    $("bill-yearly").addEventListener("click", function () { setPlan("yearly"); });

    $("co-close").addEventListener("click", closeCheckout);
    Array.prototype.forEach.call(document.querySelectorAll("[data-co-close]"), function (b) { b.addEventListener("click", closeCheckout); });
    $("co").addEventListener("mousedown", function (e) { if (e.target === $("co") && step !== 3) closeCheckout(); });
    $("co-next").addEventListener("click", function () { showStep(2); });
    $("co-back").addEventListener("click", function () { clearErrors(); showStep(1); });
    $("co-step-2").addEventListener("submit", onSubmit);
    $("cc-number").addEventListener("input", formatNumber);
    $("cc-exp").addEventListener("input", formatExp);
    $("cc-cvc").addEventListener("input", formatCvc);
    FIELDS.forEach(function (f) {
      fieldInput(f).addEventListener("input", function () { if (fieldInput(f).getAttribute("aria-invalid")) setFieldError(f, ""); });
    });
    document.addEventListener("keydown", onKeydown, true);
    window.addEventListener("pagehide", function () { clearForm(true); });

    if (location.hash === "#yearly") setPlan("yearly"); else setPlan("monthly");

    document.addEventListener("medindex:auth", function (e) { onAuth(e.detail); });
    var N = window.MedIndexNav;
    if (N && N.ready) onAuth({ user: N.user, offline: N.offline });
    else if (!N) onAuth({ user: null, offline: true });
    else renderStatus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
