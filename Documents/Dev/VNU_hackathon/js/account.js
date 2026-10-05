/* MedIndex account page: sign in, create account, profile. */
(function () {
  "use strict";

  var API = window.MedIndexAPI;
  var L = window.MedIndexAccountI18n;
  var setText = L.setText, setAttr = L.setAttr, resolve = L.resolve;

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
    if (!v) return "account.val.idEmpty";
    if (v.indexOf("@") !== -1) return EMAIL_RE.test(v) ? "" : "account.val.emailBad";
    if (/^[+\d\s().-]+$/.test(v)) return isPhone(v) ? "" : "account.val.phoneBad";
    return "account.val.idKind";
  }

  /* ---------- field errors (msg = a message spec, re-translated on a language change) ---------- */
  function setFieldError(input, msg) {
    var err = $(input.id + "-error");
    if (err) setText(err, msg || "");
    if (msg) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
  function setFormError(el, msg) {
    setText(el, msg || "");
    show(el, !!msg);
  }
  function clearErrors(form) {
    var inputs = form.querySelectorAll("input");
    for (var i = 0; i < inputs.length; i++) setFieldError(inputs[i], "");
  }

  // Returns a message spec: a known key, or {raw} for an unknown server message.
  function friendly(err) {
    if (!err) return "";
    if (err.status === 0) {
      if (err.error === "offline") return "account.err.offline";
      if (err.error === "timeout") return "account.err.timeout";
      return "account.err.unreachable";
    }
    var known = L.errorKey(err.error);
    if (known) return known;
    if (!err.error || /^Request failed/.test(err.error)) return err.status === 429 ? "account.err.tooMany" : "account.err.generic";
    return { raw: err.error };
  }

  /* ---------- views ---------- */
  var views = ["acct-offline", "acct-static", "acct-loading", "acct-error", "acct-auth", "acct-profile"];
  function view(id) {
    for (var i = 0; i < views.length; i++) show($(views[i]), views[i] === id);
    show($("acct-reviews"), id === "acct-profile"); // "My reviews" goes with the signed-in view
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
    return L.formatDate(d, { day: "numeric", month: "long", year: "numeric" });
  }

  function planSpec(plan) {
    if (!plan) return "";
    var s = String(plan).toLowerCase();
    if (L.has("account.plan." + s)) return "account.plan." + s;
    return { raw: s.charAt(0).toUpperCase() + s.slice(1) };
  }

  function renderProfile(user, statusMsg) {
    var custom = user.displayName ? String(user.displayName) : "";
    if (custom) setText($("profile-name"), { raw: custom });
    else setText($("profile-name"), "account.member");
    setText($("profile-avatar"), { fn: function () { return ($("profile-name").textContent.trim().charAt(0) || "M").toUpperCase(); } });
    var idType = user.identifierType ? String(user.identifierType).toLowerCase() : "";
    var masked = user.identifierMasked || "";
    if (idType) {
      var typeSpec = L.has("account.idType." + idType) ? "account.idType." + idType : { raw: idType.charAt(0).toUpperCase() + idType.slice(1) };
      setText($("profile-identifier"), { k: "account.idLine", v: { type: typeSpec, value: { raw: masked } } });
    } else {
      setText($("profile-identifier"), { raw: masked });
    }

    var prem = user.premium || {};
    var planEl = $("profile-plan");
    if (prem.active) {
      setText(planEl, prem.plan ? { k: "account.plan.premiumWith", v: { plan: planSpec(prem.plan) } } : "account.plan.premium");
      planEl.className = "acct-plan acct-plan-premium";
      setText($("link-premium-title"), "account.link.managePremium");
      setText($("link-premium-sub"), "account.link.managePremiumSub");
      setText($("link-cloud-sub"), "account.link.cloudSubPremium");
    } else {
      setText(planEl, "account.plan.regular");
      planEl.className = "acct-plan";
      setText($("link-premium-title"), "account.link.goPremium");
      setText($("link-premium-sub"), "account.link.goPremiumSub");
      setText($("link-cloud-sub"), "account.link.cloudSubRegular");
    }
    var renews = prem.active && (prem.renewsAt || prem.since);
    show($("profile-renews-row"), !!renews);
    if (renews) {
      setText($("profile-renews-label"), prem.renewsAt ? "account.renews" : "account.memberSince");
      var when = prem.renewsAt || prem.since;
      setText($("profile-renews"), { fn: function () { return formatDate(when); } });
    }
    var st = $("acct-status");
    setText(st, statusMsg || "");
    show(st, !!statusMsg);
    view("acct-profile");
    loadReviews();
  }

  /* ---------- my reviews (GET /api/reviews/mine, DELETE /api/reviews/<id>) ---------- */
  var reviewsSeq = 0;
  var reviewStates = ["my-reviews-loading", "my-reviews-error", "my-reviews-empty", "my-reviews-list"];
  function reviewsView(id) {
    for (var i = 0; i < reviewStates.length; i++) show($(reviewStates[i]), reviewStates[i] === id);
  }
  function reviewsAnnounce(spec) {
    var live = $("my-reviews-live");
    setText(live, "");
    setTimeout(function () { setText(live, spec); }, 60);
  }
  function doctorById(id) {
    var list = window.DOCTORS;
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].id) === String(id)) return list[i];
    return null;
  }
  function hospitalName(h) {
    if (!h) return "";
    var k = "hospital." + h, s = L.t(k);
    return !s || s === k ? String(h) : s;
  }
  function starText(n) {
    var s = "";
    for (var i = 1; i <= 5; i++) s += i <= n ? "★" : "☆";
    return s;
  }
  function elem(tag, className) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    return n;
  }

  function buildReviewItem(r) {
    var d = doctorById(r.doctorId);
    var nameSpec = d ? { raw: d.name } : "account.reviews.gone";
    var li = elem("li", "acct-review");
    li.setAttribute("data-review-id", String(r.id));
    var name = elem("p", "acct-review-doc");
    setText(name, nameSpec);
    li.appendChild(name);
    if (d) {
      var meta = elem("p", "acct-review-meta");
      setText(meta, { fn: function () { return [L.specialty(d.specialty), hospitalName(d.hospital)].filter(Boolean).join(" · "); } });
      li.appendChild(meta);
    }
    var head = elem("div", "acct-review-head");
    var n = Math.max(1, Math.min(5, Math.round(Number(r.stars) || 0)));
    var stars = elem("span", "acct-review-stars");
    stars.setAttribute("role", "img");
    setAttr(stars, "aria-label", { k: "account.reviews.stars", v: { n: { raw: String(n) } } });
    stars.textContent = starText(n);
    head.appendChild(stars);
    if (r.createdAt) {
      var date = elem("span", "acct-review-date");
      setText(date, { fn: function () { return formatDate(r.createdAt); } });
      head.appendChild(date);
    }
    li.appendChild(head);
    if (r.comment) {
      var c = elem("p", "acct-review-comment");
      c.textContent = String(r.comment);
      li.appendChild(c);
    }
    var actions = elem("div", "acct-review-actions");
    if (d) {
      var a = elem("a", "acct-btn acct-btn-ghost acct-btn-small");
      a.href = "doctors.html?doctor=" + encodeURIComponent(String(d.id));
      setText(a, "account.reviews.view");
      setAttr(a, "aria-label", { k: "account.reviews.viewAria", v: { name: nameSpec } });
      actions.appendChild(a);
    }
    var del = elem("button", "acct-btn acct-btn-danger acct-btn-small acct-review-del");
    del.type = "button";
    setText(del, "account.reviews.delete");
    setAttr(del, "aria-label", { k: "account.reviews.deleteAria", v: { name: nameSpec } });
    del.setAttribute("aria-haspopup", "dialog");
    del.addEventListener("click", function () { deleteReview(r, nameSpec, del, li); });
    actions.appendChild(del);
    li.appendChild(actions);
    return li;
  }

  function renderReviews(list) {
    var ul = $("my-reviews-list");
    ul.replaceChildren();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id != null) ul.appendChild(buildReviewItem(list[i]));
    }
    reviewsView(ul.children.length ? "my-reviews-list" : "my-reviews-empty");
  }

  function loadReviews() {
    var seq = ++reviewsSeq;
    if (!API || typeof API.request !== "function") { setText($("my-reviews-error-text"), "account.reviews.loadErr"); reviewsView("my-reviews-error"); return; }
    reviewsView("my-reviews-loading");
    API.request("GET", "/api/reviews/mine", null, function (err, data) {
      if (seq !== reviewsSeq) return;
      if (err) {
        setText($("my-reviews-error-text"), err.status === 0 ? friendly(err) : "account.reviews.loadErr");
        reviewsView("my-reviews-error");
        return;
      }
      renderReviews(data && Array.isArray(data.reviews) ? data.reviews : []);
    });
  }

  /** Native <dialog> confirm: Cancel focused, Esc cancels, focus returns to the opener. cb(ok). */
  function confirmReviewDelete(nameSpec, trigger, cb) {
    var dlg = $("review-confirm");
    var opener = trigger || document.activeElement;
    if (!dlg || typeof dlg.showModal !== "function") {
      cb(window.confirm(L.t("account.reviews.confirmTitle")));
      return;
    }
    setText($("review-confirm-text"), { k: "account.reviews.confirmText", v: { name: nameSpec } });
    dlg.returnValue = "";
    function onClose() {
      dlg.removeEventListener("close", onClose);
      if (opener && opener.focus && document.contains(opener)) opener.focus();
      cb(dlg.returnValue === "ok");
    }
    dlg.addEventListener("close", onClose);
    dlg.showModal();
    $("review-confirm-cancel").focus();
  }

  function deleteReview(r, nameSpec, btn, li) {
    confirmReviewDelete(nameSpec, btn, function (ok) {
      if (!ok) return;
      btn.disabled = true;
      API.request("DELETE", "/api/reviews/" + encodeURIComponent(String(r.id)), null, function (err) {
        if (err && err.status !== 404) {
          btn.disabled = false;
          if (err.status === 401) { load(); return; }
          reviewsAnnounce(err.status === 0 ? friendly(err) : "account.reviews.deleteErr");
          btn.focus();
          return;
        }
        // 204, or 404 (already gone): remove the row either way.
        var ul = $("my-reviews-list");
        var items = Array.prototype.slice.call(ul.children);
        var idx = items.indexOf(li);
        li.remove();
        reviewsAnnounce("account.reviews.deleted");
        var rest = ul.children;
        if (!rest.length) { reviewsView("my-reviews-empty"); $("my-reviews-title").focus(); return; }
        var target = rest[Math.min(Math.max(idx, 0), rest.length - 1)].querySelector(".acct-review-del");
        (target || $("my-reviews-title")).focus();
      });
    });
  }
  $("my-reviews-retry").addEventListener("click", loadReviews);

  function load() {
    if (!API || !API.isOnline()) { view("acct-offline"); return; }
    // Wait for the one-per-page backend probe; static hosting gets the browse-only notice.
    if (typeof API.mode === "function" && API.mode() === "pending") { view("acct-loading"); API.ready(load); return; }
    if (typeof API.isStatic === "function" && API.isStatic()) { view("acct-static"); return; }
    view("acct-loading");
    API.me(function (err, data) {
      if (err) {
        setText($("acct-error-text"), friendly(err));
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
      var known = { premium: 1, cloud: 1, doctors: 1, index: 1 };
      setText(note, { k: "account.next.note", v: { page: known[page] ? "account.next." + page : { raw: page } } });
      show(note, true);
    }
    selectTab(location.hash === "#signup" ? "signup" : "login", false);
    view("acct-auth");
  }

  /* ---------- password toggles ---------- */
  var toggles = document.querySelectorAll(".acct-pass-toggle");
  function paintToggle(btn, visible) {
    setText(btn, visible ? "account.hide" : "account.show");
    btn.setAttribute("aria-pressed", visible ? "true" : "false");
    setAttr(btn, "aria-label", visible ? "account.hidePassword" : "account.showPassword");
  }
  for (var ti = 0; ti < toggles.length; ti++) {
    paintToggle(toggles[ti], false);
    toggles[ti].addEventListener("click", function () {
      var input = $(this.getAttribute("data-target"));
      var showing = input.type === "text";
      input.type = showing ? "password" : "text";
      paintToggle(this, !showing);
    });
  }

  /* ---------- live password hint ---------- */
  var sPass = $("signup-password");
  var hint = $("signup-password-hint");
  var hintText = $("signup-password-hint-text");
  function updateHint() {
    var len = sPass.value.length;
    if (!len) { hint.setAttribute("data-state", "idle"); setText(hintText, "account.hint.idle"); return; }
    if (len >= 8) { hint.setAttribute("data-state", "ok"); setText(hintText, "account.hint.ok"); }
    else { hint.setAttribute("data-state", "bad"); setText(hintText, { k: "account.hint.bad", v: { n: { raw: String(8 - len) } } }); }
  }
  updateHint();
  sPass.addEventListener("input", function () { updateHint(); if (sPass.value.length >= 8) setFieldError(sPass, ""); });

  var sId = $("signup-identifier");
  sId.addEventListener("blur", function () { if (sId.value.trim()) setFieldError(sId, identifierHint(sId.value)); });
  sId.addEventListener("input", function () { if (sId.getAttribute("aria-invalid") && !identifierHint(sId.value)) setFieldError(sId, ""); });

  /* ---------- submit helpers ---------- */
  // label = a message spec; the idle label comes back from the button's data-i18n key.
  function busy(btn, on, label) {
    btn.disabled = on;
    if (on) { setText(btn, label); return; }
    delete btn.__mxText;
    var key = btn.getAttribute("data-i18n");
    if (key) btn.textContent = L.t(key);
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
    if (!idEl.value.trim()) { setFieldError(idEl, "account.val.loginId"); ok = false; }
    if (!pwEl.value) { setFieldError(pwEl, "account.val.loginPw"); ok = false; }
    if (!ok) { (idEl.value.trim() ? pwEl : idEl).focus(); return; }
    var btn = $("login-submit");
    busy(btn, true, "account.login.busy");
    API.login(idEl.value.trim(), pwEl.value, function (err, data) {
      busy(btn, false);
      if (err) {
        applyServerError(err, form, { identifier: idEl, password: pwEl }, errEl);
        if (!err.field) pwEl.focus();
        return;
      }
      pwEl.value = "";
      if (data && data.user) afterAuth(data.user, "account.status.signedIn");
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
    if (pwEl.value.length < 8) { setFieldError(pwEl, "account.val.pwShort"); first = first || pwEl; updateHint(); }
    if (first) { first.focus(); return; }
    var btn = $("signup-submit");
    busy(btn, true, "account.signup.busy");
    var ident = idEl.value.trim();
    if (ident.indexOf("@") === -1) ident = normPhone(ident);
    API.signup(ident, pwEl.value, nameEl.value.trim(), function (err, data) {
      busy(btn, false);
      if (err) {
        if (err.status === 409 && !err.field) err.field = "identifier";
        if (err.status === 409 && (/^Request failed/.test(err.error) || err.error === "Account already exists")) err.error = "Account already exists";
        applyServerError(err, form, { identifier: idEl, password: pwEl, displayName: nameEl }, errEl);
        return;
      }
      pwEl.value = "";
      updateHint();
      if (data && data.user) afterAuth(data.user, "account.status.welcome");
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
    busy(btn, true, "account.logout.busy");
    API.logout(function (err) {
      busy(btn, false);
      if (err && err.status !== 401) {
        var st = $("acct-status");
        setText(st, { k: "account.logout.failed", v: { error: friendly(err) } });
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

  // A language change re-resolves every message set above (L.setText); only the page title needs nothing more.
  L.onLang(function () {});

  // Exposed for tests only (no auth data).
  window.MedIndexAccount = { safeNext: safeNext, isPhone: isPhone, identifierHint: identifierHint };

  load();
})();
