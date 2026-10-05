"""Synapse accounts: password hashing, sessions, identifier normalization, rate limiting.

- Passwords: hashlib.scrypt (n=2**14, r=8, p=1, 16-byte random salt), stored as
  "scrypt$n$r$p$salt_hex$hash_hex" and verified with hmac.compare_digest.
- Sessions: secrets.token_urlsafe(32) in the "mi_session" cookie (HttpOnly; SameSite=Strict;
  Path=/; 7 days). Only the SHA-256 of the token is stored.
"""
import collections
import hashlib
import hmac
import re
import secrets
import threading
import time

SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_DKLEN = 2 ** 14, 8, 1, 32
PW_MIN, PW_MAX = 8, 128

COOKIE_NAME = "mi_session"
SESSION_TTL = 7 * 24 * 3600
MAX_SESSIONS = 10            # per user; the oldest are deleted on login
TOKEN_RX = re.compile(r"^[A-Za-z0-9_-]{32,128}$")

EMAIL_RX = re.compile(r"^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
                      r"@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
USERNAME_RX = re.compile(r"^[A-Za-z0-9._]{3,32}$")


# ---------------------------------------------------------------- passwords
def hash_password(password):
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=SCRYPT_DKLEN)
    return "scrypt$%d$%d$%d$%s$%s" % (SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.hex(), dk.hex())


_DUMMY_HASH = None


def verify_password(password, encoded):
    """Constant-time compare. With encoded=None a dummy hash is checked (same timing as a real user)."""
    global _DUMMY_HASH
    if encoded is None:
        if _DUMMY_HASH is None:
            _DUMMY_HASH = hash_password(secrets.token_hex(16))
        encoded, real = _DUMMY_HASH, False
    else:
        real = True
    try:
        algo, n, r, p, salt_hex, hash_hex = encoded.split("$")
        if algo != "scrypt":
            return False
        n, r, p = int(n), int(r), int(p)
        if n > 2 ** 20 or r > 16 or p > 4:
            return False
        expected = bytes.fromhex(hash_hex)
        dk = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex), n=n, r=r, p=p,
                            dklen=len(expected), maxmem=256 * 1024 * 1024)
    except (ValueError, TypeError, MemoryError):
        return False
    return hmac.compare_digest(dk, expected) and real


def password_error(pw):
    if isinstance(pw, str):
        try:
            pw.encode("utf-8")
        except UnicodeEncodeError:
            return "Password contains invalid characters"
    if not isinstance(pw, str) or len(pw) < PW_MIN:
        return "Password must be at least %d characters" % PW_MIN
    if len(pw) > PW_MAX:
        return "Password must be at most %d characters" % PW_MAX
    return None


# ---------------------------------------------------------------- identifiers
def normalize_email(s):
    s = s.strip().lower()
    if len(s) > 254 or "@" not in s:
        return None
    local = s.rsplit("@", 1)[0]
    if not local or len(local) > 64 or not EMAIL_RX.match(s):
        return None
    return s


PHONE_CHARS_RX = re.compile(r"\+?[0-9 ()./-]+")


def looks_like_phone(s):
    """Same character rule for classify() and normalize_phone(): optional leading +, then digits and
    spaces ( ) . / - only, at least one digit."""
    s = s.strip()
    return bool(PHONE_CHARS_RX.fullmatch(s)) and any(ch.isdigit() for ch in s)


def normalize_phone(s):
    """07xxxxxxxx / +407xxxxxxxx / 00407xxxxxxxx (spaces, dashes, dots, slashes, parens allowed, e.g.
    "(07)12.345-678") -> +407xxxxxxxx; also any international +<8-15 digits> (or 00<8-15 digits>)."""
    s = s.strip()
    if not looks_like_phone(s):
        return None
    d = re.sub(r"[ ()./-]", "", s)
    if re.fullmatch(r"07[0-9]{8}", d):
        return "+4" + d
    if d.startswith("00"):
        d = "+" + d[2:]
    if re.match(r"^\+40", d):
        return d if re.fullmatch(r"\+40[0-9]{9}", d) else None
    if re.fullmatch(r"\+[1-9][0-9]{7,14}", d):
        return d
    return None


def classify(identifier, allow_username):
    """-> (type, normalized) or (None, None). type: "email" | "phone" | "username"."""
    if not isinstance(identifier, str):
        return None, None
    s = identifier.strip()
    if not s or len(s) > 254:
        return None, None
    if "@" in s:
        e = normalize_email(s)
        return ("email", e) if e else (None, None)
    if looks_like_phone(s):
        p = normalize_phone(s)
        if p:
            return "phone", p
        if not allow_username:
            return None, None
    if allow_username and USERNAME_RX.match(s):
        return "username", s.lower()
    return None, None


def mask_identifier(kind, value):
    if kind == "email":
        local, domain = value.rsplit("@", 1)
        shown = local[0] + "***" + (local[-1] if len(local) > 2 else "")
        return shown + "@" + domain
    if kind == "phone":
        return value[:3] + "*" * max(len(value) - 6, 3) + value[-3:]
    return value


# ---------------------------------------------------------------- sessions
def token_hash(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def read_cookie_token(cookie_header):
    if not cookie_header:
        return None
    for part in cookie_header.split(";"):
        k, _, v = part.strip().partition("=")
        if k == COOKIE_NAME:
            v = v.strip().strip('"')
            return v if TOKEN_RX.match(v) else None
    return None


def session_cookie(token):
    return "%s=%s; HttpOnly; SameSite=Strict; Path=/; Max-Age=%d" % (COOKIE_NAME, token, SESSION_TTL)


def clear_cookie():
    return "%s=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" % COOKIE_NAME


def create_session(conn, user_id, old_token=None):
    """New random token (rotation: the presented old token, if any, is deleted)."""
    now = int(time.time())
    if old_token:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(old_token),))
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
    token = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)",
                 (token_hash(token), user_id, now, now + SESSION_TTL, now))
    conn.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions "
                 "WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)", (user_id, user_id, MAX_SESSIONS))
    return token


def session_user(conn, token):
    """-> users row or None. Expired sessions are deleted."""
    if not token:
        return None
    th = token_hash(token)
    now = int(time.time())
    row = conn.execute("SELECT s.expires_at, s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id "
                       "WHERE s.token_hash = ?", (th,)).fetchone()
    if row is None:
        return None
    if row["expires_at"] < now:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (th,))
        return None
    if now - row["last_seen"] > 60:
        conn.execute("UPDATE sessions SET last_seen = ? WHERE token_hash = ?", (now, th))
    return row


def delete_session(conn, token):
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))


# ---------------------------------------------------------------- rate limiting (in memory)
class RateLimiter:
    """Sliding window: at most `limit` events per `window` seconds per key."""

    def __init__(self, limit, window):
        self.limit, self.window = limit, window
        self.events = collections.defaultdict(collections.deque)
        self.lock = threading.Lock()

    def _prune(self, q, now):
        while q and q[0] <= now - self.window:
            q.popleft()

    def blocked(self, key):
        now = time.time()
        with self.lock:
            q = self.events.get(key)
            if not q:
                return False
            self._prune(q, now)
            return len(q) >= self.limit

    def try_acquire(self, key):
        """Atomically: if under the limit, record an event and return its timestamp; else None."""
        now = time.time()
        with self.lock:
            q = self.events[key]
            self._prune(q, now)
            if len(q) >= self.limit:
                return None
            q.append(now)
            return now

    def release(self, key, ts):
        with self.lock:
            q = self.events.get(key)
            if q:
                try:
                    q.remove(ts)
                except ValueError:
                    pass

    def hit(self, key):
        now = time.time()
        with self.lock:
            q = self.events[key]
            self._prune(q, now)
            q.append(now)
            if len(self.events) > 10000:  # bound memory
                for k in [k for k, v in self.events.items() if not v or v[-1] <= now - self.window]:
                    del self.events[k]


WINDOW = 5 * 60
LIMIT_PER_IDENTIFIER = 10   # login failures / signup attempts per identifier per 5 min
LIMIT_PER_IP = 30           # login failures / signup attempts per client IP per 5 min
login_ip = RateLimiter(LIMIT_PER_IP, WINDOW)
login_id = RateLimiter(LIMIT_PER_IDENTIFIER, WINDOW)
signup_ip = RateLimiter(LIMIT_PER_IP, WINDOW)
signup_id = RateLimiter(LIMIT_PER_IDENTIFIER, WINDOW)


def reserve(limiter_a, key_a, limiter_b, key_b):
    """Reserve one slot in both limiters BEFORE doing the expensive check (no check-then-act race).
    -> list of (limiter, key, ts) to pass to refund(), or None when either limit is reached."""
    ta = limiter_a.try_acquire(key_a)
    if ta is None:
        return None
    tb = limiter_b.try_acquire(key_b)
    if tb is None:
        limiter_a.release(key_a, ta)
        return None
    return [(limiter_a, key_a, ta), (limiter_b, key_b, tb)]


def refund(slots):
    for limiter, key, ts in slots or []:
        limiter.release(key, ts)
