# Synapse local server + Kimi proxy

Synapse was formerly called MedIndex. Some technical names keep the old name on purpose: the CSRF header value `X-Requested-With: MedIndex`, the `mi_session` cookie, the `server/data/medindex.db` file, the `MEDINDEX_DB` variable and the distinctions `basis: "medindex_reviews"`.

`proxy.py` serves the static site and turns the assistant into **Synapse Assistant**, a medical-information chatbot powered by Kimi (Moonshot AI).
It also serves the account API (`api.py`, `auth.py`, `db.py`): sign-up/login, doctor reviews, a demo Premium subscription, a metadata-only "cloud" and saved chats, stored in SQLite.
It uses only the Python 3 standard library, so there is nothing to install.

## Run

```sh
python3 server/proxy.py        # from the repo root
```

Then open **http://127.0.0.1:8000** (or http://localhost:8000). **AI mode needs this address**: the page calls the same-origin `/api/chat`.

If you double-click `index.html` (a `file://` page), the assistant runs in **rule mode**: it sends nothing and shows "For AI answers, run the local server and open http://127.0.0.1:8000".
The proxy never accepts a local-file page (Origin `null`), because any website can send that origin from a sandboxed iframe.

In AI mode, The panel shows the warning "The advice given by our chatbot may be wrong" right above the input, and the note "Your message is sent to an AI service." below it.
To force the old rule-based mode everywhere, set `FORCE_RULES = true` in `assistant/engine.js`.

## How the conversation works

The assistant is a natural chat. To recommend a type of specialist it needs the symptom and three facts: **who** it is for (adult / child under 18), **how long** (less than 3 days / 3 days to 2 weeks / more than 2 weeks) and **how strong** (mild / moderate / severe, or a 1-10 rating).

- It first infers what it can from the user's own words (`extractFacts()` in `assistant/engine.js`, RO + EN, diacritics ignored): "my 6 year old son", "copilul meu", "am 30 de ani", "de 2 zile", "since yesterday", "o lună", "for ages", "destul de tare", "unbearable", "7/10", and short answers to the last question ("adult", "2 zile", "a week", "7").
- Then it asks **one** natural question at a time for the first missing fact (who, then how long, then how strong), never one that is already answered. If the symptom is still unclear it asks an open question about it. The first question says "I have a few quick questions".
- Each fact question also shows optional answer chips (Adult / Child under 18, and so on). A chip just sends its label as a normal message. Typing works the same. Answered chips are disabled, and chips are never shown for a fact that is already known.
- It recommends (1-3 specialties, confidence, "Show doctors", the disclaimer) as soon as everything is known, and **at the 10th user message at the latest**. If the problem is still unclear then, it suggests Family Medicine. A child goes to Pediatrics first. More than 2 weeks or severe changes only the urgency wording, never the specialty.
- After a recommendation the user can keep chatting. A new symptom starts a new round with the same limits, and "who" is kept. "Start over" clears everything.

## How a message is handled

1. **Local red-flag check first.** Emergency signs (for example chest pain with breathlessness) are detected in the browser. The chat shows the red "Call 112" banner and no doctors, and **nothing is sent**.
   After any red flag, whether local or from Kimi, every later message shows the banner again with "If this was a mistake, tap Start over." Nothing is sent and no doctors are shown until Start over.
2. **Kimi.** The conversation (kept in memory only, never stored) goes to `POST /api/chat`, together with the locally extracted facts and the number of user messages in this round. The proxy adds a fixed system prompt and returns `{reply, redFlag, facts, asking, suggestions}`.
   The reply is shown as plain text. Specialty suggestions become cards with a "Show doctors" button, which ranks real doctors from `data/doctors.js`. `asking` ("who", "duration", "severity" or null) tells the page which answer chips to show. The model never sends options, and an old-style `followUp` is dropped.
   If the model is still asking at the 10th message, the page ignores that reply and the rule engine recommends, using the local facts plus the model's valid facts (local facts win).
   If Kimi sets `redFlag` (`true`, `"true"`, `"yes"` or `"1"`), the same 112 banner is shown.
3. **Fallback.** If anything fails (proxy not running, timeout after about 30 s, quota or HTTP error, invalid output), the rule engine answers that message and shows the note "AI is unavailable right now, so this answer uses basic mode." The chat never breaks.

### Output safety filter (proxy `sanitize_reply()`, mirrored in `engine.js` `sanitizeReply()`)

Both files contain the same regex table (`SAFETY_PATTERNS`, between the "generated safety patterns" markers). Change both together.
Matching runs on NFKC-normalized text, so fullwidth digits count, and Arabic-Indic digits are converted to ASCII. The filter over-redacts on purpose.

- **Removed sentences:**
  - doses in digits or words, e.g. "500 mg", "five hundred milligrams", "500 mgs", "1,000 mg", "2 x 250", "zece picături";
  - halves or quarters of a pill ("half a tablet", "jumătate de pastilă");
  - any dosing frequency ("every six hours", "twice daily", "3x/day", "de 3 ori/zi", "la fiecare 8 ore");
  - a common drug name next to a number or a "daily"-type word;
  - give or administer plus a medicine plus a child or baby;
  - stop, quit, come off, skip, "nu mai luați", "opriți" or "renunțați la" followed by any word, except habits like scratching or smoking;
  - start, change or increase a medicine.
- After a removal the line "For medicines and doses, ask a doctor or pharmacist." is added (ro too). If almost nothing is left, the rule engine answers instead.
- Foreign emergency numbers become `112` in the reply and the reasons: 911 in any spelling ("9-1-1", "9 1 1", "nine-one-one"), 999 and 988, and 000, 111 or 101 after "call", "dial" or "sună".
- If the reply mentions 112, an emergency, urgență or an ambulance, `redFlag` is forced to true. Negated phrases such as "not an emergency", "nu este o urgență" or "no need to call 112" don't count.
- Phone numbers, prices ("300 lei", "300 de lei", RON, EUR, $) and doctor names ("Dr. X", "dr. x", "Doctor X", "Prof. X") are removed from the reply and the reasons. Links (http(s)://, www., markdown links) are stripped. Real doctors come only from `data/doctors.js`.
- The output must be a single JSON object, optionally wrapped in a code fence. Prose around it, top-level arrays, and JSON hidden inside `reply` are rejected.

### System prompt guardrails (server-side, the client cannot change them)

- Persona: a friendly health-information helper for patients in Bucharest. It gives general information and safe self-care or what-to-do advice, says how urgent something seems and what to tell the doctor, and explains what specialists do.
- Conversation: it gathers who / how long / how strong conversationally, with one open question per reply. It never gives multiple-choice options and never re-asks a known fact. It recommends by the 10th user message at the latest, and keeps `suggestions` empty while it still has a question.
- The page sends the facts it found and the message count. The proxy keeps only valid enum values and a small integer, and writes the "Conversation state" lines of the system prompt itself. Raw client text never reaches the prompt. At message 10 the state line tells the model to recommend now.
- It is not a doctor and can be wrong. It never gives a definitive diagnosis: it may mention possible causes cautiously, and always together with advice to get a professional evaluation.
- It never gives doses or how often to take a medicine, never prescribes, and never tells anyone to stop, start or change a medication. For children, pregnancy or breastfeeding it never suggests any medicine and always refers to a doctor or pharmacist.
- Emergencies: it sets `redFlag` and tells the user to call 112. It always uses 112, never 911 or 999, and mentions 112 only together with `redFlag`.
- Self-harm: it sets `redFlag`, urges the user to call 112 now and to talk to someone they trust. It gives no other phone numbers.
- It replies in the user's language: Romanian or English, and English for any other language. Replies are about 120 words at most, using short paragraphs or "- " bullets.
- It recommends specialties only from the list of specialties in the dataset. It never invents doctors, clinics or prices, and it stays on health topics.

## API

`POST /api/chat` (JSON, at most 64 KB, so a full 10-message round fits):

```json
{ "conversationId": "3f9c...(16-64 chars)", "messages": [{"role": "user", "content": "...", "n": 0}, {"role": "assistant", "content": "...", "sig": "...", "n": 1}, {"role": "user", "content": "...", "n": 2}],
  "facts": {"who": "adult", "duration": "lt3d"}, "turn": 2, "availableSpecialties": ["Dermatology", "..."], "lang": "en" }
```

- Only the roles `user` and `assistant` are accepted. A `system` message gets a 400. The last message must come from the user.
- **Signed assistant turns:** the client sends a random `conversationId` per chat (new on Start over) and an increasing index `n` on every message. Indexes must strictly increase; a duplicated or reordered turn gets a 400.
  Every response carries `sig`, an HMAC-SHA256 over (conversationId, index of the reply = last `n` + 1, role, reply) made with a random per-process secret. The client sends it back as `{"role": "assistant", "content": reply, "sig": ..., "n": ...}`.
  Assistant turns without a valid signature for that conversation and position are dropped, so turns can't be forged, replayed into another chat, or moved. All signatures become invalid when the server restarts, and older turns are then simply dropped.
- Only the last 24 messages are forwarded (a full 10-message round with replies), and each one is cut to 1500 characters.
- `facts` keeps only `who` (adult/child), `duration` (lt3d/3d2w/gt2w) and `severity` (mild/moderate/severe). Other values are dropped, and anything that is not an object gets a 400. The older `answers` key is still accepted. `turn` is the user-message count of the round (an integer from 1 to 50; anything else is ignored).
- `availableSpecialties` only narrows the server's own list, which is parsed once from `data/doctors.js` at startup. Client strings never reach the prompt.
- Response: `{"reply": "...", "redFlag": false, "facts": {"who": "adult"|"child"|null, "duration": "lt3d"|"3d2w"|"gt2w"|null, "severity": "mild"|"moderate"|"severe"|null}, "asking": "who"|"duration"|"severity"|null, "suggestions": [{"specialty", "reason", "confidence"}], "sig": "..."}`.
  The proxy and the browser both drop invalid `facts` and `asking` values. `asking` is null when there are suggestions or a red flag.
- Errors: 400 (bad input), 403 (bad Host or Origin), 413 (too large), 415 (not JSON), 502 (upstream failure or invalid model output).
- `/api/chat` itself does not need a login or the `X-Requested-With` header (unchanged).

## Accounts and data

- **Database:** SQLite at `server/data/medindex.db` (gitignored; the directory is created with mode 700, the file is chmod 600). Set `MEDINDEX_DB=/path/to/file.db` to use another file (tests do this).
  The schema is applied with numbered migrations (`PRAGMA user_version`). The server never drops or resets the database.
- **Demo admin:** username `admin`, password `adminboss`, display name "Admin", a Regular (not Premium) account. It is created on startup only if it does not exist, and is never overwritten.
- **Tables:** `users` (username / email / phone, each unique and optional, display name, scrypt hash), `sessions` (SHA-256 of the token only, 7-day expiry), `reviews` (one per user and doctor, 1-5 stars, comment up to 280 chars),
  `subscriptions` (plan monthly/yearly, active flag), `cloud_folders` (per user, unique names, the system folder "ChatBot History"), `cloud_files` (**metadata only**: name, type, size), `chats` and `chat_messages`. Foreign keys are on; deleting a user cascades.
- **Identifiers:** sign-up takes an email (lowercased) or a phone number. `07xxxxxxxx`, `+407xxxxxxxx` and `00407xxxxxxxx` (spaces, dashes, dots allowed) become `+407xxxxxxxx`; other international numbers are accepted as `+` and 8-15 digits.
  Login also accepts a username (letters, digits, `.`, `_`; 3-32 chars, case-insensitive). Passwords are 8-128 characters.

## Account API

All bodies are JSON (32 KB max). Every `POST` / `DELETE` needs the header `X-Requested-With: MedIndex` plus the usual Host/Origin checks, otherwise 403.
Errors look like `{"error": "...", "field": "..."}` (`field` only for input errors). Dates are ISO 8601 UTC strings.

| Endpoint | Auth | Result |
|---|---|---|
| `POST /api/auth/signup {identifier, password, displayName?}` | - | 201 `{user}` + cookie; 400 `{error, field}`; 409 "Account already exists"; 429 |
| `POST /api/auth/login {identifier, password}` | - | 200 `{user}` + new cookie; 401 "Invalid credentials"; 429 |
| `POST /api/auth/logout` | - | 204, session deleted, cookie cleared |
| `GET /api/me` | - | `{user: null}` or `{user: {id, displayName, identifierType, identifierMasked, premium: {active, plan, since, renewsAt}}}` |
| `GET /api/reviews/summary` | - | `{ratings: {"<doctorId>": {avg, count}}, demo}`: `demo` is true when the DB holds any synthetic demo reviews |
| `GET /api/reviews?doctorId=N` | - | `{doctorId, total, shown, limited, limit, mine}`: anonymous and Regular get the newest 5, Premium all (enforced on the server). `author` is masked ("Ana P." / "User #12"); every shown review has `demo: true|false` |
| `POST /api/reviews {doctorId, stars, comment?}` | user | 201 `{review}`; 401; 409 already reviewed; 400 unknown doctor (ids parsed from `data/doctors.js`) or bad stars/comment |
| `GET /api/reviews/mine` | user | 200 `{reviews: [{id, doctorId, stars, comment, createdAt}]}`: the caller's own reviews only, newest first; 401 when logged out |
| `DELETE /api/reviews/<id>` | user | 204 when the review exists **and** belongs to the caller; otherwise 404 (another user's review looks exactly like a missing one; non-ASCII-digit id -> 404); 401 logged out; 403 without the CSRF header. Afterwards the user can review that doctor again |
| `GET /api/premium/plans` | - | monthly 5.99 USD, yearly 65.99 USD |
| `POST /api/premium/checkout {plan, card: {name, number, exp: "MM/YY", cvc}}` | user | 200 `{premium}`; 400 `{error, field: "card.number"...}`. Format checks only (Luhn, future expiry, 3-4 digit CVC). **Card data is never stored or logged.** Creates "ChatBot History" |
| `POST /api/premium/cancel` | user | 200 `{premium}` with `active: false` |
| `GET /api/cloud` | Premium | `{quotaBytes: 5368709120, usedBytes, folders, files, chats}` (chats = the virtual contents of "ChatBot History") |
| `POST /api/cloud/folders {name}` / `DELETE /api/cloud/folders/<id>` | Premium | 201 `{folder}` (409 duplicate) / 204 (system folder: 403; its files' metadata is deleted too) |
| `POST /api/cloud/files {folderId, name, type, size}` / `DELETE /api/cloud/files/<id>` | Premium | 201 `{file, usedBytes}`; 413 "Storage full" past 5 GiB; 400 for "ChatBot History" / 204 |
| `GET /api/chats`, `POST /api/chats {title?}`, `GET /api/chats/<id>`, `POST /api/chats/<id>/messages {role, content, meta?}`, `DELETE /api/chats/<id>` | Premium | list / 201 `{id, title}` / `{id, title, messages}` / 201 / 204. Content up to 4000 chars, `meta` up to 4 KB of JSON. The title comes from the first user message (60 chars) unless one was given |
| `GET /api/favorites` | Premium | `{doctorIds: [int]}`, newest first |
| `POST /api/favorites {doctorId}` | Premium | 201 `{doctorIds}` when added, 200 `{doctorIds}` if it already was a favourite (idempotent); 400 `field: "doctorId"` unless it is an int or ASCII-digit string that exists in `data/doctors.js`; 400 past 500 favourites |
| `DELETE /api/favorites/<doctorId>` | Premium | 200 `{doctorIds}`, also when it was not a favourite (non-digit id -> 404) |
| `GET /api/distinctions` | Premium | `{threshold: 4.5, doctorIds: [int], basis: "medindex_reviews"}`: doctors whose Synapse reviews average >= 4.5 (at least 1 review), sorted by id |

Saved **assistant** turns are re-checked at write time with the same output filter as Kimi replies (`sanitize_reply`: doses, medication changes, doctor names, phones, prices and links removed, 911 -> 112; a reply with nothing left gets a 400), and `meta` is reduced to `{redFlag (strict bool, forced true on emergency wording), suggestions: [{specialty (dataset list only), confidence, confidenceScore 0-100}] (max 3, none with a red flag)}`. User turns are stored as plain text without meta.
Logged out -> 401, not Premium -> 403 (Premium is inactive when cancelled or when `renews_at` has passed). Every object is looked up together with the session's user id, so another user's id gives 404.
The cloud stores **metadata only**: no file content is ever accepted, and nothing is allocated. `usedBytes` = `SUM(size_bytes)` of the files + the UTF-8 bytes of all saved chat messages (content + meta), which are also each chat's `size`.
Limits: 100 folders, 2000 files, 500 chats per user, 500 messages per chat, and 20 MB of saved chat text per user (then 413 "Chat history storage full"). `folderId: null` puts a file at the top level.
**Favourites** (table `favorites(user_id, doctor_id, created_at)`, migration 2) store doctor ids only, never doctor data; ids that disappear from `data/doctors.js` are not returned. They belong to the session user (no endpoint takes a user id). They are kept when Premium lapses but return 403 until Premium is active again, then the same list comes back.
The **Premium distinction** is never stored: every request recomputes `AVG(stars) >= 4.5` from the Synapse `reviews` table (exactly 4.5 qualifies), so a new or deleted review changes it immediately (as it does the summary and the per-doctor list). Published or external ratings are never used.

## Demo reviews for the pitch

**Synthetic data, for the presentation only.** `server/seed_demo_reviews.py` writes made-up reviews attached to the real doctor ids, so it must never run against the real database and its output must never be published.

```sh
python3 server/seed_demo_reviews.py                 # seeds server/data/demo.db (seed 42); --seed N, --db PATH
MEDINDEX_DB=server/data/demo.db python3 server/proxy.py
python3 server/seed_demo_reviews.py --remove        # deletes all demo reviews + demo accounts + both export files
```

- 10 demo accounts `demo_reviewer_01..10` (`users.is_demo = 1`, unusable password hash, login always 401) and exactly one review each for every doctor in `data/doctors.js` (227 x 10 = 2270, `reviews.is_demo = 1`, migration 3). Stars are uniform 1-5 from `random.Random(seed)`, dates spread over the 90 days before today 00:00 UTC, comments are generic bilingual "Demo ..." / "Recenzie demo ..." lines that claim nothing about the doctor. At least 10 RNG-picked doctors get an average >= 4.8 (also counting any real reviews).
- Deterministic for the same seed and day; re-running replaces the demo reviews (no duplicates); real users' reviews are never touched.
- Labeled in the API: `GET /api/reviews` gives each review `demo: true|false`, `GET /api/reviews/summary` adds `demo: true`. The frontend shows a "Demo review" badge.
- Exports: `server/data/demo-reviews.json` (`[{doctorId, reviewer, stars, comment, createdAt}]`) and `data/demo-reviews.js` (`window.DEMO_REVIEWS = {generatedFor: "presentation", ratings, reviews}`) for the server-less static site. Both are gitignored, and the Python server does not serve `data/demo-reviews.js` (fixed static allowlist).
- Refuses `server/data/medindex.db` unless `--i-know-this-is-the-real-db` is passed. Don't do that, and don't publish the demo DB or the exports (e.g. on GitHub Pages).

## .env (repo root, gitignored; real environment variables override it)

| Variable | Default | |
|---|---|---|
| `MOONSHOT_API_KEY` | (none) | Required for AI mode. Without it, `/api/chat` returns 502 and the rule engine answers. |
| `MOONSHOT_BASE_URL` | `https://api.moonshot.ai/v1` | Use `https://api.moonshot.cn/v1` for a China-platform key, or point it to a local mock for tests. |
| `MOONSHOT_MODEL` | `kimi-k2.6` | Any chat model from `GET /models`. |
| `PORT` | `8000` | The allowed Host/Origin values follow this port. |
| `MEDINDEX_DB` | `server/data/medindex.db` | SQLite file for accounts, reviews, Premium, cloud metadata and saved chats. |

## Security

- The API key stays on the server. It is never sent to the browser and never written to the log.
- The server binds to 127.0.0.1 only. The `Host` header must be `127.0.0.1:8000` or `localhost:8000`, which blocks DNS rebinding; anything else gets a 403.
- Static files come from an **allowlist**: `index.html`, `doctors.html`, `premium.html`, `account.html`, `cloud.html`, `styles.css`, `app.js`, `data/doctors.js`, `data/symptoms.js`, `assistant/*.js`, one level of `js/<name>.js` and `css/<name>.css`, and `assets/<name>.png` (logos, flat, served as `image/png`) (strict names `[a-z0-9_-]{1,64}`, matched against the directory listing, regular files only, looked up per request). `/favicon.ico` serves `assets/synapse-logo-64.png` as `image/png` when that file exists, otherwise 404. The `assistant/test-*.html` pages are not served.
  Paths are compared in lowercase, which is safe on the case-insensitive macOS filesystem. Everything else gets a 404, including `.env`, `server/` (so `server/data/medindex.db` in any spelling), `scraper/` (and `scraper/cache/`), `.dev/`, directory listings, other file types under `assets/`, and traversal or encoding tricks such as `/assets/../server/proxy.py` or `/assets/%2e%2e/...`.
- `/api/chat` accepts only Origin `http://127.0.0.1:8000` or `http://localhost:8000`, or no Origin at all. `null`, `file://` and every other origin get a 403 and no CORS headers.
- Each socket read times out after 5 s, and at most 32 requests are handled at once.
  **Accepted limitation:** a local client that sends one byte every few seconds over many connections can still use up the 32 slots. The server binds to 127.0.0.1 only, so only programs on this machine can do this.
- The model output is checked: it must be a single JSON object, unknown keys are dropped, only dataset specialties are kept (3 at most), the reply is capped at 1200 characters, and the safety filter above is applied.
  The browser checks it again with the same filter and renders it with `textContent` only, never as HTML.
- Temperature is 0.3, `response_format` is `json_object`, and the upstream timeout is 25 s.
- The log has one line per request and no message content.
- **Accounts:** passwords are hashed with scrypt (n=2^14, r=8, p=1, 16-byte salt, parameters stored with the hash) and checked with `hmac.compare_digest`; an unknown user costs the same scrypt time.
  The session is a 32-byte random token in the `mi_session` cookie (`HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`; no `Secure` because this is plain http on localhost). Only its SHA-256 is stored. Login rotates it, logout deletes it.
- Login and sign-up are rate limited in memory: 10 per identifier and 30 per IP in 5 minutes, then 429. A slot is reserved atomically **before** the scrypt check (so parallel guesses can't exceed the limit) and refunded when a login succeeds; every sign-up attempt counts. Login errors are always "Invalid credentials".
- At most 10 sessions per user; the oldest are deleted on login.
- Text that is not valid UTF-8 (including lone surrogates such as `"\ud800"` in JSON) gets a 400, never a 500. Control, zero-width and bidi-override characters are stripped from names, comments and messages.
- Every response (static, logos and API) carries `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` (no inline scripts, handlers or style attributes on the pages), `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`.
- **CSRF:** state-changing requests need `X-Requested-With: MedIndex` (a custom header, so a cross-site request needs a CORS preflight, which is denied), an allowed or missing Origin, and a same-origin `Sec-Fetch-Site` when sent.
- Identity and Premium come only from the session; ids or flags in the request are never trusted.
- API errors never contain stack traces; the log line has method, path, status and a short note, never bodies, passwords, cookies, tokens or card data.
- This is a hackathon dev server. **Don't deploy it as-is**: it has no TLS, the checkout is a demo (no real payment), and anyone who can reach it can spend your API credit.
