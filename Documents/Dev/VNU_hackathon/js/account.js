/* MedIndex account page: sign in, create account, profile. */
(function () {
  "use strict";

  var API = window.MedIndexAPI;

  function $(id) { return document.getElementById(id); }
  function show(el, on) { if (el) el.hidden = !on; }

  /* ---------- open-redirect guard ---------- */
  // Only same-site relative pages like "premium.html", "doctors.html#x" or "cloud.html?a=b".
  function safeNext(raw) {
    if (typeof raw !== "string" || !raw) return null;
    if (raw.length > 200) return null;
    if (/[\s\\]/.test(raw) || raw.indexOf("//") !== -1) return null;
    // A bare page name first, so "javascript:", "http:", "/x" and "../x" never match.
    var m = /^([A-Za-z0-9][A-Za-z0-9_-]*\.html)([?#][\x21-\x7e]*)?$/.exec(raw);
    if (!m) return null;
    if (m[1].toLowerCase() === "account.html") return null;
    return raw;
  }

  function readNext() {
    try {
      var params = new URLSearchParams(location.search);
      return safeNext(params.get("next"));
    } catch (e) { return null; }
  }

  var next = readNext();

  /* ---------- validation ---------- */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function normPhone(v) { return v.replace(/[\s().-]/g, ""); }
  function isPhone(v) {
    var p = normPhone(v);
    if (/^(\+40|0040|40)?0?7\d{8}$/.test(p) || /^0[23]\d{8}$/.test(p)) return true; // Romanian mobile / landline
    return /^(\+|00)[1-9]\d{7,14}$/.test(p); // international E.164
  }
  function identifierHint(v) {
    v = v.trim();
    if (!v) return "Enter your email or phone number.";
    if (v.indexOf("@") !== -1) return EMAIL_RE.test(v) ? "" : "That email doesn't look right (e.g. name@example.com).";
    if (/^[+\d\s().-]+$/.test(v)) return isPhone(v) ? "" : "Enter a valid phone number, e.g. 0722 123 456 or +40 722 123 456.";
    return "Enter an email address or a phone number.";
  }

  /* ---------- field errors ---------- */
  function setFieldError(input, msg) {
    var err = $(input.id + "-error");
    if (err) err.textContent = msg || "";
    if (msg) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
  function setFormError(el, msg) {
    el.textContent = msg || "";
    show(el, !!msg);
  }
  function clearErrors(form) {
    var inputs = form.querySelectorAll("input");
    for (var i = 0; i < inputs.length; i++) setFieldError(inputs[i], "");
  }

  function friendly(err) {
    if (!err) return "";
    if (err.status === 0) {
      if (err.error === "offline") return "Accounts need the local server.";
      if (err.error === "timeout") return "The server took too long to answer. Please try again.";
      return "Can't reach the server. Is python3 server/proxy.py running?";
    }
    if (err.status === 429) return err.error && !/^Request failed/.test(err.error) ? err.error : "Too many attempts. Please wait a minute and try again.";
    return err.error || "Something went wrong. Please try again.";
  }

  /* ---------- views ---------- */
  var views = ["acct-offline", "acct-loading", "acct-error", "acct-auth", "acct-profile"];
  function view(id) {
    for (var i = 0; i < views.length; i++) show($(views[i]), views[i] === id);
  }

  function refreshNav() {
    try {
      if (window.MedIndexNav && typeof window.MedIndexNav.refresh === "function") window.MedIndexNav.refresh();
    } catch (e) { /* nav is optional */ }
  }

  function formatDate(v) {
    if (!v) return "";
    var d = new Date(typeof v === "number" && v < 1e12 ? v * 1000 : v);
    if (isNaN(d.getTime())) return String(v);
    try { return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }
    catch (e) { return d.toDateString(); }
  }

  function planLabel(plan) {
    if (!plan) return "";
    var s = String(plan);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function renderProfile(user, statusMsg) {
    var name = user.displayName || "MedIndex member";
    $("profile-name").textContent = name;
    $("profile-avatar").textContent = name.trim().charAt(0).toUpperCase() || "M";
    var idType = user.identifierType ? String(user.identifierType) : "";
    $("profile-identifier").textContent = (idType ? idType.charAt(0).toUpperCase() + idType.slice(1) + ": " : "") + (user.identifierMasked || "");

    var prem = user.premium || {};
    var planEl = $("profile-plan");
    if (prem.active) {
      planEl.textContent = "Premium" + (prem.plan ? " · " + planLabel(prem.plan) : "");
      planEl.className = "acct-plan acct-plan-premium";
      $("link-premium-title").textContent = "Manage Premium";
      $("link-premium-sub").textContent = "Plan, renewal and cancellation";
      $("link-cloud-sub").textContent = "Your files and ChatBot History";
    } else {
      planEl.textContent = "Regular";
      planEl.className = "acct-plan";
      $("link-premium-title").textContent = "Go Premium";
      $("link-premium-sub").textContent = "Unlock the Secure Medical Cloud";
      $("link-cloud-sub").textContent = "Premium feature";
    }
    var renews = prem.active && (prem.renewsAt || prem.since);
    show($("profile-renews-row"), !!renews);
    if (renews) {
      $("profile-renews-label").textContent = prem.renewsAt ? "Renews" : "Member since";
      $("profile-renews").textContent = formatDate(prem.renewsAt || prem.since);
    }
    var st = $("acct-status");
    st.textContent = statusMsg || "";
    show(st, !!statusMsg);
    view("acct-profile");
  }

  function load() {
    if (!API || !API.isOnline()) { view("acct-offline"); return; }
    view("acct-loading");
    API.me(function (err, data) {
      if (err) {
        $("acct-error-text").textContent = friendly(err);
        view("acct-error");
        return;
      }
      if (data && data.user) renderProfile(data.user);
      else showAuth();
    });
  }

  /* ---------- tabs ---------- */
  var tabs = [$("tab-login"), $("tab-signup")];
  function selectTab(which, focus) {
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      var on = t.id === "tab-" + which;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      show($(t.getAttribute("aria-controls")), on);
      if (on && focus) t.focus();
    }
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { selectTab(t.id.slice(4), false); });
    t.addEventListener("keydown", function (e) {
      var idx = null;
      if (e.key === "ArrowRight") idx = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") idx = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") idx = 0;
      else if (e.key === "End") idx = tabs.length - 1;
      if (idx === null) return;
      e.preventDefault();
      selectTab(tabs[idx].id.slice(4), true);
    });
  });

  function showAuth() {
    var note = $("acct-next-note");
    if (next) {
      var page = next.split(/[?#]/)[0].replace(/\.html$/i, "");
      var labels = { premium: "Premium", cloud: "the Medical Cloud", doctors: "the doctor directory", index: "the home page" };
      note.textContent = "Sign in or create an account to continue to " + (labels[page] || page) + ".";
      show(note, true);
    }
    selectTab(location.hash === "#signup" ? "signup" : "login", false);
    view("acct-auth");
  }

  /* ---------- password toggles ---------- */
  var toggles = document.querySelectorAll(".acct-pass-toggle");
  for (var ti = 0; ti < toggles.length; ti++) {
    toggles[ti].addEventListener("click", function () {
      var input = $(this.getAttribute("data-target"));
      var showing = input.type === "text";
      input.type = showing ? "password" : "text";
      this.textContent = showing ? "Show" : "Hide";
      this.setAttribute("aria-pressed", showing ? "false" : "true");
      this.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
  }

  /* ---------- live password hint ---------- */
  var sPass = $("signup-password");
  var hint = $("signup-password-hint");
  var hintText = $("signup-password-hint-text");
  function updateHint() {
    var len = sPass.value.length;
    if (!len) { hint.setAttribute("data-state", "idle"); hintText.textContent = "At least 8 characters"; return; }
    if (len >= 8) { hint.setAttribute("data-state", "ok"); hintText.textContent = "At least 8 characters: done"; }
    else { hint.setAttribute("data-state", "bad"); hintText.textContent = "At least 8 characters (" + (8 - len) + " more)"; }
  }
  sPass.addEventListener("input", function () { updateHint(); if (sPass.value.length >= 8) setFieldError(sPass, ""); });

  var sId = $("signup-identifier");
  sId.addEventListener("blur", function () { if (sId.value.trim()) setFieldError(sId, identifierHint(sId.value)); });
  sId.addEventListener("input", function () { if (sId.getAttribute("aria-invalid") && !identifierHint(sId.value)) setFieldError(sId, ""); });

  /* ---------- submit helpers ---------- */
  function busy(btn, on, label) {
    btn.disabled = on;
    if (on) { btn.setAttribute("data-label", btn.textContent); btn.textContent = label; }
    else if (btn.getAttribute("data-label")) btn.textContent = btn.getAttribute("data-label");
  }

  function applyServerError(err, form, map, formErrEl) {
    var msg = friendly(err);
    var input = err && err.field && map[err.field];
    if (input) { setFieldError(input, msg); input.focus(); setFormError(formErrEl, ""); }
    else setFormError(formErrEl, msg);
  }

  function afterAuth(user, msg) {
    refreshNav();
    if (next) { location.href = next; return; }
    renderProfile(user, msg);
    $("main").focus();
  }

  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var form = this;
    var idEl = $("login-identifier");
    var pwEl = $("login-password");
    var errEl = $("login-error");
    clearErrors(form);
    setFormError(errEl, "");
    var ok = true;
    if (!idEl.value.trim()) { setFieldError(idEl, "Enter your email, phone or username."); ok = false; }
    if (!pwEl.value) { setFieldError(pwEl, "Enter your password."); ok = false; }
    if (!ok) { (idEl.value.trim() ? pwEl : idEl).focus(); return; }
    var btn = $("login-submit");
    busy(btn, true, "Signing in…");
    API.login(idEl.value.trim(), pwEl.value, function (err, data) {
      busy(btn, false);
      if (err) {
        applyServerError(err, form, { identifier: idEl, password: pwEl }, errEl);
        if (!err.field) pwEl.focus();
        return;
      }
      pwEl.value = "";
      if (data && data.user) afterAuth(data.user, "You're signed in.");
      else load();
    });
  });

  $("signup-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var form = this;
    var idEl = $("signup-identifier");
    var pwEl = $("signup-password");
    var nameEl = $("signup-name");
    var errEl = $("signup-error");
    clearErrors(form);
    setFormError(errEl, "");
    var first = null;
    var idMsg = identifierHint(idEl.value);
    if (idMsg) { setFieldError(idEl, idMsg); first = first || idEl; }
    if (pwEl.value.length < 8) { setFieldError(pwEl, "Password must be at least 8 characters."); first = first || pwEl; updateHint(); }
    if (first) { first.focus(); return; }
    var btn = $("signup-submit");
    busy(btn, true, "Creating account…");
    var ident = idEl.value.trim();
    if (ident.indexOf("@") === -1) ident = normPhone(ident);
    API.signup(ident, pwEl.value, nameEl.value.trim(), function (err, data) {
      busy(btn, false);
      if (err) {
        if (err.status === 409 && !err.field) err.field = "identifier";
        if (err.status === 409 && /^Request failed/.test(err.error)) err.error = "An account with this email or phone already exists. Try signing in.";
        applyServerError(err, form, { identifier: idEl, password: pwEl, displayName: nameEl }, errEl);
        return;
      }
      pwEl.value = "";
      updateHint();
      if (data && data.user) afterAuth(data.user, "Welcome! Your account is ready.");
      else load();
    });
  });

  $("demo-fill").addEventListener("click", function () {
    $("login-identifier").value = "admin";
    $("login-password").value = "adminboss";
    $("login-submit").focus();
  });

  $("logout-btn").addEventListener("click", function () {
    var btn = this;
    busy(btn, true, "Signing out…");
    API.logout(function (err) {
      busy(btn, false);
      if (err && err.status !== 401) {
        var st = $("acct-status");
        st.textContent = "Couldn't sign out: " + friendly(err);
        show(st, true);
        return;
      }
      refreshNav();
      next = null;
      showAuth();
      setFormError($("login-error"), "");
      $("tab-login").focus();
    });
  });

  $("acct-retry").addEventListener("click", load);

  document.addEventListener("medindex:auth", function (e) {
    // Another part of the page (e.g. the header) changed the session.
    if (e && e.detail && e.detail.source === "account") return;
    if (!API || !API.isOnline() || !$("acct-loading").hidden) return;
    var wasIn = !$("acct-profile").hidden;
    var nowIn = e && e.detail && "user" in e.detail ? !!e.detail.user : null;
    if (nowIn !== null && nowIn !== wasIn) load();
  });

  // Exposed for tests only (no auth data).
  window.MedIndexAccount = { safeNext: safeNext, isPhone: isPhone, identifierHint: identifierHint };

  load();
})();
