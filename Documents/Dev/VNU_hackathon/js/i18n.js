/* MedIndex – translation core. Load FIRST (no dependencies).
   window.MedIndexI18n = {
     getLang(), setLang(code), t(key, vars), register(lang, dict), apply(root),
     onChange(cb), formatDate(isoOrDate, opts), formatNumber(n), locale(), has(key)
   }
   Markup: data-i18n="key" sets textContent; data-i18n-attr="placeholder:key;aria-label:key"
   sets those attributes. Never uses innerHTML. Fires "medindex:lang" on document. */
(function () {
  "use strict";
  if (window.MedIndexI18n) return;

  var STORE_KEY = "medindex.lang";
  var LANGS = { en: "en-GB", ro: "ro-RO" };
  var ATTRS = { placeholder: 1, "aria-label": 1, title: 1, alt: 1, content: 1, "aria-description": 1, "data-label": 1 };
  var dicts = { en: {}, ro: {} };
  var listeners = [];
  var lang = "en";

  function norm(code) {
    code = String(code || "").toLowerCase().slice(0, 2);
    return LANGS.hasOwnProperty(code) ? code : null;
  }

  try { lang = norm(window.localStorage.getItem(STORE_KEY)) || "en"; } catch (e) { lang = "en"; }
  try { document.documentElement.lang = lang; } catch (e) { /* ignore */ }

  function lookup(l, key) {
    var d = dicts[l];
    return d && Object.prototype.hasOwnProperty.call(d, key) ? d[key] : null;
  }

  function t(key, vars) {
    key = String(key);
    var s = lookup(lang, key);
    if (s == null) s = lookup("en", key);
    if (s == null) s = key;
    s = String(s);
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, name) {
        return Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null ? String(vars[name]) : m;
      });
    }
    return s;
  }

  function has(key) { return lookup(lang, key) != null || lookup("en", key) != null; }

  function domReady() { return document.readyState !== "loading"; }

  function apply(root) {
    root = root || document;
    if (!root.querySelectorAll) return;
    var nodes = root.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute("data-i18n");
      if (k) {
        var v = t(k);
        if (nodes[i].textContent !== v) nodes[i].textContent = v;
      }
    }
    var withAttr = root.querySelectorAll("[data-i18n-attr]");
    for (var j = 0; j < withAttr.length; j++) {
      var pairs = String(withAttr[j].getAttribute("data-i18n-attr")).split(";");
      for (var p = 0; p < pairs.length; p++) {
        var idx = pairs[p].indexOf(":");
        if (idx < 1) continue;
        var attr = pairs[p].slice(0, idx).trim().toLowerCase();
        var key = pairs[p].slice(idx + 1).trim();
        if (!key || !ATTRS[attr]) continue;
        withAttr[j].setAttribute(attr, t(key));
      }
    }
    if (root === document) {
      var title = document.querySelector("title[data-i18n]");
      if (title) document.title = t(title.getAttribute("data-i18n"));
    }
  }

  function register(l, dict) {
    l = norm(l);
    if (!l || !dict || typeof dict !== "object") return;
    var d = dicts[l];
    for (var k in dict) {
      if (Object.prototype.hasOwnProperty.call(dict, k) && dict[k] != null) d[k] = String(dict[k]);
    }
    if (domReady()) apply(document);
  }

  function emit() {
    var detail = { lang: lang };
    var ev;
    try { ev = new CustomEvent("medindex:lang", { detail: detail }); }
    catch (e) { ev = document.createEvent("CustomEvent"); ev.initCustomEvent("medindex:lang", false, false, detail); }
    document.dispatchEvent(ev);
  }

  function setLang(code) {
    var l = norm(code);
    if (!l) return;
    lang = l;
    try { window.localStorage.setItem(STORE_KEY, l); } catch (e) { /* private mode */ }
    document.documentElement.lang = l;
    apply(document);
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](l); } catch (e) { if (window.console) console.error(e); }
    }
    emit();
  }

  function onChange(cb) {
    if (typeof cb !== "function") return function () {};
    listeners.push(cb);
    return function () {
      var i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  var MONTHS = {
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    ro: ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"]
  };

  function toDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
    var d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDate(v, opts) {
    var d = toDate(v);
    if (!d) return "";
    try {
      return d.toLocaleDateString(LANGS[lang], opts || { day: "numeric", month: "long", year: "numeric" });
    } catch (e) {
      return d.getDate() + " " + MONTHS[lang][d.getMonth()] + " " + d.getFullYear();
    }
  }

  function formatNumber(n, opts) {
    var x = Number(n);
    if (!isFinite(x)) return String(n);
    try { return x.toLocaleString(LANGS[lang], opts); }
    catch (e) { return lang === "ro" ? String(x).replace(".", ",") : String(x); }
  }

  window.MedIndexI18n = {
    getLang: function () { return lang; },
    setLang: setLang,
    t: t,
    has: has,
    register: register,
    apply: apply,
    onChange: onChange,
    formatDate: formatDate,
    formatNumber: formatNumber,
    locale: function () { return LANGS[lang]; }
  };

  if (domReady()) apply(document);
  else document.addEventListener("DOMContentLoaded", function () { apply(document); });
})();
