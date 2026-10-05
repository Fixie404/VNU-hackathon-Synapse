/* Synapse API client: a tiny same-origin XHR JSON helper.
 * Usage: MedIndexAPI.me(function (err, data) { ... });
 * err = {status, error, field?}. On file:// and on static hosting (mode() "file"/"static",
 * see js/config.js) every call fails with {status:0, error:"offline"} without a request.
 * MedIndexAPI.ready(cb) calls cb(mode) once the backend probe has finished.
 * The session lives in an HttpOnly cookie set by the server; nothing is stored in the browser. */
(function () {
  "use strict";

  var TIMEOUT_MS = 15000;

  function isOnline() {
    return typeof location !== "undefined" && location.protocol !== "file:";
  }

  function later(fn) { setTimeout(fn, 0); }

  /* ---------- backend detection ----------
     "file"   : opened from disk (file://)
     "static" : static hosting (GitHub Pages, backend "off", or the probe failed) -> no API calls
     "server" : the Synapse server answered GET /api/me with JSON
     "pending": the one-per-page probe is still running; calls wait for it. */
  var MODE = null, waiters = [], probeResult = null;

  function cfgBackend() {
    var c = window.SYNAPSE_CONFIG;
    return (c && typeof c.backend === "string") ? c.backend.toLowerCase() : "auto";
  }

  function settle(m) {
    MODE = m;
    var w = waiters; waiters = [];
    w.forEach(function (fn) { try { fn(m); } catch (e) { /* keep going */ } });
  }

  function mode() {
    if (MODE) return MODE;
    if (!isOnline()) { MODE = "file"; return MODE; }
    var host = (location.hostname || "").toLowerCase();
    var b = cfgBackend();
    if (b === "off" || /\.github\.io$/.test(host)) { MODE = "static"; return MODE; }
    if (b === "on") { MODE = "server"; return MODE; }
    MODE = "pending";
    rawRequest("GET", "/api/me", null, function (err, data) {
      var isJson = !!(data && typeof data === "object");
      if (isJson && (!err || err.status !== 404)) {
        probeResult = { err: err, data: data };
        settle("server");
      } else {
        settle("static");
      }
    });
    return MODE;
  }

  function ready(cb) {
    if (typeof cb !== "function") return;
    var m = mode();
    if (m === "pending") waiters.push(cb);
    else later(function () { cb(m); });
  }

  function isStatic() { var m = mode(); return m === "static"; }

  function request(method, url, body, cb) {
    cb = typeof cb === "function" ? cb : function () {};
    var m = mode();
    if (m === "pending") { waiters.push(function () { request(method, url, body, cb); }); return; }
    if (m !== "server") {
      later(function () { cb({ status: 0, error: "offline" }, null); });
      return;
    }
    // The probe already fetched /api/me: hand that answer to the first caller.
    if (probeResult && method === "GET" && url === "/api/me") {
      var p = probeResult; probeResult = null;
      later(function () { cb(p.err, p.data); });
      return;
    }
    probeResult = null;
    rawRequest(method, url, body, cb);
  }

  function rawRequest(method, url, body, cb) {
    var done = false;
    function finish(err, data) {
      if (done) return;
      done = true;
      cb(err, data);
    }
    var xhr;
    try {
      xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.timeout = TIMEOUT_MS;
      xhr.setRequestHeader("Accept", "application/json");
      if (method !== "GET") {
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("X-Requested-With", "MedIndex");
      }
    } catch (e) {
      later(function () { finish({ status: 0, error: "Network error" }, null); });
      return;
    }
    xhr.onload = function () {
      var data = null;
      var text = xhr.responseText;
      if (text) {
        try { data = JSON.parse(text); } catch (e) { data = null; }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        finish(null, data);
        return;
      }
      var err = { status: xhr.status, error: (data && typeof data.error === "string" && data.error) || ("Request failed (" + xhr.status + ")") };
      if (data && typeof data.field === "string") err.field = data.field;
      finish(err, data);
    };
    xhr.onerror = function () { finish({ status: 0, error: "Network error" }, null); };
    xhr.ontimeout = function () { finish({ status: 0, error: "timeout" }, null); };
    xhr.onabort = function () { finish({ status: 0, error: "aborted" }, null); };
    try {
      xhr.send(body === undefined || body === null ? null : JSON.stringify(body));
    } catch (e2) {
      later(function () { finish({ status: 0, error: "Network error" }, null); });
    }
  }

  function enc(v) { return encodeURIComponent(String(v)); }

  var api = {
    isOnline: isOnline,
    mode: mode,
    isStatic: isStatic,
    ready: ready,
    request: request,

    me: function (cb) { request("GET", "/api/me", null, cb); },
    signup: function (identifier, password, displayName, cb) {
      var body = { identifier: identifier, password: password };
      if (displayName) body.displayName = displayName;
      request("POST", "/api/auth/signup", body, cb);
    },
    login: function (identifier, password, cb) {
      request("POST", "/api/auth/login", { identifier: identifier, password: password }, cb);
    },
    logout: function (cb) { request("POST", "/api/auth/logout", {}, cb); },

    reviews: {
      summary: function (cb) { request("GET", "/api/reviews/summary", null, cb); },
      list: function (doctorId, cb) { request("GET", "/api/reviews?doctorId=" + enc(doctorId), null, cb); },
      create: function (doctorId, stars, comment, cb) {
        request("POST", "/api/reviews", { doctorId: doctorId, stars: stars, comment: comment }, cb);
      }
    },

    premium: {
      plans: function (cb) { request("GET", "/api/premium/plans", null, cb); },
      checkout: function (plan, card, cb) { request("POST", "/api/premium/checkout", { plan: plan, card: card }, cb); },
      cancel: function (cb) { request("POST", "/api/premium/cancel", {}, cb); }
    },

    cloud: {
      get: function (cb) { request("GET", "/api/cloud", null, cb); },
      createFolder: function (name, cb) { request("POST", "/api/cloud/folders", { name: name }, cb); },
      deleteFolder: function (id, cb) { request("DELETE", "/api/cloud/folders/" + enc(id), null, cb); },
      addFile: function (folderId, name, type, size, cb) {
        request("POST", "/api/cloud/files", { folderId: folderId, name: name, type: type, size: size }, cb);
      },
      deleteFile: function (id, cb) { request("DELETE", "/api/cloud/files/" + enc(id), null, cb); }
    },

    chats: {
      list: function (cb) { request("GET", "/api/chats", null, cb); },
      create: function (title, cb) {
        var body = {};
        if (title) body.title = title;
        request("POST", "/api/chats", body, cb);
      },
      get: function (id, cb) { request("GET", "/api/chats/" + enc(id), null, cb); },
      addMessage: function (id, role, content, meta, cb) {
        var body = { role: role, content: content };
        if (meta !== undefined && meta !== null) body.meta = meta;
        request("POST", "/api/chats/" + enc(id) + "/messages", body, cb);
      },
      remove: function (id, cb) { request("DELETE", "/api/chats/" + enc(id), null, cb); }
    }
  };

  window.MedIndexAPI = api;
})();
