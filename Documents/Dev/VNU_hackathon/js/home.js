/* MedIndex – homepage. Fills the live stats and the example listing from
   window.DOCTORS (data/doctors.js). Real numbers only: if the data is missing
   the sections stay hidden. All text via textContent. */
(function () {
  "use strict";

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var I = window.MedIndexI18n || null;
  function T(k, v) { return I ? I.t(k, v) : k; }
  function num(n, o) { return I ? I.formatNumber(n, o) : String(n); }

  function $(id) { return document.getElementById(id); }
  function set(id, text) { var n = $(id); if (n) n.textContent = text; }

  function yearlySavePct() {
    // 1 - 65.99 / (5.99 * 12), shown with one decimal.
    return Math.round((1 - 65.99 / (5.99 * 12)) * 1000) / 10;
  }

  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return "";
    if (I) return I.formatDate(iso);
    return (+m[3]) + " " + MONTHS[+m[2] - 1] + " " + m[1];
  }

  function initials(name) {
    var parts = String(name || "").replace(/^(dr|prof|conf)\.?\s+/i, "").split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "")).toUpperCase();
  }

  function stats(list) {
    var networks = {}, specs = {}, prices = [], latest = "";
    list.forEach(function (d) {
      if (d.hospital) networks[d.hospital] = 1;
      if (d.specialty) specs[d.specialty] = 1;
      if (typeof d.priceRON === "number" && isFinite(d.priceRON) && d.priceRON > 0) prices.push(d.priceRON);
      if (typeof d.scrapedAt === "string" && d.scrapedAt > latest) latest = d.scrapedAt;
    });
    set("st-doctors", num(list.length));
    set("st-networks", num(Object.keys(networks).length));
    set("st-specialties", num(Object.keys(specs).length));
    if (prices.length) {
      var min = Math.min.apply(null, prices), max = Math.max.apply(null, prices);
      set("st-prices", num(min) + "–" + num(max) + " RON");
    } else {
      set("st-prices", "—");
    }
    var names = Object.keys(networks).sort().join(", ");
    var src = T("home.stats.source", { names: names ? " (" + names + ")" : "" });
    if (latest) src += " " + T("home.stats.collected", { date: fmtDate(latest) });
    if (prices.length !== list.length) src += " " + T("home.stats.withPrice", { n: num(prices.length), total: num(list.length) });
    set("st-source", src);
    $("stats").hidden = false;
  }

  function preview(list) {
    var d = null;
    for (var i = 0; i < list.length && !d; i++) {
      var x = list[i];
      if (x.acceptsCNAS === true && typeof x.priceRON === "number" && x.name && x.specialty && x.clinicName) d = x;
    }
    if (!d) {
      for (var j = 0; j < list.length && !d; j++) {
        if (typeof list[j].priceRON === "number" && list[j].name) d = list[j];
      }
    }
    if (!d) return;
    set("pv-initials", initials(d.name));
    set("pv-name", d.name);
    var rank = d.medicalRank && I && I.has("home.rank." + d.medicalRank) ? T("home.rank." + d.medicalRank) : d.medicalRank;
    var spec = d.specialty && I && I.has("spec." + d.specialty) ? T("spec." + d.specialty) : d.specialty;
    set("pv-spec", [spec, rank].filter(Boolean).join(" · "));
    set("pv-network", d.hospital || "—");
    set("pv-clinic", d.clinicName || d.area || "—");
    set("pv-cnas", d.acceptsCNAS === true ? T("home.preview.accepted") : d.acceptsCNAS === false ? T("home.preview.notAccepted") : T("common.unknown"));
    set("pv-price", num(d.priceRON) + " RON");
    $("hero-preview").hidden = false;
  }

  function init() {
    set("tp-save", T("plans.save", { pct: num(yearlySavePct()) }));
    var list = Array.isArray(window.DOCTORS) ? window.DOCTORS : null;
    if (!list || !list.length) return;
    stats(list);
    preview(list);
  }

  if (I) I.onChange(init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
