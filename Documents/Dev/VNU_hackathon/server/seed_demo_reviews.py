"""Seed SYNTHETIC demo reviews for the pitch (Python standard library only).

    python3 server/seed_demo_reviews.py [--db server/data/demo.db] [--seed 42] [--remove]

- Creates 10 demo reviewer accounts (demo_reviewer_01..10, users.is_demo = 1, unusable password hash:
  they can never log in) and exactly one review per account for EVERY doctor in data/doctors.js
  (reviews.is_demo = 1, neutral generic bilingual comments that claim nothing about the doctor).
- At least 10 doctors (picked with the same RNG) get an average >= 4.8 (eight 5s + two 4s).
- Deterministic for a given --seed (and the same UTC day: dates are spread over the 90 days before
  today's 00:00 UTC). Re-running replaces the previous demo reviews; --remove deletes them all.
- Also writes server/data/demo-reviews.json and data/demo-reviews.js (window.DEMO_REVIEWS, for the
  static site). Both are gitignored and must never be published.
- Refuses to touch the real database (server/data/medindex.db) unless --i-know-this-is-the-real-db.
"""
import argparse
import datetime
import json
import os
import random
import re
import secrets
import statistics
import sys

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SERVER_DIR)
sys.path.insert(0, SERVER_DIR)

import auth  # noqa: E402
import db  # noqa: E402

DEFAULT_DB = os.path.join(SERVER_DIR, "data", "demo.db")
DEFAULT_JSON = os.path.join(SERVER_DIR, "data", "demo-reviews.json")
DEFAULT_JS = os.path.join(REPO_ROOT, "data", "demo-reviews.js")
REAL_DB = os.path.realpath(db.DEFAULT_DB)
N_REVIEWERS = 10
N_TOP = 10
DAYS = 90

COMMENTS = {  # generic, labeled, no facts about any doctor
    "high": ["Demo: good experience overall.", "Recenzie demo: experienta buna per total.",
             "Demo review for the pitch.", "Recenzie demo."],
    "mid": ["Demo: average visit.", "Recenzie demo: vizita obisnuita.", "Demo review for the pitch."],
    "low": ["Demo: below expectations.", "Recenzie demo: sub asteptari.", "Recenzie demo."],
}


def load_doctors():
    with open(os.path.join(REPO_ROOT, "data", "doctors.js"), encoding="utf-8") as fh:
        src = fh.read()
    m = re.search(r"window\.DOCTORS\s*=\s*(\[.*?\n\]);", src, re.S)
    docs = json.loads(m.group(1))
    return sorted(((d["id"], d.get("name") or "") for d in docs), key=lambda x: x[0])


def comment_for(rng, stars):
    return rng.choice(COMMENTS["high" if stars >= 4 else "mid" if stars == 3 else "low"])


def top_pattern(real_sum, real_n):
    """Demo stars that give an overall avg >= 4.8 together with the doctor's REAL reviews, or None."""
    for stars in ([5] * 8 + [4] * 2, [5] * 9 + [4], [5] * 10):
        if (real_sum + sum(stars)) * 10 >= 48 * (real_n + len(stars)):  # integer math: avg >= 4.8
            return stars
    return None


def generate(doctors, seed, real):
    """real: {doctor_id: (sum_stars, count)} of the non-demo reviews already in the DB."""
    rng = random.Random(seed)
    ids = [d for d, _ in doctors]
    top = {}
    for did in rng.sample(ids, len(ids)):  # deterministic candidate order
        pat = top_pattern(*real.get(did, (0, 0)))
        if pat is not None:
            top[did] = pat
            if len(top) == N_TOP:
                break
    anchor = datetime.datetime.now(datetime.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    anchor_ts = int(anchor.timestamp())
    out = []
    for did in ids:
        if did in top:
            stars = list(top[did])
            rng.shuffle(stars)
        else:
            stars = [rng.randint(1, 5) for _ in range(N_REVIEWERS)]
        for i, s in enumerate(stars):
            ts = anchor_ts - rng.randint(1, DAYS * 86400)
            out.append({"doctorId": did, "reviewer": "demo_reviewer_%02d" % (i + 1), "stars": s,
                        "comment": comment_for(rng, s),
                        "createdAt": datetime.datetime.fromtimestamp(ts, datetime.timezone.utc)
                        .strftime("%Y-%m-%dT%H:%M:%SZ"), "_ts": ts})
    return out


def write_private(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def demo_users(conn):
    return conn.execute("SELECT id, username FROM users WHERE is_demo = 1").fetchall()


def remove(conn):
    conn.execute("BEGIN IMMEDIATE")
    nr = conn.execute("DELETE FROM reviews WHERE is_demo = 1 OR user_id IN "
                      "(SELECT id FROM users WHERE is_demo = 1)").rowcount
    nu = conn.execute("DELETE FROM users WHERE is_demo = 1").rowcount
    conn.execute("COMMIT")
    return nr, nu


def ensure_reviewers(conn):
    ids = {}
    for i in range(1, N_REVIEWERS + 1):
        uname = "demo_reviewer_%02d" % i
        row = conn.execute("SELECT id, is_demo FROM users WHERE username = ?", (uname,)).fetchone()
        if row is not None and not row["is_demo"]:
            raise SystemExit("error: a REAL account named %r exists; refusing to touch it" % uname)
        if row is None:
            # "!demo..." is not a valid scrypt$... record, so verify_password() always fails
            cur = conn.execute("INSERT INTO users (username, display_name, pw_hash, created_at, is_demo) "
                               "VALUES (?, ?, ?, strftime('%s','now'), 1)",
                               (uname, "Demo Reviewer %d" % i, "!demo-unusable!" + secrets.token_hex(16)))
            ids[uname] = cur.lastrowid
        else:
            ids[uname] = row["id"]
    return ids


def main():
    ap = argparse.ArgumentParser(description="Seed SYNTHETIC, labeled demo reviews (pitch only).")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--remove", action="store_true", help="delete all demo reviews + demo accounts")
    ap.add_argument("--json", default=DEFAULT_JSON, help="JSON export path")
    ap.add_argument("--js", default=DEFAULT_JS, help="static-site export path (window.DEMO_REVIEWS)")
    ap.add_argument("--i-know-this-is-the-real-db", dest="real_ok", action="store_true")
    a = ap.parse_args()

    path = os.path.abspath(a.db)
    if os.path.realpath(path) == REAL_DB and not a.real_ok:
        sys.stderr.write("error: refusing to write synthetic demo reviews into the REAL database %s\n"
                         "       use --db server/data/demo.db (default), or pass --i-know-this-is-the-real-db\n"
                         % path)
        return 2
    db.DB_PATH = path
    db.init(auth.hash_password)
    conn = db.connect()
    try:
        if a.remove:
            nr, nu = remove(conn)
            gone = [p for p in (a.json, a.js) if os.path.exists(p)]
            for p in gone:
                os.remove(p)
            print("removed %d demo reviews, %d demo accounts, %d export file(s) from %s" % (nr, nu, len(gone), path))
            return 0

        doctors = load_doctors()
        names = dict(doctors)
        real = {r[0]: (r[1], r[2]) for r in conn.execute(
            "SELECT doctor_id, SUM(stars), COUNT(*) FROM reviews WHERE is_demo = 0 AND user_id NOT IN "
            "(SELECT id FROM users WHERE is_demo = 1) GROUP BY doctor_id")}
        rows = generate(doctors, a.seed, real)
        conn.execute("BEGIN IMMEDIATE")
        try:
            uids = ensure_reviewers(conn)
            conn.execute("DELETE FROM reviews WHERE is_demo = 1 OR user_id IN (SELECT id FROM users WHERE is_demo = 1)")
            conn.executemany("INSERT INTO reviews (user_id, doctor_id, stars, comment, created_at, is_demo) "
                             "VALUES (?, ?, ?, ?, ?, 1)",
                             [(uids[r["reviewer"]], r["doctorId"], r["stars"], r["comment"], r["_ts"]) for r in rows])
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        n = conn.execute("SELECT COUNT(*) FROM reviews WHERE is_demo = 1").fetchone()[0]
        avgs = {r[0]: r[1] for r in conn.execute("SELECT doctor_id, AVG(stars) FROM reviews GROUP BY doctor_id")}
    finally:
        conn.close()

    export = [{k: v for k, v in r.items() if k != "_ts"} for r in rows]
    write_private(a.json, json.dumps(export, ensure_ascii=False, indent=1) + "\n")
    import api  # author masking identical to GET /api/reviews
    by_doc = {}
    for r in sorted(rows, key=lambda r: (-r["_ts"], r["reviewer"])):
        n_ = int(r["reviewer"][-2:])
        by_doc.setdefault(str(r["doctorId"]), []).append(
            {"stars": r["stars"], "comment": r["comment"], "createdAt": r["createdAt"], "demo": True,
             "author": api.author_name(0, "Demo Reviewer %d" % n_)})
    ratings = {}
    for did, lst in by_doc.items():
        ratings[did] = {"avg": round(sum(x["stars"] for x in lst) / len(lst), 2), "count": len(lst)}
    payload = {"generatedFor": "presentation", "demo": True, "seed": a.seed, "ratings": ratings, "reviews": by_doc}
    write_private(a.js, "// SYNTHETIC demo reviews for the pitch (server/seed_demo_reviews.py). Gitignored; "
                  "never publish.\nwindow.DEMO_REVIEWS = " + json.dumps(payload, ensure_ascii=False) + ";\n")

    vals = sorted(avgs.values())
    top = sorted(d for d, v in avgs.items() if v >= 4.8 - 1e-9)
    print("db: %s" % path)
    print("demo reviews inserted: %d (%d doctors x %d)" % (n, len(doctors), N_REVIEWERS))
    print("doctors with avg >= 4.8: %d" % len(top))
    print("averages: min %.2f / median %.2f / max %.2f" % (vals[0], statistics.median(vals), vals[-1]))
    for d in top:
        print("  #%d %s (avg %.2f)" % (d, names.get(d, "?"), avgs[d]))
    print("exports: %s, %s" % (a.json, a.js))
    return 0


if __name__ == "__main__":
    sys.exit(main())
