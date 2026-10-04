/* MedIndex Secure Medical Cloud (Premium).
 * Files are simulated: only name, type, size are read from a picked/dropped file and sent as metadata.
 * The file contents are never read and never sent. */
(function () {
  "use strict";

  var API = window.MedIndexAPI;
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
    uploading: false
  };

  // View/sort are per-viewer conveniences only (no auth data).
  function prefGet(k) { try { return window.localStorage.getItem("medindex.cloud." + k); } catch (e) { return null; } }
  function prefSet(k, v) { try { window.localStorage.setItem("medindex.cloud." + k, v); } catch (e) { /* ignore */ } }
  (function () {
    var v = prefGet("view"); if (v === "grid" || v === "list") state.view = v;
    var s = prefGet("sort"); if (s === "date" || s === "name" || s === "size") state.sort = s;
  })();

  /* ---------- formatting ---------- */
  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    var units = ["KB", "MB", "GB", "TB"];
    var i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    var s = n >= 100 || Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
    return s + " " + units[i];
  }

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
    try { return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }
    catch (e) { return d.toDateString(); }
  }
  function formatDateTime(v) {
    var d = toDate(v);
    if (!d) return "";
    try { return d.toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return d.toString(); }
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
    trash: [["path", mix(STROKE, { d: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" })]]
  };
  function icon(name, size) { return svg(ICONS[name] || ICONS.file, size); }

  function fileKind(name, type) {
    var t = String(type || "").toLowerCase();
    var ext = (String(name || "").split(".").pop() || "").toLowerCase();
    if (t === "application/pdf" || ext === "pdf") return { icon: "pdf", label: "PDF" };
    if (t.indexOf("image/") === 0 || /^(png|jpe?g|gif|webp|heic|bmp|tiff?|svg|dcm)$/.test(ext)) return { icon: "image", label: ext === "dcm" ? "DICOM scan" : "Image" };
    if (t.indexOf("video/") === 0 || /^(mp4|mov|webm|avi|mkv)$/.test(ext)) return { icon: "video", label: "Video" };
    if (t.indexOf("audio/") === 0 || /^(mp3|wav|m4a|ogg)$/.test(ext)) return { icon: "audio", label: "Audio" };
    if (/sheet|excel|csv/.test(t) || /^(xlsx?|csv|ods)$/.test(ext)) return { icon: "sheet", label: "Spreadsheet" };
    if (/word|document|text|rtf/.test(t) || /^(docx?|odt|txt|rtf|md)$/.test(ext)) return { icon: "doc", label: "Document" };
    if (/zip|compressed|tar|rar|7z/.test(t) || /^(zip|rar|7z|gz|tar)$/.test(ext)) return { icon: "archive", label: "Archive" };
    return { icon: "file", label: ext && ext.length <= 5 && ext !== String(name).toLowerCase() ? ext.toUpperCase() + " file" : "File" };
  }

  /* ---------- status messages ---------- */
  var statusTimer = null;
  function status(msg, kind) {
    var s = $("cl-status");
    s.textContent = msg || "";
    s.className = "cl-status" + (kind ? " cl-status-" + kind : "");
    clearTimeout(statusTimer);
    if (msg && kind !== "error") statusTimer = setTimeout(function () { s.textContent = ""; s.className = "cl-status"; }, 6000);
  }

  function friendly(err) {
    if (!err) return "";
    if (err.status === 0) {
      if (err.error === "timeout") return "The server took too long to answer. Please try again.";
      return "Can't reach the server. Is python3 server/proxy.py running?";
    }
    if (err.status === 413) return "Storage full. Delete some files to free up space.";
    return err.error || "Something went wrong.";
  }

  /* ---------- gate ---------- */
  var gates = ["cl-loading", "cl-offline", "cl-error", "cl-signin", "cl-upsell", "cl-app"];
  function gate(id) { for (var i = 0; i < gates.length; i++) show($(gates[i]), gates[i] === id); }

  function handleGateError(err) {
    if (err.status === 401) { gate("cl-signin"); return; }
    if (err.status === 403) { gate("cl-upsell"); return; }
    $("cl-error-text").textContent = friendly(err);
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
  function findFolder(id) {
    var fs = folders();
    for (var i = 0; i < fs.length; i++) if (String(fs[i].id) === String(id)) return fs[i];
    return null;
  }
  function isChatFolder(f) { return !!(f && f.system); }

  function load(cb) {
    API.cloud.get(function (err, data) {
      if (err) { handleGateError(err); if (cb) cb(err); return; }
      state.data = data || {};
      if (!state.data.folders) state.data.folders = [];
      if (!state.data.files) state.data.files = [];
      if (!state.data.chats) state.data.chats = [];
      if (!findFolder(state.folderId)) state.folderId = folders().length ? folders()[0].id : null;
      gate("cl-app");
      render();
      if (cb) cb(null);
    });
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
    folders().forEach(function (f) {
      var li = el("li");
      var b = el("button", "cl-folder" + (f.system ? " cl-folder-system" : ""));
      b.type = "button";
      var current = String(f.id) === String(state.folderId);
      if (current) b.setAttribute("aria-current", "true");
      b.appendChild(icon(f.system ? "chat" : "folder", 20));
      b.appendChild(el("span", "cl-folder-name", f.name));
      var count = f.system ? state.data.chats.length : files.filter(function (x) { return String(x.folderId) === String(f.id); }).length;
      var c = el("span", "cl-folder-count", count);
      c.setAttribute("aria-label", count + (count === 1 ? " item" : " items"));
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
    $("cl-meter-text").textContent = formatBytes(used) + " used of " + formatBytes(quota) + (pct >= 90 ? " (almost full)" : "");
  }

  function currentItems() {
    var f = findFolder(state.folderId);
    if (!f) return [];
    var items;
    if (isChatFolder(f)) {
      items = state.data.chats.map(function (c) {
        return { kind: "chat", id: c.id, name: c.title || "Untitled chat", size: c.size || 0, date: c.updatedAt || c.createdAt };
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
    $("cl-folder-title").textContent = f ? f.name : "No folder";
    show($("cl-upload-btn"), !!f && !chatFolder);
    show($("cl-drop"), !!f && !chatFolder);
    show($("cl-new-chat"), chatFolder);
    show($("cl-delete-folder"), !!f && !f.system);
    $("cl-sort").value = state.sort;
    $("cl-view-grid").setAttribute("aria-pressed", state.view === "grid" ? "true" : "false");
    $("cl-view-list").setAttribute("aria-pressed", state.view === "list" ? "true" : "false");

    var items = currentItems();
    var ul = $("cl-items");
    ul.className = "cl-items " + (state.view === "list" ? "cl-list" : "cl-grid");
    ul.textContent = "";
    $("cl-count").textContent = items.length + (chatFolder ? (items.length === 1 ? " conversation" : " conversations") : (items.length === 1 ? " file" : " files"));

    items.forEach(function (it) { ul.appendChild(renderItem(it)); });

    show(ul, items.length > 0);
    show($("cl-empty"), items.length === 0);
    if (!items.length) {
      if (!f) { $("cl-empty-title").textContent = "No folders yet"; $("cl-empty-text").textContent = "Create a folder to get started."; }
      else if (chatFolder) { $("cl-empty-title").textContent = "No conversations yet"; $("cl-empty-text").textContent = "Chats you have with the MedIndex assistant while signed in appear here. Start one with New chat."; }
      else { $("cl-empty-title").textContent = "This folder is empty"; $("cl-empty-text").textContent = "Upload or drag files here. Only their details are saved."; }
    }
  }

  function renderItem(it) {
    var li = el("li", "cl-item cl-item-" + it.kind);
    var kind = it.kind === "chat" ? { icon: "chat", label: "Conversation" } : fileKind(it.name, it.type);
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
    del.setAttribute("aria-label", "Delete " + it.name);
    del.title = "Delete";
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
      cb(window.confirm(title + "\n\n" + text));
      return;
    }
    $("cl-confirm-title").textContent = title;
    $("cl-confirm-text").textContent = text;
    $("cl-confirm-ok").textContent = okLabel || "Delete";
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
    confirmDialog("Delete this file?", "“" + it.name + "” will be removed from your cloud. This can't be undone.", "Delete file", function (ok) {
      if (!ok) return;
      btn.disabled = true;
      API.cloud.deleteFile(it.id, function (err) {
        if (err && err.status !== 404) { btn.disabled = false; if (err.status === 401 || err.status === 403) return handleGateError(err); status(friendly(err), "error"); return; }
        load(function (e) { if (!e) { status("Deleted “" + it.name + "”."); focusAfterDelete(idx); } });
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
    confirmDialog("Delete this conversation?", "“" + name + "” will be removed from your ChatBot History. This can't be undone.", "Delete chat", function (ok) {
      if (!ok) return;
      if (btn) btn.disabled = true;
      API.chats.remove(id, function (err) {
        if (err && err.status !== 404) { if (btn) btn.disabled = false; if (err.status === 401 || err.status === 403) return handleGateError(err); status(friendly(err), "error"); return; }
        state.chatId = null;
        load(function (e) { if (!e) { status("Conversation deleted."); focusAfterDelete(idx); } });
      });
    });
  }

  $("cl-delete-folder").addEventListener("click", function () {
    var f = findFolder(state.folderId);
    if (!f || f.system) return;
    var n = state.data.files.filter(function (x) { return String(x.folderId) === String(f.id); }).length;
    var text = n ? "The folder “" + f.name + "” and its " + n + (n === 1 ? " file" : " files") + " will be deleted. This can't be undone." : "The empty folder “" + f.name + "” will be deleted.";
    var btn = this;
    confirmDialog("Delete this folder?", text, "Delete folder", function (ok) {
      if (!ok) return;
      btn.disabled = true;
      API.cloud.deleteFolder(f.id, function (err) {
        btn.disabled = false;
        if (err && err.status !== 404) { if (err.status === 401 || err.status === 403) return handleGateError(err); status(friendly(err), "error"); return; }
        state.folderId = null;
        load(function (e) { if (!e) { status("Folder “" + f.name + "” deleted."); var cur = document.querySelector("#cl-folders [aria-current=true]"); (cur || $("cl-new-folder")).focus(); } });
      });
    });
  });

  /* New folder dialog */
  var folderDlg = $("cl-folder-dialog");
  var folderName = $("cl-folder-name");
  function setFolderError(msg) {
    $("cl-folder-name-error").textContent = msg || "";
    if (msg) folderName.setAttribute("aria-invalid", "true"); else folderName.removeAttribute("aria-invalid");
  }
  $("cl-new-folder").addEventListener("click", function () {
    folderName.value = "";
    setFolderError("");
    if (typeof folderDlg.showModal === "function") { folderDlg.showModal(); folderName.focus(); }
    else {
      var n = window.prompt("Folder name");
      if (n) createFolder(n.trim(), function (msg) { if (msg) status(msg, "error"); });
    }
  });
  $("cl-folder-cancel").addEventListener("click", function () { folderDlg.close(); });
  folderDlg.addEventListener("close", function () { $("cl-new-folder").focus(); });
  $("cl-folder-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = folderName.value.trim();
    if (!name) { setFolderError("Enter a folder name."); folderName.focus(); return; }
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
      load(function () { status("Folder “" + name + "” created."); });
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
    if (!f || isChatFolder(f) || !fileList || !fileList.length || state.uploading) return;
    // Read ONLY the metadata. File contents are never touched.
    var metas = [];
    for (var i = 0; i < fileList.length && i < 50; i++) {
      var file = fileList[i];
      metas.push({ name: String(file.name || "file").slice(0, 200), type: String(file.type || ""), size: Number(file.size) || 0 });
    }
    state.uploading = true;
    $("cl-upload-btn").disabled = true;
    var added = 0;
    status("Saving details of " + metas.length + (metas.length === 1 ? " file…" : " files…"));
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
        if (err && err.status === 413) {
          status("Storage full: “" + m.name + "” (" + formatBytes(m.size) + ") doesn't fit. " + (added ? added + " added before that. " : "") + "Delete some files to free up space.", "error");
        } else if (err) {
          status((added ? added + " added. " : "") + "Couldn't add “" + m.name + "”: " + friendly(err), "error");
        } else {
          status(added === 1 ? "Added “" + metas[0].name + "”." : "Added " + added + " files.", "ok");
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
  function canDrop() { var f = findFolder(state.folderId); return !state.chatId && f && !isChatFolder(f); }
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
    $("cl-reader-title").textContent = "Loading conversation…";
    $("cl-reader-meta").textContent = "";
    $("cl-reader-continue").href = "doctors.html#assistant&chat=" + encodeURIComponent(state.chatId);
    $("cl-reader-title").focus();
    API.chats.get(state.chatId, function (err, data) {
      if (state.chatId !== String(id)) return;
      if (err) {
        if (err.status === 401 || err.status === 403) return handleGateError(err);
        if (err.status === 404) { state.chatId = null; render(); status("That conversation no longer exists.", "error"); return; }
        $("cl-reader-title").textContent = "Couldn't open this conversation";
        $("cl-reader-meta").textContent = friendly(err);
        return;
      }
      renderChat(data || {});
    });
  }

  function renderChat(chat) {
    var msgs = Array.isArray(chat.messages) ? chat.messages : [];
    $("cl-reader-title").textContent = chat.title || "Untitled chat";
    var last = msgs.length ? msgs[msgs.length - 1].createdAt : chat.updatedAt;
    var bits = [msgs.length + (msgs.length === 1 ? " message" : " messages")];
    if (last) bits.push("last activity " + formatDateTime(last));
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
        banner.appendChild(el("strong", null, "Possible emergency."));
        banner.appendChild(document.createTextNode(" If this is happening now, call 112 immediately."));
        li.appendChild(banner);
      }
      var who = el("p", "cl-msg-who");
      who.appendChild(el("span", null, role === "user" ? "You" : "MedIndex Assistant"));
      var t = formatDateTime(m.createdAt);
      if (t) {
        var time = el("time", "cl-msg-time", t);
        var d = toDate(m.createdAt);
        if (d) time.dateTime = d.toISOString();
        who.appendChild(time);
      }
      li.appendChild(who);
      li.appendChild(el("div", "cl-bubble", m.content || ""));
      var specs = specialtiesOf(meta);
      if (specs.length) {
        var chips = el("ul", "cl-chips");
        chips.setAttribute("aria-label", "Suggested specialties");
        specs.forEach(function (s) { chips.appendChild(el("li", "cl-chip", s)); });
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
    load();
  });

  /* ---------- start ---------- */
  function start() {
    if (!API || !API.isOnline()) { gate("cl-offline"); return; }
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
