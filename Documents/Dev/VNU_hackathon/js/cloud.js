/* MedIndex Secure Medical Cloud (Premium).
 * Files are simulated: only name, type, size are read from a picked/dropped file and sent as metadata.
 * The file contents are never read and never sent. */
(function () {
  "use strict";

  var API = window.MedIndexAPI;
  var L = window.MedIndexAccountI18n;
  var t = L.t, plural = L.plural, setText = L.setText, setAttr = L.setAttr, resolve = L.resolve;
  var FAV_ID = "fav";
  var SVGNS = "http://www.w3.org/2000/svg";

  function $(id) { return document.getElementById(id); }
  function show(el, on) { if (el) el.hidden = !on; }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  /* ---------- state ---------- */
  var state = {
    data: null,          // last GET /api/cloud
    folderId: null,      // current folder id
    chatId: null,        // open chat (reader)
    sort: "date",
    view: "grid",
    uploading: false,
    favs: null,          // [doctorId] from GET /api/favorites (null = not loaded)
    favError: null,      // message spec when loading favourites failed
    lastChat: null       // last rendered chat (re-rendered on a language change)
  };

  // View/sort are per-viewer conveniences only (no auth data).
  function prefGet(k) { try { return window.localStorage.getItem("medindex.cloud." + k); } catch (e) { return null; } }
  function prefSet(k, v) { try { window.localStorage.setItem("medindex.cloud." + k, v); } catch (e) { /* ignore */ } }
  (function () {
    var v = prefGet("view"); if (v === "grid" || v === "list") state.view = v;
    var s = prefGet("sort"); if (s === "date" || s === "name" || s === "size") state.sort = s;
  })();

  /* ---------- formatting ---------- */
  function formatBytes(n) { return L.formatBytes(n); }

  function toDate(v) {
    if (v === null || v === undefined || v === "") return null;
    var d;
    if (typeof v === "number") d = new Date(v < 1e12 ? v * 1000 : v);
    else if (/^\d+(\.\d+)?$/.test(String(v))) { var num = Number(v); d = new Date(num < 1e12 ? num * 1000 : num); }
    else {
      var s = String(v);
      // SQLite "YYYY-MM-DD HH:MM:SS" is UTC.
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) s = s.replace(" ", "T") + "Z";
      d = new Date(s);
    }
    return isNaN(d.getTime()) ? null : d;
  }
  function formatDate(v) {
    var d = toDate(v);
    if (!d) return "";
    return L.formatDate(d, { day: "numeric", month: "long", year: "numeric" });
  }
  function formatDateTime(v) {
    var d = toDate(v);
    if (!d) return "";
    return L.formatDate(d, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function timeOf(v) { var d = toDate(v); return d ? d.getTime() : 0; }

  /* ---------- icons (built with DOM APIs, never from data) ---------- */
  function svg(paths, size) {
    var s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("width", size || 24);
    s.setAttribute("height", size || 24);
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("focusable", "false");
    paths.forEach(function (p) {
      var n = document.createElementNS(SVGNS, p[0]);
      for (var k in p[1]) if (Object.prototype.hasOwnProperty.call(p[1], k)) n.setAttribute(k, p[1][k]);
      s.appendChild(n);
    });
    return s;
  }
  var STROKE = { fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linejoin": "round", "stroke-linecap": "round" };
  function mix(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  var ICONS = {
    folder: [["path", mix(STROKE, { d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" })]],
    chat: [["path", mix(STROKE, { d: "M4 5h16v11H9l-5 4z" })], ["path", mix(STROKE, { d: "M8 9h8M8 12h5" })]],
    pdf: [["path", mix(STROKE, { d: "M6 3h8l4 4v14H6z" })], ["path", mix(STROKE, { d: "M14 3v4h4" })], ["path", mix(STROKE, { d: "M9 13h6M9 16h6" })]],
    image: [["rect", mix(STROKE, { x: "3", y: "5", width: "18", height: "14", rx: "2" })], ["circle", mix(STROKE, { cx: "9", cy: "10", r: "1.6" })], ["path", mix(STROKE, { d: "M21 16l-5-5-8 8" })]],
    doc: [["path", mix(STROKE, { d: "M6 3h8l4 4v14H6z" })], ["path", mix(STROKE, { d: "M14 3v4h4M9 11h6M9 14h6M9 17h4" })]],
    sheet: [["rect", mix(STROKE, { x: "4", y: "4", width: "16", height: "16", rx: "2" })], ["path", mix(STROKE, { d: "M4 10h16M4 15h16M10 4v16" })]],
    video: [["rect", mix(STROKE, { x: "3", y: "6", width: "13", height: "12", rx: "2" })], ["path", mix(STROKE, { d: "M16 10l5-3v10l-5-3z" })]],
    audio: [["path", mix(STROKE, { d: "M9 18V6l10-2v12" })], ["circle", mix(STROKE, { cx: "7", cy: "18", r: "2" })], ["circle", mix(STROKE, { cx: "17", cy: "16", r: "2" })]],
    archive: [["rect", mix(STROKE, { x: "4", y: "3", width: "16", height: "18", rx: "2" })], ["path", mix(STROKE, { d: "M12 3v2m0 2v2m0 2v2m-1 2h2v3h-2z" })]],
    file: [["path", mix(STROKE, { d: "M6 3h8l4 4v14H6z" })], ["path", mix(STROKE, { d: "M14 3v4h4" })]],
    trash: [["path", mix(STROKE, { d: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" })]],
    heart: [["path", mix(STROKE, { d: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" })]]
  };
  function icon(name, size) { return svg(ICONS[name] || ICONS.file, size); }

  function fileKind(name, type) {
    var t = String(type || "").toLowerCase(); // shadows the translator only inside fileKind
    var ext = (String(name || "").split(".").pop() || "").toLowerCase();
    var ty = t;
    if (ty === "application/pdf" || ext === "pdf") return { icon: "pdf", label: L.t("cloud.kind.pdf") };
    if (ty.indexOf("image/") === 0 || /^(png|jpe?g|gif|webp|heic|bmp|tiff?|svg|dcm)$/.test(ext)) return { icon: "image", label: L.t(ext === "dcm" ? "cloud.kind.dicom" : "cloud.kind.image") };
    if (ty.indexOf("video/") === 0 || /^(mp4|mov|webm|avi|mkv)$/.test(ext)) return { icon: "video", label: L.t("cloud.kind.video") };
    if (ty.indexOf("audio/") === 0 || /^(mp3|wav|m4a|ogg)$/.test(ext)) return { icon: "audio", label: L.t("cloud.kind.audio") };
    if (/sheet|excel|csv/.test(ty) || /^(xlsx?|csv|ods)$/.test(ext)) return { icon: "sheet", label: L.t("cloud.kind.sheet") };
    if (/word|document|text|rtf/.test(ty) || /^(docx?|odt|txt|rtf|md)$/.test(ext)) return { icon: "doc", label: L.t("cloud.kind.doc") };
    if (/zip|compressed|tar|rar|7z/.test(ty) || /^(zip|rar|7z|gz|tar)$/.test(ext)) return { icon: "archive", label: L.t("cloud.kind.archive") };
    return { icon: "file", label: ext && ext.length <= 5 && ext !== String(name).toLowerCase() ? L.t("cloud.kind.ext", { ext: ext.toUpperCase() }) : L.t("cloud.kind.file") };
  }

  /* ---------- status messages ---------- */
  var statusTimer = null;
  function status(msg, kind) {
    var s = $("cl-status");
    setText(s, msg || "");
    s.className = "cl-status" + (kind ? " cl-status-" + kind : "");
    clearTimeout(statusTimer);
    if (msg && kind !== "error") statusTimer = setTimeout(function () { setText(s, ""); s.className = "cl-status"; }, 6000);
  }

  // A message spec (translated key, or {raw} for an unknown server message).
  function friendly(err) {
    if (!err) return "";
    if (err.status === 0) {
      if (err.error === "timeout") return "account.err.timeout";
      return "account.err.unreachable";
    }
    if (err.status === 413) return "cloud.err.storageFull";
    var known = L.errorKey(err.error);
    if (known) return known;
    if (!err.error || /^Request failed/.test(err.error)) return "cloud.err.generic";
    return { raw: err.error };
  }

  /* ---------- gate ---------- */
  var gates = ["cl-loading", "cl-offline", "cl-static", "cl-error", "cl-signin", "cl-upsell", "cl-app"];
  function gate(id) { for (var i = 0; i < gates.length; i++) show($(gates[i]), gates[i] === id); }

  function handleGateError(err) {
    if (err.status === 401) { gate("cl-signin"); return; }
    if (err.status === 403) { gate("cl-upsell"); return; }
    setText($("cl-error-text"), friendly(err));
    gate("cl-error");
  }

  /* ---------- data ---------- */
  function folders() {
    var list = (state.data && state.data.folders) || [];
    return list.slice().sort(function (a, b) {
      if (!!a.system !== !!b.system) return a.system ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
    });
  }
  // The virtual "Favourite Doctors" folder (not stored as a cloud folder).
  var FAV_FOLDER = { id: FAV_ID, fav: true, name: "" };
  function isFav(f) { return !!(f && f.fav); }
  function folderLabel(f) {
    if (!f) return t("cloud.folder.none");
    if (f.fav) return t("fav.folder");
    if (f.system && f.name === "ChatBot History") return t("cloud.folder.chats");
    return f.name;
  }
  function findFolder(id) {
    if (String(id) === FAV_ID) return FAV_FOLDER;
    var fs = folders();
    for (var i = 0; i < fs.length; i++) if (String(fs[i].id) === String(id)) return fs[i];
    return null;
  }
  function isChatFolder(f) { return !!(f && f.system); }

  function loadFavs(cb) {
    API.request("GET", "/api/favorites", null, function (err, data) {
      if (err) {
        if (err.status === 401 || err.status === 403) { handleGateError(err); if (cb) cb(err); return; }
        state.favs = null;
        state.favError = friendly(err);
      } else {
        state.favError = null;
        state.favs = data && Array.isArray(data.doctorIds) ? data.doctorIds.slice() : [];
      }
      if (cb) cb(null);
    });
  }

  function load(cb) {
    var pending = 2, cloudErr = null, cloudData = null, favErr = null;
    API.cloud.get(function (err, data) { cloudErr = err; cloudData = data; if (!--pending) done(); });
    loadFavs(function (err) { favErr = err; if (!--pending) done(); });
    function done() { loaded(cloudErr || (favErr && favErr.status ? favErr : null), cloudData); }
    function loaded(err, data) {
      if (err) { handleGateError(err); if (cb) cb(err); return; }
      state.data = data || {};
      if (!state.data.folders) state.data.folders = [];
      if (!state.data.files) state.data.files = [];
      if (!state.data.chats) state.data.chats = [];
      if (!findFolder(state.folderId)) state.folderId = folders().length ? folders()[0].id : null;
      gate("cl-app");
      render();
      if (cb) cb(null);
    }
  }

  /* ---------- hash routing (#f=<id> / #chat=<id>) ---------- */
  function readHash() {
    var h = location.hash.replace(/^#/, "");
    var m;
    if ((m = /^chat=([\w-]{1,64})$/.exec(h))) return { chat: m[1] };
    if ((m = /^f=([\w-]{1,64})$/.exec(h))) return { folder: m[1] };
    return {};
  }
  function writeHash() {
    var h = state.chatId ? "#chat=" + state.chatId : (state.folderId !== null ? "#f=" + state.folderId : "");
    if (location.hash !== h) {
      try { history.replaceState(null, "", location.pathname + location.search + h); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- rendering ---------- */
  function render() {
    renderFolders();
    renderMeter();
    if (state.chatId) { show($("cl-folder-view"), false); show($("cl-reader"), true); }
    else { show($("cl-reader"), false); show($("cl-folder-view"), true); renderItems(); }
    writeHash();
  }

  function renderFolders() {
    var ul = $("cl-folders");
    ul.textContent = "";
    var files = state.data.files;
    // System folders (ChatBot History) first, then Favourite Doctors, then the user's folders.
    var list = folders();
    var nSys = list.filter(function (f) { return f.system; }).length;
    list.splice(nSys, 0, FAV_FOLDER);
    list.forEach(function (f) {
      var li = el("li");
      var b = el("button", "cl-folder" + (f.system ? " cl-folder-system" : "") + (f.fav ? " cl-folder-fav" : ""));
      b.type = "button";
      var current = String(f.id) === String(state.folderId);
      if (current) b.setAttribute("aria-current", "true");
      b.appendChild(icon(f.fav ? "heart" : f.system ? "chat" : "folder", 20));
      b.appendChild(el("span", "cl-folder-name", folderLabel(f)));
      var count = f.fav ? (state.favs ? state.favs.length : 0) : f.system ? state.data.chats.length : files.filter(function (x) { return String(x.folderId) === String(f.id); }).length;
      var c = el("span", "cl-folder-count", L.formatNumber(count));
      c.setAttribute("aria-label", plural("cloud.items", count));
      b.appendChild(c);
      b.addEventListener("click", function () {
        state.folderId = f.id;
        state.chatId = null;
        render();
        var t = $("cl-folder-title"); if (t) { t.setAttribute("tabindex", "-1"); t.focus(); }
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  function renderMeter() {
    var quota = Number(state.data.quotaBytes) || 5368709120;
    var used = Number(state.data.usedBytes) || 0;
    var pct = Math.min(100, Math.max(0, used / quota * 100));
    var fill = $("cl-meter-fill");
    fill.style.width = (used > 0 ? Math.max(pct, 1) : 0) + "%";
    fill.className = "cl-meter-fill" + (pct >= 90 ? " cl-meter-full" : pct >= 75 ? " cl-meter-warn" : "");
    $("cl-meter-text").textContent = t(pct >= 90 ? "cloud.meter.full" : "cloud.meter", { used: formatBytes(used), total: formatBytes(quota) });
  }

  function currentItems() {
    var f = findFolder(state.folderId);
    if (!f) return [];
    var items;
    if (isChatFolder(f)) {
      items = state.data.chats.map(function (c) {
        return { kind: "chat", id: c.id, name: c.title || t("cloud.untitledChat"), size: c.size || 0, date: c.updatedAt || c.createdAt };
      });
    } else {
      items = state.data.files.filter(function (x) { return String(x.folderId) === String(f.id); }).map(function (x) {
        return { kind: "file", id: x.id, name: x.name, type: x.type, size: x.size || 0, date: x.createdAt };
      });
    }
    items.sort(function (a, b) {
      if (state.sort === "name") return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base", numeric: true });
      if (state.sort === "size") return (b.size - a.size) || String(a.name).localeCompare(String(b.name));
      return timeOf(b.date) - timeOf(a.date);
    });
    return items;
  }

  function renderItems() {
    var f = findFolder(state.folderId);
    var chatFolder = isChatFolder(f);
    var fav = isFav(f);
    $("cl-folder-title").textContent = folderLabel(f);
    show($("cl-upload-btn"), !!f && !chatFolder && !fav);
    show($("cl-drop"), !!f && !chatFolder && !fav);
    show($("cl-new-chat"), chatFolder);
    show($("cl-delete-folder"), !!f && !f.system && !fav);
    show(document.querySelector(".cl-sort"), !fav);
    show(document.querySelector(".cl-viewtoggle"), !fav);
    show($("cl-fav-note"), fav);
    show($("cl-empty-action"), false);
    show($("cl-fav-retry"), false);
    if (fav) { show($("cl-items"), false); renderFavs(); return; }
    show($("cl-favs"), false);
    $("cl-sort").value = state.sort;
    $("cl-view-grid").setAttribute("aria-pressed", state.view === "grid" ? "true" : "false");
    $("cl-view-list").setAttribute("aria-pressed", state.view === "list" ? "true" : "false");

    var items = currentItems();
    var ul = $("cl-items");
    ul.className = "cl-items " + (state.view === "list" ? "cl-list" : "cl-grid");
    ul.textContent = "";
    $("cl-count").textContent = plural(chatFolder ? "cloud.count.chats" : "cloud.count.files", items.length);

    items.forEach(function (it) { ul.appendChild(renderItem(it)); });

    show(ul, items.length > 0);
    show($("cl-empty"), items.length === 0);
    if (!items.length) {
      var base = !f ? "cloud.empty.noFolders" : chatFolder ? "cloud.empty.chats" : "cloud.empty.folder";
      $("cl-empty-title").textContent = t(base + ".title");
      $("cl-empty-text").textContent = t(base + ".text");
    }
  }

  function renderItem(it) {
    var li = el("li", "cl-item cl-item-" + it.kind);
    var kind = it.kind === "chat" ? { icon: "chat", label: t("cloud.kind.chat") } : fileKind(it.name, it.type);
    var main;
    if (it.kind === "chat") {
      main = el("button", "cl-item-main");
      main.type = "button";
      main.addEventListener("click", function () { openChat(it.id); });
    } else {
      main = el("div", "cl-item-main");
    }
    var ic = el("span", "cl-item-icon cl-ic-" + kind.icon);
    ic.appendChild(icon(kind.icon, 26));
    main.appendChild(ic);
    var text = el("span", "cl-item-text");
    text.appendChild(el("span", "cl-item-name", it.name));
    var meta = el("span", "cl-item-meta");
    meta.appendChild(el("span", "cl-item-type", kind.label));
    if (it.kind === "file" || it.size) meta.appendChild(el("span", "cl-item-size", formatBytes(it.size)));
    var d = formatDate(it.date);
    if (d) meta.appendChild(el("span", "cl-item-date", d));
    text.appendChild(meta);
    main.appendChild(text);
    li.appendChild(main);

    var del = el("button", "cl-icon-btn cl-item-del");
    del.type = "button";
    del.setAttribute("aria-label", t("cloud.deleteItem", { name: it.name }));
    del.title = t("cloud.delete");
    del.appendChild(icon("trash", 20));
    del.addEventListener("click", function () {
      var idx = Array.prototype.indexOf.call(li.parentNode ? li.parentNode.children : [], li);
      if (it.kind === "chat") deleteChat(it.id, it.name, del, idx);
      else deleteFile(it, del, idx);
    });
    li.appendChild(del);
    return li;
  }

  /* ---------- confirm dialog ---------- */
  function confirmDialog(title, text, okLabel, cb) {
    var dlg = $("cl-confirm");
    var opener = document.activeElement;
    if (!dlg || typeof dlg.showModal !== "function") {
      cb(window.confirm(resolve(title) + "\n\n" + resolve(text)));
      return;
    }
    setText($("cl-confirm-title"), title);
    setText($("cl-confirm-text"), text);
    setText($("cl-confirm-ok"), okLabel || "cloud.delete");
    dlg.returnValue = "";
    function onClose() {
      dlg.removeEventListener("close", onClose);
      var ok = dlg.returnValue === "ok";
      if (opener && opener.focus && document.contains(opener)) opener.focus();
      cb(ok);
    }
    dlg.addEventListener("close", onClose);
    dlg.showModal();
    $("cl-confirm-cancel").focus();
  }

  /* ---------- actions ---------- */
  function deleteFile(it, btn, idx) {
    confirmDialog("cloud.confirm.file.title", { k: "cloud.confirm.file.text", v: { name: { raw: it.name } } }, "cloud.confirm.file.ok", function (ok) {
      if (!ok) return;
      btn.disabled = true;
      API.cloud.deleteFile(it.id, function (err) {
        if (err && err.status !== 404) { btn.disabled = false; if (err.status === 401 || err.status === 403) return handleGateError(err); status(friendly(err), "error"); return; }
        load(function (e) { if (!e) { status({ k: "cloud.status.fileDeleted", v: { name: { raw: it.name } } }); focusAfterDelete(idx); } });
      });
    });
  }

  // After a delete, focus the item now at the same position (or the previous one);
  // with an empty list, the folder's main action (Upload / New chat) or its heading.
  function focusAfterDelete(idx) {
    var items = $("cl-items").children;
    if (items.length && !$("cl-items").hidden) {
      var i = Math.min(Math.max(Number(idx) || 0, 0), items.length - 1);
      var target = items[i].querySelector("button.cl-item-main") || items[i].querySelector(".cl-item-del");
      if (target) { target.focus(); return; }
    }
    var action = !$("cl-upload-btn").hidden ? $("cl-upload-btn") : !$("cl-new-chat").hidden ? $("cl-new-chat") : null;
    (action || $("cl-folder-title")).focus();
  }

  function deleteChat(id, name, btn, idx) {
    confirmDialog("cloud.confirm.chat.title", { k: "cloud.confirm.chat.text", v: { name: { raw: name } } }, "cloud.confirm.chat.ok", function (ok) {
      if (!ok) return;
      if (btn) btn.disabled = true;
      API.chats.remove(id, function (err) {
        if (err && err.status !== 404) { if (btn) btn.disabled = false; if (err.status === 401 || err.status === 403) return handleGateError(err); status(friendly(err), "error"); return; }
        state.chatId = null;
        load(function (e) { if (!e) { status("cloud.status.chatDeleted"); focusAfterDelete(idx); } });
      });
    });
  }

  $("cl-delete-folder").addEventListener("click", function () {
    var f = findFolder(state.folderId);
    if (!f || f.system) return;
    var n = state.data.files.filter(function (x) { return String(x.folderId) === String(f.id); }).length;
    var text = n ? { k: "cloud.confirm.folder.text", plural: true, n: n, v: { name: { raw: f.name } } } : { k: "cloud.confirm.folder.empty", v: { name: { raw: f.name } } };
    var btn = this;
    confirmDialog("cloud.confirm.folder.title", text, "cloud.confirm.folder.ok", function (ok) {
      if (!ok) return;
      btn.disabled = true;
      API.cloud.deleteFolder(f.id, function (err) {
        btn.disabled = false;
        if (err && err.status !== 404) { if (err.status === 401 || err.status === 403) return handleGateError(err); status(friendly(err), "error"); return; }
        state.folderId = null;
        load(function (e) { if (!e) { status({ k: "cloud.status.folderDeleted", v: { name: { raw: f.name } } }); var cur = document.querySelector("#cl-folders [aria-current=true]"); (cur || $("cl-new-folder")).focus(); } });
      });
    });
  });

  /* New folder dialog */
  var folderDlg = $("cl-folder-dialog");
  var folderName = $("cl-folder-name");
  function setFolderError(msg) {
    setText($("cl-folder-name-error"), msg || "");
    if (msg) folderName.setAttribute("aria-invalid", "true"); else folderName.removeAttribute("aria-invalid");
  }
  $("cl-new-folder").addEventListener("click", function () {
    folderName.value = "";
    setFolderError("");
    if (typeof folderDlg.showModal === "function") { folderDlg.showModal(); folderName.focus(); }
    else {
      var n = window.prompt(t("cloud.folderDialog.label"));
      if (n) createFolder(n.trim(), function (msg) { if (msg) status(msg, "error"); });
    }
  });
  $("cl-folder-cancel").addEventListener("click", function () { folderDlg.close(); });
  folderDlg.addEventListener("close", function () { $("cl-new-folder").focus(); });
  $("cl-folder-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = folderName.value.trim();
    if (!name) { setFolderError("cloud.folderDialog.empty"); folderName.focus(); return; }
    var btn = $("cl-folder-create");
    btn.disabled = true;
    createFolder(name, function (msg) {
      btn.disabled = false;
      if (msg) { setFolderError(msg); folderName.focus(); return; }
      folderDlg.close();
    });
  });
  function createFolder(name, done) {
    API.cloud.createFolder(name, function (err, data) {
      if (err) { done(friendly(err)); return; }
      var newId = data && (data.id !== undefined ? data.id : data.folder && data.folder.id);
      if (newId !== undefined && newId !== null) state.folderId = newId;
      state.chatId = null;
      load(function () { status({ k: "cloud.status.folderCreated", v: { name: { raw: name } } }); });
      done(null);
    });
  }

  /* Sort + view */
  $("cl-sort").addEventListener("change", function () { state.sort = this.value; prefSet("sort", state.sort); renderItems(); });
  $("cl-view-grid").addEventListener("click", function () { state.view = "grid"; prefSet("view", "grid"); renderItems(); });
  $("cl-view-list").addEventListener("click", function () { state.view = "list"; prefSet("view", "list"); renderItems(); });

  /* ---------- upload (metadata only) ---------- */
  var fileInput = $("cl-file-input");
  $("cl-upload-btn").addEventListener("click", function () { fileInput.click(); });
  $("cl-drop-browse").addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () {
    var list = fileInput.files;
    uploadMeta(list);
    fileInput.value = "";
  });

  function uploadMeta(fileList) {
    var f = findFolder(state.folderId);
    if (!f || isChatFolder(f) || isFav(f) || !fileList || !fileList.length || state.uploading) return;
    // Read ONLY the metadata. File contents are never touched.
    var metas = [];
    for (var i = 0; i < fileList.length && i < 50; i++) {
      var file = fileList[i];
      metas.push({ name: String(file.name || "file").slice(0, 200), type: String(file.type || ""), size: Number(file.size) || 0 });
    }
    state.uploading = true;
    $("cl-upload-btn").disabled = true;
    var added = 0;
    status({ k: "cloud.status.saving", plural: true, n: metas.length });
    (function step(idx) {
      if (idx >= metas.length) return finish(null);
      var m = metas[idx];
      API.cloud.addFile(f.id, m.name, m.type, m.size, function (err) {
        if (err) return finish(err, m);
        added++;
        step(idx + 1);
      });
    })(0);
    function finish(err, m) {
      state.uploading = false;
      $("cl-upload-btn").disabled = false;
      if (err && (err.status === 401 || err.status === 403)) { handleGateError(err); return; }
      load(function () {
        var nm = { raw: m ? m.name : "" };
        var cnt = { fn: function () { return L.formatNumber(added); } };
        if (err && err.status === 413) {
          status({ k: added ? "cloud.status.storageFullAfter" : "cloud.status.storageFull", v: { name: nm, n: cnt, size: { fn: function () { return formatBytes(m.size); } } } }, "error");
        } else if (err) {
          status({ k: added ? "cloud.status.addFailedAfter" : "cloud.status.addFailed", v: { name: nm, n: cnt, error: friendly(err) } }, "error");
        } else {
          status(added === 1 ? { k: "cloud.status.addedOne", v: { name: { raw: metas[0].name } } } : { k: "cloud.status.addedMany", plural: true, n: added }, "ok");
        }
      });
    }
  }

  // Drag and drop
  var drop = $("cl-drop");
  var content = $("cl-content");
  var dragDepth = 0;
  function hasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    if (!t) return false;
    for (var i = 0; i < t.length; i++) if (t[i] === "Files") return true;
    return false;
  }
  function canDrop() { var f = findFolder(state.folderId); return !state.chatId && f && !isChatFolder(f) && !isFav(f); }
  content.addEventListener("dragenter", function (e) {
    if (!hasFiles(e) || !canDrop()) return;
    e.preventDefault(); dragDepth++; drop.classList.add("is-over");
  });
  content.addEventListener("dragover", function (e) {
    if (!hasFiles(e) || !canDrop()) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
  });
  content.addEventListener("dragleave", function () {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) drop.classList.remove("is-over");
  });
  content.addEventListener("drop", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0; drop.classList.remove("is-over");
    if (canDrop()) uploadMeta(e.dataTransfer.files);
  });
  // Never let a stray drop navigate the page to the file.
  window.addEventListener("dragover", function (e) { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", function (e) { if (hasFiles(e)) e.preventDefault(); });

  /* ---------- chat reader ---------- */
  function parseMeta(meta) {
    if (!meta) return {};
    if (typeof meta === "string") { try { meta = JSON.parse(meta); } catch (e) { return {}; } }
    return meta && typeof meta === "object" ? meta : {};
  }
  function isTrue(v) { return v === true || v === 1 || v === "true" || v === "yes" || v === "1"; }
  function specialtiesOf(meta) {
    var out = [];
    var src = meta.suggestions || meta.specialties || [];
    if (!Array.isArray(src)) return out;
    src.forEach(function (s) {
      var name = typeof s === "string" ? s : s && (s.specialty || s.name);
      if (name && out.indexOf(String(name)) === -1 && out.length < 6) out.push(String(name).slice(0, 80));
    });
    return out;
  }

  function openChat(id) {
    state.chatId = String(id);
    render();
    var thread = $("cl-thread");
    thread.textContent = "";
    show($("cl-thread-empty"), false);
    state.lastChat = null;
    setText($("cl-reader-title"), "cloud.reader.loading");
    $("cl-reader-meta").textContent = "";
    $("cl-reader-continue").href = "doctors.html#assistant&chat=" + encodeURIComponent(state.chatId);
    $("cl-reader-title").focus();
    API.chats.get(state.chatId, function (err, data) {
      if (state.chatId !== String(id)) return;
      if (err) {
        if (err.status === 401 || err.status === 403) return handleGateError(err);
        if (err.status === 404) { state.chatId = null; render(); status("cloud.status.chatGone", "error"); return; }
        setText($("cl-reader-title"), "cloud.reader.failed");
        setText($("cl-reader-meta"), friendly(err));
        return;
      }
      renderChat(data || {});
    });
  }

  function renderChat(chat) {
    state.lastChat = chat;
    var msgs = Array.isArray(chat.messages) ? chat.messages : [];
    setText($("cl-reader-title"), chat.title ? { raw: chat.title } : "cloud.untitledChat");
    var last = msgs.length ? msgs[msgs.length - 1].createdAt : chat.updatedAt;
    var bits = [plural("cloud.reader.count", msgs.length)];
    if (last) bits.push(t("cloud.reader.lastActivity", { date: formatDateTime(last) }));
    delete $("cl-reader-meta").__mxText;
    $("cl-reader-meta").textContent = bits.join(" · ");
    var thread = $("cl-thread");
    thread.textContent = "";
    msgs.forEach(function (m) {
      var role = m.role === "user" ? "user" : "assistant";
      var meta = parseMeta(m.meta);
      var li = el("li", "cl-msg cl-msg-" + role);
      if (role === "assistant" && isTrue(meta.redFlag)) {
        var banner = el("div", "cl-redflag");
        banner.setAttribute("role", "note");
        banner.appendChild(el("strong", null, t("cloud.reader.emergency")));
        banner.appendChild(document.createTextNode(" " + t("cloud.reader.emergencyText")));
        li.appendChild(banner);
      }
      var who = el("p", "cl-msg-who");
      who.appendChild(el("span", null, t(role === "user" ? "cloud.reader.you" : "cloud.reader.assistant")));
      var when = formatDateTime(m.createdAt);
      if (when) {
        var time = el("time", "cl-msg-time", when);
        var d = toDate(m.createdAt);
        if (d) time.dateTime = d.toISOString();
        who.appendChild(time);
      }
      li.appendChild(who);
      li.appendChild(el("div", "cl-bubble", m.content || ""));
      var specs = specialtiesOf(meta);
      if (specs.length) {
        var chips = el("ul", "cl-chips");
        chips.setAttribute("aria-label", t("cloud.reader.specialtiesAria"));
        specs.forEach(function (s) { chips.appendChild(el("li", "cl-chip", L.specialty(s))); });
        li.appendChild(chips);
      }
      thread.appendChild(li);
    });
    show($("cl-thread-empty"), msgs.length === 0);
  }

  $("cl-reader-back").addEventListener("click", function () {
    state.chatId = null;
    render();
    $("cl-folder-title").focus();
  });
  $("cl-reader-delete").addEventListener("click", function () {
    if (!state.chatId) return;
    deleteChat(state.chatId, $("cl-reader-title").textContent, this);
  });

  $("cl-retry").addEventListener("click", function () { gate("cl-loading"); start(); });

  document.addEventListener("medindex:auth", function () {
    // Session changed (header sign-out, premium change): re-check access.
    if (!API || !API.isOnline() || !$("cl-loading").hidden) return;
    if (typeof API.isStatic === "function" && (API.isStatic() || API.mode() === "pending")) return;
    load();
  });

  /* ---------- Favourite Doctors ---------- */
  function doctorById(id) {
    var list = window.DOCTORS;
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].id) === String(id)) return list[i];
    return null;
  }
  function initials(name) {
    var parts = String(name || "").replace(/^(dr|prof|conf|asist)\.?\s+/i, "").split(/\s+/).filter(Boolean);
    return ((parts[0] || "?").charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "")).toUpperCase();
  }
  function safeImage(src) { return typeof src === "string" && /^https:\/\/[^\s"'<>]+$/.test(src) ? src : null; }

  function renderFavs() {
    var ul = $("cl-favs");
    ul.textContent = "";
    var ids = state.favs || [];
    $("cl-count").textContent = state.favs ? plural("fav.count", ids.length) : "";
    var empty = !ids.length;
    show(ul, !empty);
    show($("cl-empty"), empty);
    if (empty) {
      if (state.favError) {
        $("cl-empty-title").textContent = t("fav.loadFailed", { error: resolve(state.favError) });
        $("cl-empty-text").textContent = "";
        show($("cl-fav-retry"), true);
      } else if (!state.favs) {
        $("cl-empty-title").textContent = t("fav.loading");
        $("cl-empty-text").textContent = "";
      } else {
        $("cl-empty-title").textContent = t("fav.empty.title");
        $("cl-empty-text").textContent = t("fav.empty.text");
        show($("cl-empty-action"), true);
      }
      return;
    }
    ids.forEach(function (id) { ul.appendChild(renderFav(id)); });
  }

  function renderFav(id) {
    var d = doctorById(id);
    var li = el("li", "cl-fav" + (d ? "" : " cl-fav-gone"));
    li.setAttribute("data-doctor-id", String(id));
    var photo = el("span", "cl-fav-photo");
    photo.setAttribute("aria-hidden", "true");
    var src = d && safeImage(d.image);
    if (src) {
      var img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", function () { photo.textContent = initials(d.name); });
      img.src = src;
      photo.appendChild(img);
    } else if (d) {
      photo.textContent = initials(d.name);
    } else {
      photo.appendChild(icon("heart", 22));
    }
    li.appendChild(photo);

    var body = el("div", "cl-fav-body");
    var label = d ? d.name : t("fav.gone");
    body.appendChild(el("p", "cl-fav-name", label));
    if (d) {
      body.appendChild(el("p", "cl-fav-spec", L.specialty(d.specialty)));
      var where = [d.hospital, d.clinicName && d.clinicName !== d.hospital ? d.clinicName : null, d.area].filter(Boolean).join(" · ");
      if (where) body.appendChild(el("p", "cl-fav-where", where));
      if (typeof d.priceRON === "number") body.appendChild(el("p", "cl-fav-price", t("fav.price", { price: L.formatNumber(d.priceRON) })));
    } else {
      body.appendChild(el("p", "cl-fav-where", t("fav.goneText")));
    }
    li.appendChild(body);

    var actions = el("div", "cl-fav-actions");
    if (d) {
      var view = el("a", "acct-btn acct-btn-secondary acct-btn-small", t("fav.view"));
      view.href = "doctors.html?doctor=" + encodeURIComponent(String(d.id));
      view.setAttribute("aria-label", t("fav.viewAria", { name: d.name }));
      actions.appendChild(view);
    }
    var rm = el("button", "acct-btn acct-btn-danger acct-btn-small cl-fav-remove", t("fav.remove"));
    rm.type = "button";
    rm.setAttribute("aria-label", t("fav.removeAria", { name: d ? d.name : t("fav.goneName") }));
    rm.addEventListener("click", function () {
      var idx = Array.prototype.indexOf.call(li.parentNode ? li.parentNode.children : [], li);
      removeFav(id, d, rm, idx);
    });
    actions.appendChild(rm);
    li.appendChild(actions);
    return li;
  }

  function removeFav(id, d, btn, idx) {
    btn.disabled = true;
    API.request("DELETE", "/api/favorites/" + encodeURIComponent(String(id)), null, function (err, data) {
      if (err && err.status !== 404) {
        btn.disabled = false;
        if (err.status === 401 || err.status === 403) return handleGateError(err);
        status({ k: "fav.removeFailed", v: { error: friendly(err) } }, "error");
        return;
      }
      if (data && Array.isArray(data.doctorIds)) state.favs = data.doctorIds.slice();
      else if (state.favs) state.favs = state.favs.filter(function (x) { return String(x) !== String(id); });
      render();
      status({ k: "fav.removed", v: { name: d ? { raw: d.name } : "fav.goneName" } }, "ok");
      var items = $("cl-favs").children;
      if (items.length && !$("cl-favs").hidden) {
        var target = items[Math.min(Math.max(idx, 0), items.length - 1)].querySelector(".cl-fav-remove");
        if (target) { target.focus(); return; }
      }
      (!$("cl-empty-action").hidden ? $("cl-empty-action") : $("cl-folder-title")).focus();
    });
  }

  $("cl-fav-retry").addEventListener("click", function () {
    state.favError = null;
    state.favs = null;
    renderItems();
    loadFavs(function (err) { if (!err) render(); });
  });

  /* ---------- language change: re-render everything built from data ---------- */
  L.onLang(function () {
    if (!state.data || $("cl-app").hidden) return;
    renderFolders();
    renderMeter();
    if (state.chatId) { if (state.lastChat) renderChat(state.lastChat); }
    else renderItems();
  });

  /* ---------- start ---------- */
  function start() {
    if (!API || !API.isOnline()) { gate("cl-offline"); return; }
    // Wait for the one-per-page backend probe; static hosting gets the browse-only notice.
    if (typeof API.mode === "function" && API.mode() === "pending") { gate("cl-loading"); API.ready(start); return; }
    if (typeof API.isStatic === "function" && API.isStatic()) { gate("cl-static"); return; }
    var h = readHash();
    load(function (err) {
      if (err) return;
      if (h.folder && findFolder(h.folder)) { state.folderId = findFolder(h.folder).id; render(); }
      if (h.chat) {
        var sys = folders().filter(function (f) { return f.system; })[0];
        if (sys) state.folderId = sys.id;
        openChat(h.chat);
      }
    });
  }

  // Links to cloud.html#chat=<id> / #f=<id> while already on this page.
  window.addEventListener("hashchange", function () {
    if (!state.data || $("cl-app").hidden) return;
    var h = readHash();
    if (h.chat && h.chat !== state.chatId) {
      var sys = folders().filter(function (f) { return f.system; })[0];
      if (sys) state.folderId = sys.id;
      openChat(h.chat);
    } else if (h.folder && String(h.folder) !== String(state.folderId)) {
      state.chatId = null;
      load(function (err) {
        if (err || !findFolder(h.folder)) return;
        state.folderId = findFolder(h.folder).id;
        render();
      });
    }
  });

  window.MedIndexCloud = { formatBytes: formatBytes, fileKind: fileKind };
  start();
})();
