"""MedIndex account API: auth, reviews, premium, cloud (metadata only), saved chats, favourites, distinctions.

Called from proxy.py for every /api/* path except /api/chat. Identity and premium status come
ONLY from the session cookie; user ids or premium flags sent by the client are never used.
Every object lookup is scoped by the session user's id (another user's id -> 404).
"""
import json
import os
import re
import sqlite3
import time
from urllib.parse import parse_qs

import auth
import db

REPO_ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
MAX_BODY = 32 * 1024
CSRF_HEADER = "X-Requested-With"
CSRF_VALUE = "MedIndex"

QUOTA_BYTES = 5 * 1024 ** 3          # 5 GiB = 5368709120 (metadata only, nothing is allocated)
SYSTEM_FOLDER = "ChatBot History"
REVIEW_LIMIT = 5
MAX_COMMENT = 280
MAX_FOLDERS = 100
MAX_FILES = 2000
MAX_CHATS = 500
MAX_CHAT_MESSAGES = 500
MAX_MESSAGE = 4000
MAX_META = 4096
MAX_TITLE = 100
MAX_CHAT_STORAGE = 20 * 1024 * 1024  # per user, all saved chats (content + meta bytes)
MAX_FAVORITES = 500
DISTINCTION_THRESHOLD = 4.5

PLANS = {
    "monthly": {"id": "monthly", "price": 5.99, "currency": "USD", "interval": "month", "days": 30},
    "yearly": {"id": "yearly", "price": 65.99, "currency": "USD", "interval": "year", "days": 365},
}


def load_doctor_ids():
    try:
        with open(os.path.join(REPO_ROOT, "data", "doctors.js"), encoding="utf-8") as fh:
            src = fh.read()
    except OSError:
        return frozenset()
    return frozenset(int(x) for x in re.findall(r'"id"\s*:\s*(\d{1,9})\s*,', src))


DOCTOR_IDS = load_doctor_ids()


class ApiError(Exception):
    def __init__(self, status, error, field=None, note=""):
        super().__init__(error)
        self.status, self.error, self.field, self.note = status, error, field, note


def iso(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)) if ts is not None else None


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


CTRL_RX = re.compile("[\\x00-\\x08\\x0b-\\x1f\\x7f-\\x9f\\u061c\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff\\ufff9-\\ufffb]")


def utf8_ok(v):
    try:
        v.encode("utf-8")
        return True
    except UnicodeEncodeError:  # lone surrogates ("\ud800") survive json.loads
        return False


def body_text_ok(obj):
    """Every string (keys and values) in the parsed JSON body must be valid UTF-8."""
    stack = [obj]
    while stack:
        o = stack.pop()
        if isinstance(o, str):
            if not utf8_ok(o):
                return False
        elif isinstance(o, dict):
            stack.extend(o.keys())
            stack.extend(o.values())
        elif isinstance(o, list):
            stack.extend(o)
    return True


def clean_text(v, maxlen, field, required=False, multiline=False):
    if v is None:
        v = ""
    if not isinstance(v, str) or not utf8_ok(v):
        raise ApiError(400, "Invalid %s" % field, field)
    v = v.replace("\r\n", "\n").replace("\r", "\n")
    if not multiline:
        v = v.replace("\n", " ").replace("\t", " ")
    v = CTRL_RX.sub("", v).strip()
    if required and not v:
        raise ApiError(400, "%s is required" % (field[:1].upper() + field[1:]), field)
    if len(v) > maxlen:
        raise ApiError(400, "%s is too long (max %d characters)" % (field[:1].upper() + field[1:], maxlen), field)
    return v


# ---------------------------------------------------------------- presentation
def display_name(u):
    return u["display_name"] or "User #%d" % u["id"]


def author_name(user_id, name):
    """Public, masked author: "Ana P." / "Ana" / "User #12". Never an email or phone number."""
    if name and "@" not in name and not re.search(r"\d{4,}", name):
        parts = [p for p in re.split(r"\s+", name.strip()) if p]
        if parts:
            first = parts[0][:20]
            return first + (" " + parts[-1][0].upper() + "." if len(parts) > 1 else "")
    return "User #%d" % user_id


def premium_info(conn, user_id):
    row = conn.execute("SELECT plan, active, started_at, renews_at FROM subscriptions WHERE user_id = ?",
                       (user_id,)).fetchone()
    if row is None or not row["active"] or row["renews_at"] < int(time.time()):
        return {"active": False, "plan": None, "since": None, "renewsAt": None}
    return {"active": True, "plan": row["plan"], "since": iso(row["started_at"]), "renewsAt": iso(row["renews_at"])}


def user_json(conn, u):
    if u["email"]:
        kind, value = "email", u["email"]
    elif u["phone"]:
        kind, value = "phone", u["phone"]
    else:
        kind, value = "username", u["username"]
    return {"id": u["id"], "displayName": display_name(u), "identifierType": kind,
            "identifierMasked": auth.mask_identifier(kind, value), "premium": premium_info(conn, u["id"])}


def ensure_system_folder(conn, user_id):
    conn.execute("INSERT OR IGNORE INTO cloud_folders (user_id, name, system, created_at) VALUES (?, ?, 1, ?)",
                 (user_id, SYSTEM_FOLDER, int(time.time())))


# ---------------------------------------------------------------- request context
class Ctx:
    def __init__(self, handler, method, path, query, conn):
        self.h, self.method, self.path, self.query, self.conn = handler, method, path, query, conn
        self.token = auth.read_cookie_token(handler.headers.get("Cookie"))
        self._user = False
        self.body = None
        self.set_cookie = None

    @property
    def ip(self):
        return self.h.client_address[0] if self.h.client_address else "?"

    def user(self):
        if self._user is False:
            self._user = auth.session_user(self.conn, self.token)
            if self._user is None and self.token:
                self.set_cookie = auth.clear_cookie()  # stale cookie
        return self._user

    def require_user(self):
        u = self.user()
        if u is None:
            raise ApiError(401, "Login required")
        return u

    def require_premium(self):
        u = self.require_user()
        if not premium_info(self.conn, u["id"])["active"]:
            raise ApiError(403, "Premium required")
        return u

    def json(self):
        return self.body if isinstance(self.body, dict) else {}


# ---------------------------------------------------------------- auth endpoints
def signup(c):
    b = c.json()
    ident = b.get("identifier")
    kind, value = auth.classify(ident, allow_username=False)
    rl_key = value or (ident.strip().lower()[:254] if isinstance(ident, str) else "")
    if not auth.reserve(auth.signup_ip, c.ip, auth.signup_id, rl_key):
        raise ApiError(429, "Too many attempts. Try again in a few minutes.")
    if not kind:
        if isinstance(ident, str) and auth.looks_like_phone(ident):
            raise ApiError(400, "Enter a valid phone number (e.g. 07xx xxx xxx or +40 7xx xxx xxx)", "identifier")
        raise ApiError(400, "Enter a valid email address or phone number", "identifier")
    pw = b.get("password")
    err = auth.password_error(pw)
    if err:
        raise ApiError(400, err, "password")
    name = clean_text(b.get("displayName"), 40, "displayName") or None
    if name and re.search(r"[<>]", name):
        raise ApiError(400, "Invalid displayName", "displayName")
    pw_hash = auth.hash_password(pw)
    now = int(time.time())
    try:
        c.conn.execute("BEGIN IMMEDIATE")
        cur = c.conn.execute("INSERT INTO users (%s, display_name, pw_hash, created_at) VALUES (?, ?, ?, ?)" % kind,
                             (value, name, pw_hash, now))
        uid = cur.lastrowid
        token = auth.create_session(c.conn, uid, c.token)
        c.conn.execute("COMMIT")
    except sqlite3.IntegrityError:
        c.conn.execute("ROLLBACK")
        raise ApiError(409, "Account already exists")
    except Exception:
        if c.conn.in_transaction:
            c.conn.execute("ROLLBACK")
        raise
    c.set_cookie = auth.session_cookie(token)
    u = c.conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return 201, {"user": user_json(c.conn, u)}


def login(c):
    b = c.json()
    ident, pw = b.get("identifier"), b.get("password")
    if not isinstance(ident, str) or not ident.strip():
        raise ApiError(400, "Identifier is required", "identifier")
    if not isinstance(pw, str) or not pw:
        raise ApiError(400, "Password is required", "password")
    if not utf8_ok(ident) or not utf8_ok(pw):
        raise ApiError(400, "Invalid characters", "password" if utf8_ok(ident) else "identifier")
    kind, value = auth.classify(ident, allow_username=True)
    rl_key = value or ident.strip().lower()[:254]
    slots = auth.reserve(auth.login_ip, c.ip, auth.login_id, rl_key)  # counted before the scrypt verify
    if not slots:
        raise ApiError(429, "Too many attempts. Try again in a few minutes.")
    u = None
    if kind and len(pw) <= auth.PW_MAX:
        u = c.conn.execute("SELECT * FROM users WHERE %s = ?" % kind, (value,)).fetchone()
    ok = auth.verify_password(pw[:auth.PW_MAX], u["pw_hash"] if u else None)
    if not ok or u is None:
        raise ApiError(401, "Invalid credentials")
    auth.refund(slots)  # a successful login does not use up the failure budget
    token = auth.create_session(c.conn, u["id"], c.token)
    c.set_cookie = auth.session_cookie(token)
    return 200, {"user": user_json(c.conn, u)}


def logout(c):
    auth.delete_session(c.conn, c.token)
    c.set_cookie = auth.clear_cookie()
    return 204, None


def me(c):
    u = c.user()
    return 200, {"user": user_json(c.conn, u) if u else None}


# ---------------------------------------------------------------- reviews
def parse_doctor_id(v):
    if isinstance(v, str) and re.fullmatch(r"[0-9]{1,9}", v):
        v = int(v)
    if not is_int(v) or v not in DOCTOR_IDS:
        raise ApiError(400, "Unknown doctor", "doctorId")
    return v


def review_summary(c):
    rows = c.conn.execute("SELECT doctor_id, AVG(stars) AS a, COUNT(*) AS n FROM reviews GROUP BY doctor_id").fetchall()
    return 200, {"ratings": {str(r["doctor_id"]): {"avg": round(r["a"], 2), "count": r["n"]} for r in rows}}


def reviews_list(c):
    did = parse_doctor_id((c.query.get("doctorId") or [None])[0])
    u = c.user()
    premium = bool(u) and premium_info(c.conn, u["id"])["active"]
    total = c.conn.execute("SELECT COUNT(*) FROM reviews WHERE doctor_id = ?", (did,)).fetchone()[0]
    sql = ("SELECT r.id, r.user_id, r.stars, r.comment, r.created_at, u.display_name FROM reviews r "
           "JOIN users u ON u.id = r.user_id WHERE r.doctor_id = ? ORDER BY r.created_at DESC, r.id DESC")
    params = (did,)
    if not premium:  # the limit is enforced here, server-side
        sql += " LIMIT ?"
        params = (did, REVIEW_LIMIT)
    shown = [{"id": r["id"], "stars": r["stars"], "comment": r["comment"], "createdAt": iso(r["created_at"]),
              "author": author_name(r["user_id"], r["display_name"])} for r in c.conn.execute(sql, params)]
    mine = None
    if u:
        r = c.conn.execute("SELECT id, stars, comment, created_at FROM reviews WHERE doctor_id = ? AND user_id = ?",
                           (did, u["id"])).fetchone()
        if r:
            mine = {"id": r["id"], "stars": r["stars"], "comment": r["comment"], "createdAt": iso(r["created_at"])}
    return 200, {"doctorId": did, "total": total, "shown": shown,
                 "limited": (not premium) and total > REVIEW_LIMIT,
                 "limit": None if premium else REVIEW_LIMIT, "mine": mine}


def review_create(c):
    u = c.require_user()
    b = c.json()
    did = parse_doctor_id(b.get("doctorId"))
    stars = b.get("stars")
    if not is_int(stars) or not 1 <= stars <= 5:
        raise ApiError(400, "Stars must be a whole number from 1 to 5", "stars")
    comment = clean_text(b.get("comment"), MAX_COMMENT, "comment", multiline=True)
    now = int(time.time())
    try:
        cur = c.conn.execute("INSERT INTO reviews (user_id, doctor_id, stars, comment, created_at) VALUES (?, ?, ?, ?, ?)",
                             (u["id"], did, stars, comment, now))
    except sqlite3.IntegrityError:
        raise ApiError(409, "You already reviewed this doctor")
    return 201, {"review": {"id": cur.lastrowid, "doctorId": did, "stars": stars, "comment": comment,
                            "createdAt": iso(now), "author": author_name(u["id"], u["display_name"])}}


# ---------------------------------------------------------------- favourites + distinctions (Premium)
def favorite_ids(conn, uid):
    """Newest first. Only ids are stored; ids no longer in data/doctors.js are not returned."""
    return [r[0] for r in conn.execute("SELECT doctor_id FROM favorites WHERE user_id = ? "
                                       "ORDER BY created_at DESC, rowid DESC", (uid,)) if r[0] in DOCTOR_IDS]


def favorites_get(c):
    u = c.require_premium()
    return 200, {"doctorIds": favorite_ids(c.conn, u["id"])}


def favorite_add(c):
    u = c.require_premium()
    did = parse_doctor_id(c.json().get("doctorId"))  # ASCII digits only, must exist in data/doctors.js
    uid = u["id"]
    c.conn.execute("BEGIN IMMEDIATE")  # cap check + insert are atomic
    try:
        if c.conn.execute("SELECT 1 FROM favorites WHERE user_id = ? AND doctor_id = ?", (uid, did)).fetchone():
            status = 200
        else:
            if c.conn.execute("SELECT COUNT(*) FROM favorites WHERE user_id = ?", (uid,)).fetchone()[0] >= MAX_FAVORITES:
                raise ApiError(400, "Too many favourites (max %d)" % MAX_FAVORITES, "doctorId")
            c.conn.execute("INSERT INTO favorites (user_id, doctor_id, created_at) VALUES (?, ?, ?)",
                           (uid, did, int(time.time())))
            status = 201
        c.conn.execute("COMMIT")
    except Exception:
        c.conn.execute("ROLLBACK")
        raise
    return status, {"doctorIds": favorite_ids(c.conn, uid)}


def favorite_delete(c, did):
    u = c.require_premium()
    c.conn.execute("DELETE FROM favorites WHERE user_id = ? AND doctor_id = ?", (u["id"], did))
    return 200, {"doctorIds": favorite_ids(c.conn, u["id"])}


def distinctions(c):
    """Live from the MedIndex reviews table only (never any published/external rating)."""
    c.require_premium()
    rows = c.conn.execute("SELECT doctor_id FROM reviews GROUP BY doctor_id "
                          "HAVING COUNT(*) >= 1 AND SUM(stars) >= ? * COUNT(*) ORDER BY doctor_id",
                          (DISTINCTION_THRESHOLD,)).fetchall()
    return 200, {"threshold": DISTINCTION_THRESHOLD, "doctorIds": [r[0] for r in rows if r[0] in DOCTOR_IDS],
                 "basis": "medindex_reviews"}


# ---------------------------------------------------------------- premium
def luhn_ok(num):
    total = 0
    for i, ch in enumerate(reversed(num)):
        d = ord(ch) - 48
        if i % 2:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def validate_card(card):
    """Format checks only. Card data is never stored, logged or echoed back."""
    if not isinstance(card, dict):
        raise ApiError(400, "Card details are required", "card")
    name = card.get("name")
    if not isinstance(name, str) or not re.match(r"^[^\W\d_]+(?:[ .'-]+[^\W\d_]+)*\.?$", name.strip()) \
            or not 2 <= len(name.strip()) <= 80:
        raise ApiError(400, "Enter the name on the card", "card.name")
    number = card.get("number")
    digits = re.sub(r"[ -]", "", number) if isinstance(number, str) else ""
    if not re.match(r"^\d{12,19}$", digits) or not luhn_ok(digits):
        raise ApiError(400, "Invalid card number", "card.number")
    exp = card.get("exp")
    m = re.match(r"^\s*(\d{2})\s*/\s*(\d{2})\s*$", exp) if isinstance(exp, str) else None
    if not m or not 1 <= int(m.group(1)) <= 12:
        raise ApiError(400, "Expiry must be MM/YY", "card.exp")
    month, year = int(m.group(1)), 2000 + int(m.group(2))
    now = time.gmtime()
    if (year, month) < (now.tm_year, now.tm_mon) or year > now.tm_year + 20:
        raise ApiError(400, "Card has expired", "card.exp")
    cvc = card.get("cvc")
    if not isinstance(cvc, str) or not re.match(r"^\d{3,4}$", cvc.strip()):
        raise ApiError(400, "Invalid CVC", "card.cvc")


def premium_plans(c):
    return 200, {"plans": [{k: p[k] for k in ("id", "price", "currency", "interval")} for p in PLANS.values()]}


def premium_checkout(c):
    u = c.require_user()
    b = c.json()
    plan = b.get("plan")
    if plan not in PLANS:
        raise ApiError(400, "Choose a monthly or yearly plan", "plan")
    validate_card(b.get("card"))
    b.pop("card", None)  # drop card data as early as possible
    now = int(time.time())
    renews = now + PLANS[plan]["days"] * 86400
    c.conn.execute("BEGIN IMMEDIATE")
    try:
        c.conn.execute("INSERT INTO subscriptions (user_id, plan, active, started_at, renews_at) VALUES (?, ?, 1, ?, ?) "
                       "ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, active = 1, "
                       "started_at = CASE WHEN subscriptions.active = 1 THEN subscriptions.started_at ELSE excluded.started_at END, "
                       "renews_at = excluded.renews_at", (u["id"], plan, now, renews))
        ensure_system_folder(c.conn, u["id"])
        c.conn.execute("COMMIT")
    except Exception:
        c.conn.execute("ROLLBACK")
        raise
    return 200, {"premium": premium_info(c.conn, u["id"])}


def premium_cancel(c):
    u = c.require_user()
    c.conn.execute("UPDATE subscriptions SET active = 0 WHERE user_id = ?", (u["id"],))
    return 200, {"premium": premium_info(c.conn, u["id"])}


# ---------------------------------------------------------------- cloud (metadata only)
CHAT_BYTES_SQL = "COALESCE(LENGTH(CAST(m.content AS BLOB)), 0) + COALESCE(LENGTH(CAST(m.meta_json AS BLOB)), 0)"


def file_bytes(conn, uid):
    return conn.execute("SELECT COALESCE(SUM(size_bytes), 0) FROM cloud_files WHERE user_id = ?", (uid,)).fetchone()[0]


def chat_bytes(conn, uid):
    return conn.execute("SELECT COALESCE(SUM(%s), 0) FROM chat_messages m JOIN chats c ON c.id = m.chat_id "
                        "WHERE c.user_id = ?" % CHAT_BYTES_SQL, (uid,)).fetchone()[0]


def used_bytes(conn, uid):
    """Files (metadata sizes) + saved chat text (content + meta, UTF-8 bytes)."""
    return file_bytes(conn, uid) + chat_bytes(conn, uid)


def cloud_get(c):
    u = c.require_premium()
    uid = u["id"]
    ensure_system_folder(c.conn, uid)
    folders = [{"id": r["id"], "name": r["name"], "system": bool(r["system"])} for r in c.conn.execute(
        "SELECT id, name, system FROM cloud_folders WHERE user_id = ? ORDER BY system DESC, name COLLATE NOCASE, id", (uid,))]
    files = [{"id": r["id"], "folderId": r["folder_id"], "name": r["name"], "type": r["mime"], "size": r["size_bytes"],
              "createdAt": iso(r["created_at"]), "kind": "file"} for r in c.conn.execute(
        "SELECT id, folder_id, name, mime, size_bytes, created_at FROM cloud_files WHERE user_id = ? "
        "ORDER BY created_at DESC, id DESC", (uid,))]
    chats = [{"id": r["id"], "title": r["title"], "updatedAt": iso(r["updated_at"]), "size": r["size"], "kind": "chat"}
             for r in c.conn.execute(
        "SELECT c.id, c.title, c.updated_at, COALESCE(SUM(" + CHAT_BYTES_SQL + "), 0) AS size FROM chats c "
        "LEFT JOIN chat_messages m ON m.chat_id = c.id WHERE c.user_id = ? GROUP BY c.id "
        "ORDER BY c.updated_at DESC, c.id DESC", (uid,))]
    return 200, {"quotaBytes": QUOTA_BYTES, "usedBytes": used_bytes(c.conn, uid), "folders": folders,
                 "files": files, "chats": chats}


def check_name(v, maxlen, field):
    v = clean_text(v, maxlen, field, required=True)
    if "/" in v or "\\" in v or v in (".", ".."):
        raise ApiError(400, "Invalid %s" % field, field)
    return v


def folder_create(c):
    u = c.require_premium()
    name = check_name(c.json().get("name"), 60, "name")
    if c.conn.execute("SELECT COUNT(*) FROM cloud_folders WHERE user_id = ?", (u["id"],)).fetchone()[0] >= MAX_FOLDERS:
        raise ApiError(400, "Too many folders", "name")
    now = int(time.time())
    try:
        cur = c.conn.execute("INSERT INTO cloud_folders (user_id, name, system, created_at) VALUES (?, ?, 0, ?)",
                             (u["id"], name, now))
    except sqlite3.IntegrityError:
        raise ApiError(409, "A folder with this name already exists", "name")
    return 201, {"folder": {"id": cur.lastrowid, "name": name, "system": False}}


def folder_delete(c, fid):
    u = c.require_premium()
    row = c.conn.execute("SELECT system FROM cloud_folders WHERE id = ? AND user_id = ?", (fid, u["id"])).fetchone()
    if row is None:
        raise ApiError(404, "Not found")
    if row["system"]:
        raise ApiError(403, "This folder cannot be deleted")
    c.conn.execute("BEGIN IMMEDIATE")
    try:
        c.conn.execute("DELETE FROM cloud_files WHERE folder_id = ? AND user_id = ?", (fid, u["id"]))
        c.conn.execute("DELETE FROM cloud_folders WHERE id = ? AND user_id = ?", (fid, u["id"]))
        c.conn.execute("COMMIT")
    except Exception:
        c.conn.execute("ROLLBACK")
        raise
    return 204, None


def file_create(c):
    u = c.require_premium()
    b = c.json()
    fid = b.get("folderId")
    if fid is not None and not is_int(fid):
        raise ApiError(400, "Invalid folder", "folderId")
    name = check_name(b.get("name"), 200, "name")
    mime = b.get("type")
    if mime in (None, ""):
        mime = "application/octet-stream"
    if not isinstance(mime, str) or len(mime) > 100 or not re.match(r"^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$", mime):
        raise ApiError(400, "Invalid file type", "type")
    size = b.get("size")
    if not is_int(size) or size < 0 or size > 10 ** 15:
        raise ApiError(400, "Invalid file size", "size")
    uid = u["id"]
    c.conn.execute("BEGIN IMMEDIATE")  # quota check + insert are atomic
    try:
        if fid is not None:
            row = c.conn.execute("SELECT system FROM cloud_folders WHERE id = ? AND user_id = ?", (fid, uid)).fetchone()
            if row is None:
                raise ApiError(404, "Folder not found", "folderId")
            if row["system"]:
                raise ApiError(400, "Files cannot be uploaded to this folder", "folderId")
        if c.conn.execute("SELECT COUNT(*) FROM cloud_files WHERE user_id = ?", (uid,)).fetchone()[0] >= MAX_FILES:
            raise ApiError(400, "Too many files")
        used = used_bytes(c.conn, uid)
        if used + size > QUOTA_BYTES:
            raise ApiError(413, "Storage full")
        now = int(time.time())
        cur = c.conn.execute("INSERT INTO cloud_files (user_id, folder_id, name, mime, size_bytes, created_at) "
                             "VALUES (?, ?, ?, ?, ?, ?)", (uid, fid, name, mime, size, now))
        c.conn.execute("COMMIT")
    except Exception:
        c.conn.execute("ROLLBACK")
        raise
    return 201, {"file": {"id": cur.lastrowid, "folderId": fid, "name": name, "type": mime, "size": size,
                          "createdAt": iso(now), "kind": "file"}, "usedBytes": used + size}


def file_delete(c, file_id):
    u = c.require_premium()
    cur = c.conn.execute("DELETE FROM cloud_files WHERE id = ? AND user_id = ?", (file_id, u["id"]))
    if cur.rowcount == 0:
        raise ApiError(404, "Not found")
    return 204, None


# ---------------------------------------------------------------- chats
def chats_list(c):
    u = c.require_premium()
    rows = c.conn.execute("SELECT c.id, c.title, c.created_at, c.updated_at, COUNT(m.id) AS n FROM chats c "
                          "LEFT JOIN chat_messages m ON m.chat_id = c.id WHERE c.user_id = ? GROUP BY c.id "
                          "ORDER BY c.updated_at DESC, c.id DESC", (u["id"],)).fetchall()
    return 200, {"chats": [{"id": r["id"], "title": r["title"], "createdAt": iso(r["created_at"]),
                            "updatedAt": iso(r["updated_at"]), "messageCount": r["n"]} for r in rows]}


DEFAULT_TITLE = "New chat"

# Set by proxy.py at startup: the SAME output filter used for Kimi replies (sanitize_reply) and the
# dataset specialty list. Saved assistant turns are re-filtered at write time, so a forged
# "assistant" message cannot smuggle doses, foreign emergency numbers, links, phone numbers,
# prices or doctor names into a reopened chat.
_SANITIZE = None
_SPECIALTIES = frozenset()
CONF_LEVELS = {"low": "Low", "medium": "Medium", "high": "High"}


def configure_assistant_filter(sanitize, specialties):
    global _SANITIZE, _SPECIALTIES
    _SANITIZE, _SPECIALTIES = sanitize, frozenset(specialties)


def guess_lang(text):
    return "ro" if re.search(r"[ăâîșşțţĂÂÎȘŞȚŢ]", text) else "en"


def clean_assistant_meta(meta, emergency):
    """Only {redFlag: bool, suggestions: [{specialty, confidence, confidenceScore}] (max 3)}; every other key is dropped."""
    meta = meta if isinstance(meta, dict) else {}
    red = meta.get("redFlag") is True or emergency
    out = {"redFlag": red, "suggestions": []}
    if red:
        return out  # like the Kimi path: no doctor suggestions with a red flag
    seen = set()
    sugg = meta.get("suggestions")
    for item in sugg if isinstance(sugg, list) else []:
        if len(out["suggestions"]) >= 3:
            break
        if not isinstance(item, dict):
            continue
        name = item.get("specialty")
        if not isinstance(name, str) or name not in _SPECIALTIES or name in seen:
            continue
        seen.add(name)
        clean = {"specialty": name, "confidence": CONF_LEVELS.get(str(item.get("confidence", "")).lower(), "Low")}
        score = item.get("confidenceScore")
        if is_int(score) and 0 <= score <= 100:
            clean["confidenceScore"] = score
        out["suggestions"].append(clean)
    return out


def chat_create(c):
    u = c.require_premium()
    title = clean_text(c.json().get("title"), MAX_TITLE, "title") or DEFAULT_TITLE
    if c.conn.execute("SELECT COUNT(*) FROM chats WHERE user_id = ?", (u["id"],)).fetchone()[0] >= MAX_CHATS:
        raise ApiError(400, "Too many saved chats")
    now = int(time.time())
    cur = c.conn.execute("INSERT INTO chats (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                         (u["id"], title, now, now))
    return 201, {"id": cur.lastrowid, "title": title}


def own_chat(c, chat_id):
    u = c.require_premium()
    row = c.conn.execute("SELECT * FROM chats WHERE id = ? AND user_id = ?", (chat_id, u["id"])).fetchone()
    if row is None:
        raise ApiError(404, "Not found")
    return row


def chat_get(c, chat_id):
    ch = own_chat(c, chat_id)
    msgs = []
    for r in c.conn.execute("SELECT role, content, meta_json, created_at FROM chat_messages WHERE chat_id = ? ORDER BY id",
                            (ch["id"],)):
        try:
            meta = json.loads(r["meta_json"]) if r["meta_json"] else None
        except ValueError:
            meta = None
        msgs.append({"role": r["role"], "content": r["content"], "meta": meta, "createdAt": iso(r["created_at"])})
    return 200, {"id": ch["id"], "title": ch["title"], "messages": msgs}


def message_create(c, chat_id):
    ch = own_chat(c, chat_id)
    b = c.json()
    role = b.get("role")
    if role not in ("user", "assistant"):
        raise ApiError(400, "Invalid role", "role")
    content = b.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ApiError(400, "Content is required", "content")
    content = CTRL_RX.sub("", content.replace("\r\n", "\n")).strip()
    if len(content) > MAX_MESSAGE:
        raise ApiError(400, "Content is too long (max %d characters)" % MAX_MESSAGE, "content")
    if not utf8_ok(content):
        raise ApiError(400, "Invalid content", "content")
    meta = b.get("meta")
    meta_json = None
    if meta is not None:
        if not isinstance(meta, (dict, list)):
            raise ApiError(400, "Invalid meta", "meta")
        meta_json = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
        if len(meta_json.encode("utf-8")) > MAX_META:
            raise ApiError(400, "Meta is too large (max 4 KB)", "meta")
    if role == "assistant":
        if _SANITIZE is None:
            raise ApiError(503, "Assistant filter unavailable")
        clean, emergency = _SANITIZE(content, guess_lang(content))
        if clean is None:
            raise ApiError(400, "This message cannot be saved", "content")
        content = clean[:MAX_MESSAGE]
        meta = clean_assistant_meta(meta, emergency)
    else:
        meta = None  # user turns: plain text, no meta
    meta_json = json.dumps(meta, ensure_ascii=False, separators=(",", ":")) if meta is not None else None
    now = int(time.time())
    c.conn.execute("BEGIN IMMEDIATE")
    try:
        n_user, n_all = c.conn.execute("SELECT SUM(role = 'user'), COUNT(*) FROM chat_messages WHERE chat_id = ?",
                                       (ch["id"],)).fetchone()
        if n_all >= MAX_CHAT_MESSAGES:
            raise ApiError(400, "This chat is full")
        new_bytes = len(content.encode("utf-8")) + (len(meta_json.encode("utf-8")) if meta_json else 0)
        chats_now = chat_bytes(c.conn, ch["user_id"])
        if chats_now + new_bytes > MAX_CHAT_STORAGE or \
                file_bytes(c.conn, ch["user_id"]) + chats_now + new_bytes > QUOTA_BYTES:
            raise ApiError(413, "Chat history storage full")
        c.conn.execute("INSERT INTO chat_messages (chat_id, role, content, meta_json, created_at) VALUES (?, ?, ?, ?, ?)",
                       (ch["id"], role, content, meta_json, now))
        title = ch["title"]
        if role == "user" and not n_user and title == DEFAULT_TITLE:
            title = re.sub(r"\s+", " ", content)[:60].strip() or DEFAULT_TITLE
        c.conn.execute("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?", (title, now, ch["id"]))
        c.conn.execute("COMMIT")
    except Exception:
        c.conn.execute("ROLLBACK")
        raise
    return 201, {"message": {"role": role, "content": content, "meta": meta, "createdAt": iso(now)},
                 "chat": {"id": ch["id"], "title": title}}


def chat_delete(c, chat_id):
    ch = own_chat(c, chat_id)
    c.conn.execute("DELETE FROM chats WHERE id = ? AND user_id = ?", (ch["id"], ch["user_id"]))
    return 204, None


# ---------------------------------------------------------------- routing
ID = r"([0-9]{1,12})"
ROUTES = [
    ("POST", r"/api/auth/signup", signup),
    ("POST", r"/api/auth/login", login),
    ("POST", r"/api/auth/logout", logout),
    ("GET", r"/api/me", me),
    ("GET", r"/api/reviews/summary", review_summary),
    ("GET", r"/api/reviews", reviews_list),
    ("POST", r"/api/reviews", review_create),
    ("GET", r"/api/premium/plans", premium_plans),
    ("POST", r"/api/premium/checkout", premium_checkout),
    ("POST", r"/api/premium/cancel", premium_cancel),
    ("GET", r"/api/favorites", favorites_get),
    ("POST", r"/api/favorites", favorite_add),
    ("DELETE", r"/api/favorites/" + ID, favorite_delete),
    ("GET", r"/api/distinctions", distinctions),
    ("GET", r"/api/cloud", cloud_get),
    ("POST", r"/api/cloud/folders", folder_create),
    ("DELETE", r"/api/cloud/folders/" + ID, folder_delete),
    ("POST", r"/api/cloud/files", file_create),
    ("DELETE", r"/api/cloud/files/" + ID, file_delete),
    ("GET", r"/api/chats", chats_list),
    ("POST", r"/api/chats", chat_create),
    ("GET", r"/api/chats/" + ID, chat_get),
    ("DELETE", r"/api/chats/" + ID, chat_delete),
    ("POST", r"/api/chats/" + ID + r"/messages", message_create),
]
ROUTES = [(m, re.compile(p), f) for m, p, f in ROUTES]


def match(method, path):
    """-> (func, args) | ("405", None) | (None, None)."""
    seen = False
    for m, rx, f in ROUTES:
        mm = rx.fullmatch(path)
        if mm:
            seen = True
            if m == method:
                return f, [int(x) for x in mm.groups()]
    return ("405", None) if seen else (None, None)


def handles(path):
    return path.startswith("/api/") and path != "/api/chat"


def _read_body(h, method):
    """JSON body (POST only) with the existing 32 KB cap. Empty body -> {}."""
    te = h.headers.get("Transfer-Encoding")
    cl = h.headers.get("Content-Length")
    if te:
        raise ApiError(411, "length required")
    try:
        length = int(cl) if cl is not None else 0
    except ValueError:
        raise ApiError(400, "bad request")
    if length < 0:
        raise ApiError(400, "bad request")
    if length > MAX_BODY:
        h.close_connection = True
        raise ApiError(413, "request too large")
    if length == 0:
        return {}
    try:
        raw = h.rfile.read(length)
    except OSError:  # includes socket timeouts
        raw = b""
    if len(raw) != length:
        h.close_connection = True
        raise ApiError(400, "incomplete body")
    if method != "POST":
        return {}
    ctype = (h.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    if ctype != "application/json":
        raise ApiError(415, "unsupported media type")
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise ApiError(400, "invalid json")
    if not isinstance(data, dict):
        raise ApiError(400, "invalid body")
    if not body_text_ok(data):
        raise ApiError(400, "invalid text")
    return data


def csrf_ok(h, allowed_origins):
    """State-changing requests: custom header (forces a CORS preflight, which is denied) AND Origin
    absent or same-site AND Sec-Fetch-Site (when sent) same-origin."""
    if h.headers.get(CSRF_HEADER) != CSRF_VALUE:
        return False
    origin = h.headers.get("Origin")
    if origin is not None and origin not in allowed_origins:
        return False
    sfs = h.headers.get("Sec-Fetch-Site")
    if sfs is not None and sfs not in ("same-origin", "none"):
        return False
    return True


def send(h, status, obj, set_cookie=None, note=""):
    body = b"" if obj is None else json.dumps(obj, ensure_ascii=False).encode("utf-8")
    h.send_response_only(status)
    if obj is not None:
        h.send_header("Content-Type", "application/json; charset=utf-8")
    h.send_header("Content-Length", str(len(body)))
    h.send_header("Cache-Control", "no-store")
    if set_cookie:
        h.send_header("Set-Cookie", set_cookie)
    h.end_headers()
    if body and h.command != "HEAD":
        h.wfile.write(body)
    h.log_line(status, note)


def handle(h, method, allowed_origins):
    """Entry point from proxy.py (Host already checked). Never leaks stack traces."""
    raw_path = h.path.split("#", 1)[0]
    path, _, qs = raw_path.partition("?")
    func, args = match(method, path)
    if func is None:
        return send(h, 404, {"error": "not found"})
    origin = h.headers.get("Origin")
    if origin is not None and origin not in allowed_origins:
        h.close_connection = True
        return send(h, 403, {"error": "forbidden"}, note="origin not allowed")
    if method in ("POST", "DELETE") and not csrf_ok(h, allowed_origins):
        h.close_connection = True
        return send(h, 403, {"error": "forbidden"}, note="csrf")
    if func == "405":
        return send(h, 405, {"error": "method not allowed"})
    conn = None
    c = None
    try:
        body = _read_body(h, method) if method in ("POST", "DELETE") else None
        try:
            query = parse_qs(qs, max_num_fields=10)
        except ValueError:
            raise ApiError(400, "bad request")
        conn = db.connect()
        c = Ctx(h, method, path, query, conn)
        c.body = body
        status, obj = func(c, *args)
        send(h, status, obj, c.set_cookie)
    except ApiError as e:
        obj = {"error": e.error}
        if e.field:
            obj["field"] = e.field
        send(h, e.status, obj, c.set_cookie if c else None, e.note)
    except Exception as e:  # no stack trace, no details
        try:
            if conn is not None and conn.in_transaction:
                conn.execute("ROLLBACK")
        except Exception:
            pass
        send(h, 500, {"error": "internal error"}, note="error=%s" % type(e).__name__)
    finally:
        if conn is not None:
            conn.close()
