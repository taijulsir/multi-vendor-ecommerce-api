# Production Checklist

The single, execution-ordered checklist for taking the Multi-Vendor E-Commerce API from "cloned repository" to "verified, live, resume-referenceable deployment." Every command and path here is drawn from this repository's actual `Dockerfile`, `docker-compose.yml`, `src/config/env.validation.ts`, `src/main.ts`, `postman/`, and [`docs/deployment.md`](docs/deployment.md) — nothing here is generic boilerplate. Where a step depends on a decision only the developer can make (domain name, VPS specifics), it's marked `[ACTION NEEDED]` rather than assumed.

**Status as of this checklist's writing: nothing below has been executed.** The application is engineering-complete and repeatedly verified locally (see [Section A](#a-pre-deployment---engineering-readiness)), but no deployment has happened yet. Check items off as you genuinely complete them — this file is only useful if it stays honest.

**Known context, carried over from the audit that produced this checklist (do not re-litigate):** the target VPS (Ubuntu 24.04 LTS, ~7.8 GB RAM / ~6+ GB free) is already provisioned, already runs one other PM2-managed application, already has GitHub SSH access working with a dedicated deploy key, and already went through a security incident that has been independently investigated and remediated (malware did not survive reboot; IOC checks clean; credentials rotated). None of that is re-verified or re-opened here — see [`docs/deployment.md`](docs/deployment.md)'s "Target VPS is shared, not dedicated" note for how it changes a few steps below (port conflict checks, shared Nginx).

---

## A. Pre-deployment — engineering readiness

- [x] Repository clean — no `.env`, `dist/`, `node_modules/`, `storage/`, or `.DS_Store` tracked in git (verified: `git ls-files` contains none of these)
- [x] Build passes — `npm run build` (`nest build`) exits clean, produces `dist/src/main.js`
- [x] Lint passes — `npx eslint "{src,test}/**/*.ts"` exits clean, no `--fix` needed
- [x] Format check passes — `npx prettier --check "src/**/*.ts" "test/**/*.ts"` reports all files already formatted
- [x] Unit tests pass — **486/486**, 44 suites (re-run fresh during this audit, no DB required)
- [ ] E2E tests pass — **329 tests, 11 suites** per current documentation; **not re-run live during this audit** (requires `docker compose up -d` for Postgres/Redis, which wasn't running in this session) — `[ACTION NEEDED]`: run `npm run test:e2e -- --runInBand` once before deploying and confirm the count still holds
- [x] `npm ci --dry-run` reports a consistent lockfile (no drift between `package.json`/`package-lock.json`)
- [x] CI green on GitHub Actions — latest `development` branch run: `success` (2026-08-22)
- [x] Node version consistent — `.nvmrc` (`22`), `Dockerfile` (`node:22-alpine` both stages), and CI (`node-version-file: .nvmrc`) all agree
- [x] Environment validation exists and is strict — `src/config/env.validation.ts` throws at startup on missing `DATABASE_URL`/`REDIS_HOST`/`REDIS_PORT`/JWT secrets, on a JWT secret under 32 characters, and if the two JWT secrets are equal
- [x] Global exception filter in place — no Prisma/SQL error ever reaches a client response
- [x] Graceful shutdown wired — `app.enableShutdownHooks()`, verified by a dedicated e2e test (`test/graceful-shutdown.e2e-spec.ts`)
- [x] Health check is a real dependency check, not a static `200` — `GET /api/health` genuinely queries Postgres and pings Redis
- [x] File storage is a real bind-mount concern, understood and documented — `FILE_STORAGE_DIR`, see [`docs/deployment.md`](docs/deployment.md) Section 10

## B. Pre-deployment — documentation & presentation

- [x] `docs/deployment.md` exists, matches the actual `Dockerfile`/`docker-compose.yml`/env validation, and accounts for the shared-VPS context
- [x] `PRODUCTION_CHECKLIST.md` (this file) exists
- [x] README documents Swagger, Postman, architecture, security, known limitations honestly — no fabricated live URL, no fabricated feature claims
- [x] `docs/project-profile.md` (resume/portfolio material) exists and is verified against actual route/test counts (54 routes, 486 unit + 329 e2e tests — route count and unit count re-verified fresh during this audit)
- [x] Postman collection verified against the live route set (56 requests / 17 folders, all using `{{baseUrl}}`, no hardcoded hosts) — see [POSTMAN](#postman-status) below
- [x] Postman production-environment template created (`postman/multi-vendor-ecommerce-api.postman_environment.production.example.json`) — placeholder `baseUrl`, ready to fill in post-deploy
- [ ] `[ACTION NEEDED]` — decide on a LICENSE (or explicitly keep `UNLICENSED`); currently no LICENSE file exists, already disclosed as a known limitation in the README
- [ ] `[ACTION NEEDED]` — set the GitHub repository's "About" description and topics (currently both empty on the public repo page) — see [GITHUB](#github-status) below

## C. Server

- [ ] SSH access to the VPS confirmed working
- [ ] `[ACTION NEEDED]` — check for port conflicts before assuming a clean slate (VPS already runs another app): `sudo ss -tlnp | grep -E ':(80|443|3000|5432|6379)\b'`
- [ ] Docker presence/version checked (`docker --version`) — install only if missing (`docs/deployment.md` Section 4)
- [ ] Docker Compose v2 plugin checked (`docker compose version`)
- [ ] UFW firewall configured — 22/80/443 public; 5432/6379/3000 **not** publicly allowed
- [ ] Deployment directory created (e.g. `/srv/multi-vendor-ecommerce-api` — adjust to your own convention) and owned by the deploying user
- [ ] Storage directory created and `chown 1000:1000`'d (matches the container's non-root `node` user) — `docs/deployment.md` Section 10

## D. Application

- [ ] Repository cloned to the server, checked out at a known commit (`git log -1 --oneline`)
- [ ] `.env.production` created on the server (outside git, never committed) with real values — `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (both ≥32 chars, genuinely different), `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `FILE_STORAGE_DIR` (absolute container path)
- [ ] JWT secrets generated fresh for production — `openssl rand -base64 48`, run twice, never reused from local `.env` or from each other
- [ ] Docker image built — `docker build -t multi-vendor-ecommerce-api:latest .`
- [ ] Server-side `docker-compose.prod.yml` created (not part of the git repo — see `docs/deployment.md` Section 9 for the exact file) with Postgres/Redis ports **not** published to the host
- [ ] Postgres + Redis containers started and healthy
- [ ] `npx prisma migrate status` run first — confirms current schema state before touching anything
- [ ] `npx prisma migrate deploy` run — **never** `migrate dev`, **never** `migrate reset`, against this database
- [ ] `npx prisma db seed` run — ADMIN/VENDOR/CUSTOMER roles present
- [ ] Application container started
- [ ] `GET /api/health` (direct, pre-Nginx: `curl http://127.0.0.1:3000/api/health`) returns `{"database":"up","redis":"up"}`

## E. Reverse proxy (Nginx)

- [ ] `[ACTION NEEDED]` — checked whether Nginx is already installed/running for the existing app before installing or touching any existing server block
- [ ] New server block added for this project's own domain/subdomain (a separate file under `sites-available/`, not an edit to any pre-existing block)
- [ ] `client_max_body_size 6M` set (covers this app's 5 MB image-upload limit with headroom)
- [ ] `nginx -t` passes; `systemctl reload nginx` applied
- [ ] Plain HTTP works end-to-end through Nginx (`curl http://YOUR_DOMAIN/api/health`)
- [ ] Domain's DNS A record confirmed pointed at the VPS (`dig YOUR_DOMAIN`)
- [ ] HTTPS issued via Certbot (`sudo certbot --nginx -d YOUR_DOMAIN`) — `[ACTION NEEDED]`: only possible once a real domain is decided and pointed
- [ ] HTTP → HTTPS redirect confirmed (Certbot adds this automatically)
- [ ] `sudo certbot renew --dry-run` passes (auto-renewal works)

## F. API verification (live)

- [ ] `GET https://YOUR_DOMAIN/api/health` → `200`, both services `"up"`
- [ ] `GET https://YOUR_DOMAIN/api/docs` → Swagger UI loads, all 12 tags present, "Authorize" works
- [ ] `GET https://YOUR_DOMAIN/api/docs-json` → `200`, valid OpenAPI document
- [ ] Register → Login → token auto-capture works against the live URL
- [ ] A full checkout flow (cart → checkout → order → payment → webhook) succeeds against the live URL, using test/demo data only
- [ ] A protected route without a token → `401`; wrong-owner access → `403`; nonexistent resource → `404`; invalid DTO → `400`
- [ ] Image upload + retrieval works against the live URL, and the storage bind mount is confirmed to survive a container restart
- [ ] A Redis-dependent check (the health endpoint itself, since no queue/cache exists to test — see [`docs/deployment.md`](docs/deployment.md) Section 2) confirms Redis is genuinely reachable, not just "container is running"

## G. Postman (live)

- [ ] `multi-vendor-ecommerce-api.postman_environment.production.example.json` imported, `baseUrl` filled in with the real deployed domain, saved as your own environment (not committed back to the repo with the real URL)
- [ ] Full collection run top-to-bottom against production, per folder, using the [Deployment Smoke Test](docs/deployment.md#17-deployment-smoke-test) checklist in `docs/deployment.md`
- [ ] Local environment still works unmodified (confirms production testing didn't leak into the committed local defaults)

## H. Final — operational proof

- [ ] Logs clean on a fresh `docker compose -f docker-compose.prod.yml logs app` — no repeating errors, no crash loop
- [ ] Restart tested for real — `docker stop <app-container>` → confirm `ExitCode` is `0` (clean `SIGTERM` shutdown, not a `SIGKILL` timeout) → `docker compose up -d` → health passes again
- [ ] File-storage persistence verified across that restart — a previously uploaded image is still retrievable afterward
- [ ] No secrets committed anywhere in git history for this deployment (`.env.production` never `git add`ed)
- [ ] README updated with the real live URL, real Swagger URL — replacing the current "not yet deployed" placeholder (do this only once the above is actually true)
- [ ] `PRODUCTION_CHECKLIST.md` (this file) updated — every box above genuinely checked, not rubber-stamped
- [ ] GitHub repository "About" section updated with description/topics (Section B)

---

## POSTMAN STATUS

**POSTMAN COLLECTION: READY.**

Verified directly against the current API and source, not assumed:

- 17 folders / 56 requests — confirmed by parsing the actual collection JSON (matches the README's claim exactly).
- 18 environment variables — confirmed by counting the actual environment JSON (matches the README's claim exactly).
- Every request URL uses `{{baseUrl}}` — zero hardcoded `localhost` references found anywhere in the collection.
- Auth: 8 requests use collection/folder-level bearer-token auth referencing `{{accessToken}}`/`{{adminAccessToken}}`; login/register/refresh flows have test scripts that auto-capture tokens into the environment.
- Route coverage matches the current controller surface (54 routes across 14 controllers) — no orphaned or missing folders for any implemented domain.
- No production environment previously existed — **added** during this audit (`multi-vendor-ecommerce-api.postman_environment.production.example.json`), a like-for-like copy of the local environment with only `baseUrl` replaced by an explicit placeholder, since the collection's own paths (`{{baseUrl}}/api/...`) needed no change to work against a live deployment.

No further collection changes are needed before or after deployment — only filling in the new environment's placeholder `baseUrl` once a real URL exists (Section G above).

## SWAGGER STATUS

**SWAGGER: READY (locally verified; live verification pending deployment).**

- `SwaggerModule.setup('docs', app, document, { useGlobalPrefix: true })` in `src/main.ts` resolves to `/api/docs` (UI) and `/api/docs-json` (raw OpenAPI) — confirmed by reading the actual bootstrap code.
- All 12 domain tags are explicitly declared in `DocumentBuilder`, in the same order as the Postman collection and README's project structure.
- Bearer auth scheme is registered (`.addBearerAuth()`).
- Route count (54) matches the controller decorator count exactly — no drift between what Swagger documents and what actually exists.
- No secrets are exposed by Swagger — it documents request/response *shapes* only; no example contains a real credential.
- Nothing here needs code changes — Swagger is generated live from the running application on every boot, so it cannot silently drift from the implementation the way a hand-maintained OpenAPI file could.
- **Pending**: confirming `/api/docs` and `/api/docs-json` are reachable and correct once actually deployed (Section F above) — cannot be verified before a live URL exists.

---

*(For the full narrative form of the checks above — command-by-command, with explanations — see [`docs/deployment.md`](docs/deployment.md).)*
