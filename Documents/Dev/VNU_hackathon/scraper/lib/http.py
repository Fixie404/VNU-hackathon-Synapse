"""Polite, cached HTTP fetching shared by all MedIndex adapters.

Public API:
    USER_AGENT
    fetch(url, *, binary=False) -> str | bytes
    allowed(url) -> bool
    RobotsDisallowed, OfflineCacheMiss, HTTPStatusError

Behaviour:
  * Every response body is cached raw in scraper/cache/. A cache hit never
    touches the network (and does not re-check robots.txt).
  * On a cache miss: robots.txt for the host is consulted (fetched once per
    host with the same User-Agent and cached too), then a single global rate
    limit of 1 request / 2 s is enforced across all threads, adapters and hosts.
  * MEDINDEX_OFFLINE=1 turns every cache miss into an OfflineCacheMiss error.
"""

from __future__ import annotations

import hashlib
import os
import re
import sys
import threading
import time
import urllib.robotparser
from urllib.parse import urlsplit, urlunsplit

import requests

USER_AGENT = "MedIndex-hackathon-demo (+educational, contact: hackathon demo)"

TIMEOUT_S = 20
MIN_INTERVAL_S = 2.0

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cache")


class RobotsDisallowed(Exception):
    """robots.txt forbids fetching this URL for our User-Agent."""


class OfflineCacheMiss(Exception):
    """MEDINDEX_OFFLINE=1 and the URL is not in the cache."""


class HTTPStatusError(Exception):
    """The server answered with a status code >= 400."""

    def __init__(self, url: str, status: int):
        super().__init__(f"HTTP {status} for {url}")
        self.url = url
        self.status = status


# --------------------------------------------------------------------------
# internals

_rate_lock = threading.Lock()
_last_request_at = 0.0

_robots_lock = threading.Lock()
_robots: dict[str, urllib.robotparser.RobotFileParser] = {}

_session_local = threading.local()


def _session() -> requests.Session:
    s = getattr(_session_local, "session", None)
    if s is None:
        s = requests.Session()
        s.headers["User-Agent"] = USER_AGENT
        _session_local.session = s
    return s


def _offline() -> bool:
    return os.environ.get("MEDINDEX_OFFLINE", "").strip() == "1"


def _log(msg: str) -> None:
    print(f"[http] {msg}", file=sys.stderr, flush=True)


def _host_key(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc.lower()}"


def _cache_path(url: str, binary: bool) -> str:
    parts = urlsplit(url)
    host = re.sub(r"[^A-Za-z0-9.-]+", "_", parts.netloc.lower()) or "nohost"
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()
    ext = os.path.splitext(parts.path)[1].lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,6}", ext or ""):
        ext = ".bin" if binary else ".html"
    return os.path.join(CACHE_DIR, f"{host}_{digest}{ext}")


def _rate_limited_get(url: str) -> requests.Response:
    """GET with the global 1 req / 2 s limit. Holds the lock while waiting so
    concurrent callers are serialised."""
    global _last_request_at
    with _rate_lock:
        wait = _last_request_at + MIN_INTERVAL_S - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        started = time.monotonic()
        try:
            resp = _session().get(url, timeout=TIMEOUT_S)
        finally:
            _last_request_at = time.monotonic()
        _log(f"GET {url} -> {resp.status_code} ({len(resp.content)} B, {time.monotonic() - started:.1f}s)")
        return resp


def _write_cache(path: str, body: bytes) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = f"{path}.tmp{os.getpid()}.{threading.get_ident()}"
    with open(tmp, "wb") as f:
        f.write(body)
    os.replace(tmp, path)


def _decode(body: bytes) -> str:
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        pass
    m = re.search(rb"""charset=["']?([A-Za-z0-9_-]+)""", body[:4096])
    if m:
        try:
            return body.decode(m.group(1).decode("ascii"))
        except (LookupError, UnicodeDecodeError):
            pass
    return body.decode("cp1252", errors="replace")


def _robots_for(url: str) -> urllib.robotparser.RobotFileParser:
    key = _host_key(url)
    with _robots_lock:
        rp = _robots.get(key)
        if rp is not None:
            return rp
        robots_url = key + "/robots.txt"
        path = _cache_path(robots_url, binary=False)
        if os.path.exists(path):
            with open(path, "rb") as f:
                text = _decode(f.read())
        else:
            if _offline():
                raise OfflineCacheMiss(f"robots.txt not cached for {key} (MEDINDEX_OFFLINE=1)")
            resp = _rate_limited_get(robots_url)
            if resp.status_code in (401, 403):
                # Same convention as urllib.robotparser: access denied -> disallow all.
                text = "User-agent: *\nDisallow: /\n"
            elif resp.status_code >= 400:
                # No robots.txt (404 etc.) -> everything allowed.
                text = ""
            else:
                text = _decode(resp.content)
            _write_cache(path, text.encode("utf-8"))
        rp = urllib.robotparser.RobotFileParser(robots_url)
        rp.parse(text.splitlines())
        _robots[key] = rp
        return rp


# --------------------------------------------------------------------------
# public API

def allowed(url: str) -> bool:
    """True if robots.txt for the URL's host allows USER_AGENT to fetch it.
    May fetch (and cache) robots.txt; raises OfflineCacheMiss offline if it
    is not cached."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError(f"not an absolute http(s) URL: {url!r}")
    return _robots_for(url).can_fetch(USER_AGENT, url)


def fetch(url: str, *, binary: bool = False) -> str | bytes:
    """Return the body of `url` (str, or bytes if binary=True), from cache if
    possible. Raises RobotsDisallowed, OfflineCacheMiss, HTTPStatusError, or a
    requests exception on network errors/timeouts."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError(f"not an absolute http(s) URL: {url!r}")
    url = urlunsplit(parts._replace(fragment=""))

    path = _cache_path(url, binary)
    if os.path.exists(path):
        with open(path, "rb") as f:
            body = f.read()
        return body if binary else _decode(body)

    if _offline():
        raise OfflineCacheMiss(f"not cached: {url} (MEDINDEX_OFFLINE=1)")

    if not allowed(url):
        raise RobotsDisallowed(f"robots.txt disallows {url} for {USER_AGENT!r}")

    resp = _rate_limited_get(url)
    if resp.status_code >= 400:
        raise HTTPStatusError(url, resp.status_code)

    body = resp.content
    _write_cache(path, body)
    if binary:
        return body
    # Decode exactly as a later cache hit would, so results are identical
    # whether or not the body came from the network.
    return _decode(body)
