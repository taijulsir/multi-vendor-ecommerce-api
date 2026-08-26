# Deployment Guide

A complete, from-scratch manual deployment guide for the Multi-Vendor E-Commerce API, based directly on this repository's actual `Dockerfile`, `docker-compose.yml`, `src/config/env.validation.ts`, and application source — not a generic template. Where the repository doesn't prescribe something (a specific VPS provider, a specific directory path, a specific domain), this guide says so explicitly and uses a clearly-labeled example instead of presenting invented specifics as fact.

**This project has not yet been deployed** (see [`docs/experience-level-readiness-audit.md`](experience-level-readiness-audit.md), Section 8/24). This guide is what you would follow to do that; nothing here has been executed against a real server.

**Target VPS is shared, not dedicated.** The VPS this project will deploy to already runs at least one other application (an existing PM2-managed Node process) and has already been through a security incident that was investigated and remediated independently of this project. Two things follow from that, expanded in [Section 4](#4-server-initial-setup) and [Section 11](#11-nginx):

- **Port conflicts are a real possibility, not a hypothetical** — check what's already bound before assuming 80/443/3000/5432/6379 are free.
- **Nginx (if already installed for the existing app) needs a new server block for this domain, not a fresh install** — check before installing.

This guide does not repeat, re-verify, or second-guess that prior incident's remediation — it is out of scope here entirely.

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Current Redis / BullMQ Reality](#2-current-redis--bullmq-reality)
3. [VPS Requirements](#3-vps-requirements)
4. [Server Initial Setup](#4-server-initial-setup)
5. [Project Deployment](#5-project-deployment)
6. [Environment Variables](#6-environment-variables)
7. [PostgreSQL](#7-postgresql)
8. [Redis](#8-redis)
9. [Docker](#9-docker)
10. [Local File Storage](#10-local-file-storage)
11. [Nginx](#11-nginx)
12. [HTTPS](#12-https)
13. [Health Check](#13-health-check)
14. [Swagger](#14-swagger)
15. [Graceful Shutdown](#15-graceful-shutdown)
16. [Postman](#16-postman)
17. [Deployment Smoke Test](#17-deployment-smoke-test)
18. [Security Checklist](#18-security-checklist)
19. [Backups](#19-backups)
20. [Logging / Monitoring](#20-logging--monitoring)
21. [Restart / Recovery](#21-restart--recovery)
22. [Troubleshooting](#22-troubleshooting)
23. [Rollback](#23-rollback)
24. [Production vs. Portfolio](#24-production-vs-portfolio)
25. [Final Deployment Checklist](#25-final-deployment-checklist)

---

## 1. Architecture

The actual deployment shape this repository supports:

```
Internet
   ↓
Domain (A record → VPS IP)
   ↓
Nginx (reverse proxy, TLS termination)
   ↓
NestJS API container (this repo's Dockerfile, port 3000 internally)
   ↓
PostgreSQL 17            Redis 7
   ↓
Persistent local filesystem (FILE_STORAGE_DIR) — product images
```

**Components, precisely distinguished:**

- **Application container** — built from this repo's `Dockerfile` (multi-stage, `node:22-alpine`, non-root runtime). Runs the compiled NestJS app only; nothing else.
- **PostgreSQL** — the system of record. Not part of the application container; a separate container (or a managed instance, if you choose one — see [Section 7](#7-postgresql)).
- **Redis** — connected infrastructure (see [Section 2](#2-current-redis--bullmq-reality) for exactly what it's used for today). A separate container, not bundled into the app image.
- **Persistent file storage** — a plain host directory (bind-mounted or a Docker named volume) holding uploaded product images. Not a database, not object storage — see [Section 10](#10-local-file-storage).
- **Nginx** — a reverse proxy in front of the application container, terminating TLS and forwarding to the container's exposed port. Not part of this repository; you configure it on the host (or in its own container — this guide uses a host-level Nginx for simplicity, since none is prescribed by the repo).

**What this repository's own `docker-compose.yml` actually is:** local development infrastructure only — it starts PostgreSQL and Redis for `npm run start:dev` to connect to from the host. It does **not** define an application service, and is not, by itself, a production deployment file. This guide's [Section 9](#9-docker) gives you a manual production approach built on the same images without inventing a new compose file the repository doesn't already have.

---

## 2. Current Redis / BullMQ Reality

This is worth stating precisely, because it's easy to overstate from the dependency list alone.

**1. Why Redis exists in the current application:** `RedisModule` (`src/redis/redis.module.ts`) is a global NestJS module providing `RedisService` (`src/redis/redis.service.ts`), which wraps an `ioredis` client. It's a hard startup dependency — the app validates `REDIS_HOST`/`REDIS_PORT` at boot (`env.validation.ts`) and `RedisService.onModuleInit` calls `.ping()` before the app is considered up.

**2. How Redis is configured:** Two independent consumers read the same `REDIS_HOST`/`REDIS_PORT` env vars:
- `RedisService` itself (`src/redis/redis.service.ts`) — a generic `get`/`set`/`del` wrapper around one `ioredis` client.
- `BullModule.forRootAsync` in `src/app.module.ts` — registers a BullMQ *connection* (`host`/`port`) with NestJS's DI container.

**3. Whether BullMQ is actually used:** The `@nestjs/bullmq`/`bullmq` packages are installed and `BullModule.forRootAsync` is registered — this makes a Redis connection available to BullMQ's machinery, and nothing more.

**4. Whether queues exist:** No. A repository-wide search (`grep -rn "Queue" src`) finds no `BullModule.registerQueue(...)` call anywhere.

**5. Whether workers/processors exist:** No. No `@Processor`/`@Process` decorator, no `Worker` instantiation, exists anywhere in `src/`.

**6. Whether any scheduled/background job exists:** No. Every operation in this API (including image upload/processing) runs synchronously within its own HTTP request/response cycle. There is no cron, no scheduled task, no deferred job of any kind.

**What this means for deployment — stated plainly:**

- Redis **must** be reachable at startup or the application will not boot (the health check and `onModuleInit` ping both depend on it) — treat it as a required dependency, not an optional cache.
- Redis's **only** actual runtime consumer today is `GET /api/health` (which pings it) — there is no cache to warm, no queue to drain, no worker process to start or stop.
- **Do not** write or follow any deployment step that says "start the BullMQ worker(s)" — none exist to start. If you see that instruction anywhere else, it does not apply to this repository's current code.
- If a future phase adds real queues/caching, this section (and this guide) would need a corresponding update — until then, treating Redis as "just a health-checked, hard-required dependency with a registered-but-idle BullMQ connection" is the accurate description.

---

## 3. VPS Requirements

Sized for what this application actually runs — a single NestJS instance, PostgreSQL, and Redis, with no measured production load. This is a **portfolio/MVP-appropriate** specification, not a claim that this sizing supports any particular amount of traffic (none has been measured — see [`docs/experience-level-readiness-audit.md`](experience-level-readiness-audit.md) Section 10/18).

| Resource | Minimum | Notes |
|---|---|---|
| CPU | 2 vCPU | Runs Node, Postgres, and Redis as separate containers side by side |
| RAM | 4 GB | 2 GB may run, but leaves little headroom for Postgres's own buffer usage alongside Node and Redis |
| Disk | 40 GB SSD | Mostly for Postgres data growth and uploaded product images over time — size up if you expect meaningful image volume |
| OS | Ubuntu 22.04 or 24.04 LTS | Matches the `node:22-alpine`/`postgres:17-alpine`/`redis:7-alpine` images already used; any Docker-capable Linux distribution works, but this guide's commands assume Ubuntu/`apt`/`ufw` |
| Docker | 24.x+ | Required — the entire deployment is container-based |
| Docker Compose | v2 (the `docker compose` CLI plugin, not the legacy standalone `docker-compose`) | Matches the syntax already used by this repo's `docker-compose.yml` |

**If you already have a VPS provisioned for something else with these resources free, it can be reused** — nothing about this application requires a dedicated machine. Just make sure ports 5432/6379 aren't already bound by another service before following [Section 7](#7-postgresql)/[Section 8](#8-redis).

**Against the actual target VPS** (Ubuntu 24.04 LTS, ~7.8 GB RAM with ~6+ GB currently free, already running one other PM2-managed process): this comfortably clears the minimums above — RAM in particular has roughly 1.5× the 4 GB minimum free before this deployment adds anything. Docker's own presence/version on that host still needs checking live (Section 4) rather than assumed from this table.

---

## 4. Server Initial Setup

Run as a user with `sudo`, or as `root` if that's how your VPS provider hands off access.

**Since this VPS already runs another application, check what's already there before assuming a clean slate:**

```bash
docker --version 2>/dev/null || echo "Docker not yet installed"
docker compose version 2>/dev/null || echo "Compose plugin not yet installed"
sudo ss -tlnp | grep -E ':(80|443|3000|5432|6379)\b'   # anything already bound to these ports?
sudo systemctl status nginx 2>/dev/null || echo "Nginx not yet installed"
pm2 list 2>/dev/null   # confirm the existing PM2 app(s) and that this deployment doesn't collide with them
```

If Docker is already installed (quite possible if the existing app also uses it), skip the install step below and just verify the version is recent enough (24.x+). If 5432/6379/3000/80/443 already have something bound, resolve that before continuing — either the existing app is using a port this deployment also needs (pick a different one for whichever service can tolerate it) or it's nothing to worry about. This project's own containers (Postgres/Redis/app) do not need to interact with the existing PM2 app in any way — they're entirely separate processes — the only genuine shared resources are the finite set of host ports and, once configured, one shared Nginx instance (see [Section 11](#11-nginx)).

**Connect:**

```bash
ssh youruser@YOUR_SERVER_IP
```

**Update the system:**

```bash
sudo apt update && sudo apt upgrade -y
```

**Install basic packages:**

```bash
sudo apt install -y curl git ufw
```

**Install Docker Engine + Compose plugin** (Docker's official convenience script — inspect it before running on anything you don't fully trust, or follow Docker's official apt-repository instructions instead):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # lets your user run `docker` without sudo — log out/in to take effect
```

**Verify:**

```bash
docker --version
docker compose version
```

**Firewall (UFW) — public vs. internal, exactly as this application needs it:**

| Port | Exposure | Why |
|---|---|---|
| 22 (SSH) | **Public**, but consider key-only auth + a non-default port if you want to reduce scan noise | Server administration |
| 80 (HTTP) | **Public** | Nginx — redirects to HTTPS once configured |
| 443 (HTTPS) | **Public** | Nginx — the only path real clients should reach the app through |
| 5432 (PostgreSQL) | **Internal only — never public** | The application reaches Postgres over the Docker network by service name, not the host's public IP |
| 6379 (Redis) | **Internal only — never public** | Same reasoning |
| 3000 (the app itself) | **Internal only — never public** | Clients reach the app through Nginx, not this port directly |

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose   # confirm 5432/6379/3000 are NOT listed as allowed
```

Do **not** publish PostgreSQL's or Redis's ports to the host at all in production (see [Section 7](#7-postgresql)/[Section 8](#8-redis)) — the firewall above is a second layer of defense, not the only one.

---

## 5. Project Deployment

**1. Create a deployment directory:**

```bash
sudo mkdir -p /srv/multi-vendor-ecommerce-api
sudo chown $USER:$USER /srv/multi-vendor-ecommerce-api
cd /srv/multi-vendor-ecommerce-api
```

*(`/srv/multi-vendor-ecommerce-api` is an example path — not prescribed by the repository. Use whatever path convention your server already follows.)*

**2. Clone the repository:**

```bash
git clone https://github.com/taijulsir/multi-vendor-ecommerce-api.git .
```

**3. Checkout the intended branch/commit** (deploy from `main`, or a specific tagged/verified commit — never deploy an uncommitted working tree):

```bash
git checkout main
git log -1 --oneline   # confirm you're on the commit you intend to deploy
```

**4. Configure environment** — see [Section 6](#6-environment-variables) for the full reference:

```bash
cp .env.example .env.production
nano .env.production   # fill in real production values — see Section 6
```

**Never commit `.env.production`.** It's covered by this repo's existing `.gitignore` pattern (`.env.*`, with only `.env.example` excluded from that ignore) — confirm with `git status` that it shows as untracked/ignored, not staged.

**5. Build the Docker image** (using the existing `Dockerfile` — no changes needed):

```bash
docker build -t multi-vendor-ecommerce-api:latest .
```

**6. Start PostgreSQL and Redis** (production-appropriate — not this repo's dev `docker-compose.yml`, which exposes ports to the host; see [Section 9](#9-docker) for the full manual compose approach):

```bash
docker compose -f docker-compose.prod.yml up -d postgres redis
```

*(`docker-compose.prod.yml` here is a file **you** create locally on the server per Section 9 — it is not part of this repository, and this guide does not add one to the repo, per this task's instructions not to invent files in-repo.)*

**7. Run Prisma migrations safely** (production command — never `migrate dev`):

```bash
docker run --rm --network multi-vendor-ecommerce-api_default \
  --env-file .env.production \
  multi-vendor-ecommerce-api:latest \
  npx prisma migrate deploy
```

**8. Start the application:**

```bash
docker compose -f docker-compose.prod.yml up -d app
```

**9. Verify application startup:**

```bash
docker compose -f docker-compose.prod.yml logs -f app
# look for a clean NestJS startup log with no uncaught exceptions, then Ctrl+C to stop following
curl -s http://localhost:3000/api/health   # from the server itself, before Nginx is configured
```

**Development commands vs. production/deployment commands — explicitly distinguished:**

| Purpose | Development (local machine) | Production (VPS) |
|---|---|---|
| Run the app | `npm run start:dev` (watch mode, host process) | `docker run`/`docker compose up -d app` (compiled, containerized) |
| Apply migrations | `npx prisma migrate deploy` (same command — already production-safe) or `npx prisma migrate dev` (creates new migrations, dev-only) | `npx prisma migrate deploy` **only** — never `migrate dev` |
| Infrastructure | `docker compose up -d` (this repo's own `docker-compose.yml` — Postgres+Redis only, ports published to `localhost`) | A separate, server-side compose file (Section 9) — ports **not** published beyond the Docker network |
| Build | `npm run build` (host, for local `start:prod` testing) | `docker build` (produces the deployed artifact) |

---

## 6. Environment Variables

Built directly from `src/config/env.validation.ts` and `.env.example` — no variable below is invented, and none that exists in either source is omitted.

| Variable | Required? | Purpose | Example format | Secret? | Where configured |
|---|---|---|---|---|---|
| `NODE_ENV` | Not validated by `env.validation.ts`, but should be set | Standard Node environment flag; the `Dockerfile` already sets `NODE_ENV=production` in the runtime image | `production` | No | `.env.production` (redundant with the image default, but explicit is safer) |
| `PORT` | Optional (defaults to `3000` if unset) | The port the NestJS app listens on inside its container | `3000` | No | `.env.production` |
| `DATABASE_URL` | **Required** | PostgreSQL connection string, read by Prisma via `prisma.config.ts`'s `env('DATABASE_URL')` | `postgresql://ecommerce:REPLACE_ME@postgres:5432/multi_vendor_ecommerce` | **Yes** | `.env.production` only — never committed |
| `REDIS_HOST` | **Required** | Redis hostname the app connects to (`RedisService`, `BullModule`) | `redis` (the Docker Compose service name — see Section 8) | No (not a credential itself) | `.env.production` |
| `REDIS_PORT` | **Required** | Redis port | `6379` | No | `.env.production` |
| `JWT_ACCESS_SECRET` | **Required** — must be ≥32 characters | HMAC signing key for access tokens (`env.validation.ts` throws at startup if shorter) | A random 32+ character string, e.g. generated via `openssl rand -base64 48` | **Yes** | `.env.production` only |
| `JWT_REFRESH_SECRET` | **Required** — must be ≥32 characters, and **must differ from `JWT_ACCESS_SECRET`** | HMAC signing key for refresh tokens; the app throws at startup if this equals `JWT_ACCESS_SECRET` | Same generation method, a **different** value | **Yes** | `.env.production` only |
| `JWT_ACCESS_EXPIRES_IN` | **Required** | Access token lifetime (parsed by the `ms` package) | `15m` | No | `.env.production` |
| `JWT_REFRESH_EXPIRES_IN` | **Required** | Refresh token lifetime | `7d` | No | `.env.production` |
| `FILE_STORAGE_DIR` | Optional (defaults to `./storage/uploads`, resolved relative to the process's working directory) | Local filesystem directory for product image uploads (`LocalFileStorageService`) — see [Section 10](#10-local-file-storage) | `/data/storage/uploads` (an absolute path is strongly recommended in a container so it doesn't depend on the container's working directory) | No (a path, not a credential) | `.env.production` |

**No other environment variables exist in the current codebase** — this table is exhaustive against `env.validation.ts`'s `required` array plus the two optional variables (`PORT`, `FILE_STORAGE_DIR`) it also validates when present.

**Explicit rules, restated because they matter:**

- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must each independently satisfy the ≥32-character check, **and** must not be equal to each other — the application will refuse to start otherwise. Generate them independently:
  ```bash
  openssl rand -base64 48   # run twice, once per secret — never reuse the output
  ```
- **Production secrets must never be development secrets.** Do not reuse `docker-compose.yml`'s dev-only `ecommerce_dev_password` or any value from your local `.env` — generate fresh credentials for the production database and fresh JWT secrets for production.
- `.env.production` (or whatever you name your real environment file) must stay **outside Git entirely** — it is never committed, never pasted into a commit message, never logged. `.env.example` is the only environment file this repository tracks, and it contains no real values by design.
- Pass these into the container via `--env-file .env.production` (or your compose file's `env_file:` directive) — never bake real secrets into the Docker image itself (they'd be visible in `docker history`/image layers).

---

## 7. PostgreSQL

**Database creation** (inside the Postgres container, or via a managed provider's own console if you use one instead — nothing in this repo requires self-hosting it):

```bash
docker exec -it multi-vendor-postgres-prod psql -U postgres -c \
  "CREATE USER ecommerce WITH PASSWORD 'REPLACE_WITH_A_REAL_PASSWORD';"
docker exec -it multi-vendor-postgres-prod psql -U postgres -c \
  "CREATE DATABASE multi_vendor_ecommerce OWNER ecommerce;"
```

*(Exact bootstrap depends on how you start the Postgres container — the official `postgres:17-alpine` image also supports `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` environment variables at first startup, which is simpler — see Section 9's compose example.)*

**`DATABASE_URL` construction:**

```
postgresql://ecommerce:REPLACE_WITH_A_REAL_PASSWORD@postgres:5432/multi_vendor_ecommerce
```

Note the host is `postgres` — the Docker Compose service name — not `localhost`, since the app container reaches Postgres over the internal Docker network, not the host machine.

**Verify connectivity** (from a container on the same Docker network, or the app container itself once built):

```bash
docker run --rm --network multi-vendor-ecommerce-api_default postgres:17-alpine \
  pg_isready -h postgres -p 5432 -U ecommerce
```

**Check migration status before applying anything:**

```bash
docker run --rm --network multi-vendor-ecommerce-api_default \
  --env-file .env.production \
  multi-vendor-ecommerce-api:latest \
  npx prisma migrate status
```

This reports which of the repository's 13 existing migrations (`prisma/migrations/`) are already applied to this specific database — on a brand-new database, expect "database schema is not up to date" until you deploy them.

**Apply migrations — the production-safe command:**

```bash
docker run --rm --network multi-vendor-ecommerce-api_default \
  --env-file .env.production \
  multi-vendor-ecommerce-api:latest \
  npx prisma migrate deploy
```

**DO NOT use `npx prisma migrate dev` against this database.** `migrate dev` is a development-only command — it can generate new migrations and, in some conflict-resolution paths, prompts to reset the database. `migrate deploy` only ever applies existing, already-committed migrations in order and never resets anything.

**DO NOT reset the production database** — there is no legitimate reason to run `prisma migrate reset` (or any command wrapping it) against a database holding real data as part of a normal deployment.

**Post-migration verification:**

```bash
docker run --rm --network multi-vendor-ecommerce-api_default \
  --env-file .env.production \
  multi-vendor-ecommerce-api:latest \
  npx prisma migrate status
# expect: "Database schema is up to date!"

docker run --rm --network multi-vendor-ecommerce-api_default \
  --env-file .env.production \
  multi-vendor-ecommerce-api:latest \
  npx prisma validate
# expect: "The schemas at prisma/schema are valid"
```

Also worth running once, to confirm the seed data this project's Postman collection and RBAC model expect (`ADMIN`/`VENDOR`/`CUSTOMER` roles — see `prisma/seed.ts`):

```bash
docker run --rm --network multi-vendor-ecommerce-api_default \
  --env-file .env.production \
  multi-vendor-ecommerce-api:latest \
  npx prisma db seed
```

---

## 8. Redis

**Deployment:** a plain `redis:7-alpine` container (matching this repo's own `docker-compose.yml` image choice), not a managed caching service — nothing about the current code requires one.

**Host/port configuration:** the app reads `REDIS_HOST`/`REDIS_PORT` from its environment (Section 6). In a Docker Compose setup, set `REDIS_HOST=redis` (the service name) and `REDIS_PORT=6379`.

**Internal networking:** Redis's `6379` port should **not** be published to the host at all in production (unlike this repo's dev `docker-compose.yml`, which publishes it to `localhost:6379` for local convenience) — the app reaches it over the internal Docker Compose network by service name, and nothing external needs to.

**Connectivity verification** (once both containers are up):

```bash
docker exec -it <redis-container-name> redis-cli ping
# expect: PONG
```

The most meaningful verification, though, is the application's own health endpoint (Section 13) — it genuinely pings Redis (not just checks the container is running), so a `redis: "up"` result there is real end-to-end confirmation, not an assumption from "the container started."

**Persistence:** this repo's `docker-compose.yml` already runs Redis with `--appendonly yes` (AOF persistence) and a named volume (`redis_data`) — reasonable to carry into production as-is, since it costs nothing extra and Redis restarting with an empty dataset would at minimum interrupt future features, even though nothing currently reads persisted Redis data back (Section 2).

**Restated plainly:** Redis is not currently used for caching, sessions, or rate-limiting in this application — do not configure it as though it were (e.g., don't reach for Redis-backed session middleware or a cache-aside pattern; none of that exists in the code to configure).

---

## 9. Docker

**The `Dockerfile`** (unchanged, already production-appropriate):

- **Build stage** (`node:22-alpine`): `npm ci` (exact, reproducible dependency install), `npx prisma generate` (against a build-time-only placeholder `DATABASE_URL` — no real database needed to build the image), `npm run build` (compiles TypeScript to `dist/`, which already includes the generated Prisma Client since `tsconfig.json` doesn't exclude `src/generated/`).
- **Runtime stage** (`node:22-alpine`): `npm ci --omit=dev` (production dependencies only), copies `dist/` from the build stage, `chown -R node:node /app` then `USER node` — the container runs as the base image's built-in non-root `node` user (uid/gid 1000), not root.
- **`EXPOSE 3000`**, **`CMD ["node", "dist/src/main.js"]`** — runs the compiled app directly; no shell wrapper, no dev server.

**Building the image:**

```bash
docker build -t multi-vendor-ecommerce-api:latest .
```

**A server-side production compose file** (create this on the server, at the path from Section 5 — it is intentionally **not** added to the Git repository, since the repo's own `docker-compose.yml` is explicitly local-dev-only and this task doesn't authorize adding a new committed file):

```yaml
# /srv/multi-vendor-ecommerce-api/docker-compose.prod.yml
# Not part of the Git repository — created directly on the server.
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ecommerce
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}   # from a server-side .env, never committed
      POSTGRES_DB: multi_vendor_ecommerce
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ecommerce -d multi_vendor_ecommerce"]
      interval: 5s
      timeout: 5s
      retries: 5
    # No `ports:` — reachable only on the internal Docker network, by other services in this file.

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    # No `ports:` here either — same reasoning as postgres above.

  app:
    image: multi-vendor-ecommerce-api:latest
    restart: unless-stopped
    env_file:
      - .env.production
    environment:
      DATABASE_URL: postgresql://ecommerce:${POSTGRES_PASSWORD}@postgres:5432/multi_vendor_ecommerce
      REDIS_HOST: redis
      REDIS_PORT: 6379
    depends_on:
      - postgres
      - redis
    ports:
      - "127.0.0.1:3000:3000"   # bound to localhost only — Nginx (Section 11) proxies to this
    volumes:
      - /srv/multi-vendor-ecommerce-api/storage:/app/storage   # see Section 10

volumes:
  postgres_data:
  redis_data:
```

This is the same three components this repo's own architecture already describes ([`docs/architecture-diagram.md`](architecture-diagram.md)) — nothing added, nothing invented — just expressed as a server-side deployment compose file instead of the repository's local-dev one.

**Environment variables are injected externally** — via `env_file: .env.production` above, never baked into the image (Section 6).

**Volumes / networking:** the `app` service's `volumes:` mount is the one piece that makes local file storage survive a container restart (Section 10); Docker Compose's default bridge network lets `app` reach `postgres`/`redis` by service name, matching `DATABASE_URL`/`REDIS_HOST` above.

**Non-root runtime:** already handled by the `Dockerfile` itself (`USER node`) — nothing extra to configure in compose.

**Logs:**

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

**Restart behavior:** `restart: unless-stopped` on every service means Docker restarts a crashed container automatically (e.g., after a host reboot), but does **not** retry indefinitely if you deliberately stop it (`docker compose stop`).

---

## 10. Local File Storage

This project **intentionally does not use** S3, DigitalOcean Spaces, MinIO, or any object storage — product images are stored on a plain local filesystem directory via `LocalFileStorageService` (`src/storage/storage.service.ts`), and this deployment guide does not change that.

**`FILE_STORAGE_DIR`** is the one environment variable controlling where — it defaults to `./storage/uploads` (relative to the process's working directory) if unset, but **in a container this must be set to an absolute path and bind-mounted to a real host directory**, or every uploaded image is lost on the next container restart/redeploy (the container's own filesystem is ephemeral; only what's bind-mounted survives).

**Example conceptual structure** (an example — not prescribed by the repository, adjust to your own server's conventions):

```
/srv/multi-vendor-ecommerce-api/
├── docker-compose.prod.yml
├── .env.production
└── storage/
    └── uploads/          ← bind-mounted into the app container at /app/storage/uploads
```

Set `FILE_STORAGE_DIR=/app/storage/uploads` in `.env.production` (the path *inside* the container), and bind-mount the host's `storage/` directory to `/app/storage` in your compose file (as shown in Section 9's example).

**Directory ownership / permissions:** the app container runs as the non-root `node` user (uid/gid 1000 in the `node:22-alpine` base image). The bind-mounted host directory must be writable by that uid:

```bash
mkdir -p /srv/multi-vendor-ecommerce-api/storage/uploads
sudo chown -R 1000:1000 /srv/multi-vendor-ecommerce-api/storage
```

**Persistence:** verified by design, not by assumption — `LocalFileStorageService.onModuleInit` creates the configured directory (`fs.mkdir(rootDir, { recursive: true })`) if it doesn't exist, but does not touch or clear anything already there. A bind mount to a host directory means the directory's contents outlive any `docker stop`/`docker rm`/redeploy of the container.

**Image upload flow** (unchanged from local development): `POST /api/products/:productId/images` (multipart) → content-sniffed via `file-type` (never trusting the client's declared MIME/filename) → written under a server-generated random UUID filename (`LocalFileStorageService.generateFilename`) → a `ProductImage` DB row is created referencing that filename.

**Image retrieval:** `GET /api/products/:productId/images/:imageId` streams the file through the application itself (`createReadStream`, with a path-traversal-safe resolve-and-verify check) — never served as a static file.

**Critical: the storage directory must NOT be exposed by Nginx.** Do not add an Nginx `location` block or `alias`/`root` directive pointing at `/srv/multi-vendor-ecommerce-api/storage` — every image read must go through the application's own streaming route so its visibility rules (an `ACTIVE` product's images are public; anything else requires ownership/ADMIN) are actually enforced. Serving the directory directly would bypass that check entirely.

**Backup consideration:** see [Section 19](#19-backups) — this directory is real, un-backed-up-by-default data once you're storing real images; back it up alongside the database, not as an afterthought.

---

## 11. Nginx

A manual reverse-proxy configuration — not part of this repository, configured directly on the host.

**Check first — this VPS may already have Nginx running for its existing application:**

```bash
sudo systemctl status nginx
sudo ls /etc/nginx/sites-enabled/
```

If Nginx is already installed and serving the existing app, **do not reinstall it or touch its existing server block** — this deployment only needs one *additional* server block (below), living in its own file, for this project's own domain/subdomain. If Nginx isn't installed at all yet, install it fresh:

```bash
sudo apt install -y nginx
```

**Server block** (`/etc/nginx/sites-available/multi-vendor-ecommerce-api`):

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN;   # e.g. api.example.com — replace with your real domain

    # This app's largest request body is a product image upload
    # (MAX_IMAGE_FILE_SIZE_BYTES in src/catalog/product-images/utils/image-validation.ts,
    # currently 5 MB) — Nginx's own limit must be at least that, or a valid
    # upload gets rejected by the proxy before it ever reaches the app.
    client_max_body_size 6M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Enable it:**

```bash
sudo ln -s /etc/nginx/sites-available/multi-vendor-ecommerce-api /etc/nginx/sites-enabled/
sudo nginx -t   # validates syntax before reloading
sudo systemctl reload nginx
```

**What each proxy header is for:** `Host` preserves the original requested domain; `X-Real-IP`/`X-Forwarded-For` preserve the real client IP (otherwise every request would appear to come from `127.0.0.1` to the app); `X-Forwarded-Proto` tells the app the original request was HTTP or HTTPS (relevant once Section 12 is configured — the app itself doesn't currently read this header for any redirect logic, but it's standard practice so a future need doesn't require re-touching the Nginx config).

**No WebSocket configuration is included** — nothing in this application uses WebSockets (no `@WebSocketGateway`, no `ws`/`socket.io` dependency exists anywhere in `package.json` or `src/`), so inventing `Upgrade`/`Connection` header forwarding here would document a capability this API doesn't have.

**HTTP → HTTPS redirect:** added automatically by Certbot in Section 12 — do not hand-write it before then, since Certbot's own workflow modifies this exact server block to add the redirect and the matching `listen 443 ssl` block.

---

## 12. HTTPS

Using Let's Encrypt / Certbot — only if you have a real domain pointed at this server. **If you don't have a domain, skip this section and report HTTPS as not configured — do not fabricate a certificate or claim HTTPS works without one.**

**1. DNS A record:** point your domain (e.g. `api.example.com`) at the VPS's public IP through your DNS provider, and wait for propagation (`dig api.example.com` should return the VPS IP before continuing).

**2. Install Certbot:**

```bash
sudo apt install -y certbot python3-certbot-nginx
```

**3. Issue the certificate** (Certbot's Nginx plugin edits the server block from Section 11 automatically — adding the `listen 443 ssl` block and the HTTP→HTTPS redirect):

```bash
sudo certbot --nginx -d YOUR_DOMAIN
```

**4. Verify:**

```bash
curl -I https://YOUR_DOMAIN/api/health
```

Expect a `200` with a valid TLS handshake (no `-k`/`--insecure` flag needed).

**5. Renewal:** Certbot on Ubuntu installs a systemd timer (or cron job, on older setups) automatically — verify it exists rather than assuming:

```bash
sudo systemctl list-timers | grep certbot
# or, on older installs:
cat /etc/cron.d/certbot 2>/dev/null
```

Test the renewal process without actually renewing (dry-run):

```bash
sudo certbot renew --dry-run
```

**Never place certificates or private keys in this Git repository.** Certbot stores them under `/etc/letsencrypt/` on the server itself — nowhere near the application's source tree.

---

## 13. Health Check

The actual endpoint, from `src/health/health.controller.ts`/`health.service.ts` — no new endpoint is created for deployment purposes.

```
GET /api/health
```

**Response shape** (from `HealthService.check()`):

```json
{
  "status": "ok",
  "services": { "database": "up", "redis": "up" },
  "timestamp": "2026-08-23T00:00:00.000Z"
}
```

This is a **real** check, not a static `200` — `HealthService.check()` runs `this.prisma.$queryRaw\`SELECT 1\`` and `this.redis.getClient().ping()` on every call. If either dependency is unreachable, the request throws and the endpoint does not return a clean `200`.

**Verify after deployment:**

```bash
curl -s https://YOUR_DOMAIN/api/health | python3 -m json.tool
```

**To specifically verify each dependency independently** (useful when troubleshooting which one is failing): temporarily stop just Redis or just Postgres (`docker compose -f docker-compose.prod.yml stop redis`) and re-hit `/api/health` — expect the request to fail/error rather than silently report `"redis": "up"` when it isn't. Then restart the stopped service and confirm health recovers.

---

## 14. Swagger

The actual configured path, from `src/main.ts`:

```
SwaggerModule.setup('docs', app, document, { useGlobalPrefix: true });
```

Combined with `app.setGlobalPrefix('api')`, this resolves to:

```
https://YOUR_DOMAIN/api/docs        ← interactive Swagger UI
https://YOUR_DOMAIN/api/docs-json   ← the raw OpenAPI JSON document
```

**After deployment, verify:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://YOUR_DOMAIN/api/docs-json
# expect 200
```

Then open `https://YOUR_DOMAIN/api/docs` in a browser and confirm:

- All expected domain tags are present (health, auth, vendors, shops, categories, products, product-images, cart, checkout, orders, vendor-orders, payments — matching the `DocumentBuilder` tag list in `main.ts`).
- The route count matches the project's known API surface (54 routes total — 49 business + 5 RBAC-demo, per [`docs/experience-level-readiness-audit.md`](experience-level-readiness-audit.md)).
- "Authorize" (bearer token) is present and functional for protected routes.
- The image-upload route (`POST /products/:productId/images`) shows a `multipart/form-data` request body, not a JSON body.
- No route exposes an internal field that shouldn't be public (e.g., no `passwordHash` in any response schema) — this was already audited in Phase 25/26; a quick visual spot-check after deployment confirms nothing changed.

Swagger is public by default here (no auth guard in front of `/api/docs` itself) — if you don't want it publicly reachable in your deployment, that would require adding auth in front of the Swagger route, which this guide does not do since it isn't already implemented and this task doesn't authorize adding it.

---

## 15. Graceful Shutdown

The actual implemented behavior, from `src/main.ts`'s `app.enableShutdownHooks()` plus `PrismaService`/`RedisService`'s existing `onModuleDestroy` hooks — no new behavior is added for deployment.

**What happens on a termination signal:** `enableShutdownHooks()` wires `SIGTERM`/`SIGINT` through to NestJS's own application lifecycle, which calls `app.close()` — the same call every e2e test's `afterAll` already triggers. This in turn calls every module's `onModuleDestroy`, including `PrismaService` (closes the database connection pool) and `RedisService` (calls `client.quit()`).

**How to test this for real** (not a mocked Jest test — an actual container termination):

```bash
docker compose -f docker-compose.prod.yml logs -f app &
docker stop <app-container-name>
```

**What you should observe in the logs:** the application logs its normal NestJS shutdown sequence (module teardown), then the container exits. `docker stop` sends `SIGTERM` first and waits (10 seconds by default) before escalating to `SIGKILL` — a graceful shutdown should complete well within that window for this application's current connection load.

```bash
docker inspect <app-container-name> --format='{{.State.ExitCode}}'
# expect 0 — a clean exit, not killed
```

If the container instead sits until the full `SIGKILL` timeout elapses, that would indicate the shutdown hooks aren't completing cleanly — worth investigating before considering deployment done, since this specific behavior (`app.enableShutdownHooks()`) is exactly what Phase 23 implemented and tested (`test/graceful-shutdown.e2e-spec.ts`) for precisely this scenario.

---

## 16. Postman

Use the repository's existing files:

```
postman/multi-vendor-ecommerce-api.postman_collection.json
postman/multi-vendor-ecommerce-api.postman_environment.json                     ← local
postman/multi-vendor-ecommerce-api.postman_environment.production.example.json  ← production template
```

**1. Import the collection** into Postman (File → Import → select the collection JSON).

**2. Import both environments** the same way — the local one and the production template.

**3. Select the production environment** (top-right environment dropdown in Postman).

**4. Set the deployed `baseUrl`** — edit only this one variable's value, in Postman's UI (not by re-editing the repository's own copy of the file):

```
baseUrl = https://YOUR_DOMAIN
```

Note this is the origin only, with no `/api` suffix and no trailing slash — every request in the collection already includes `/api/...` in its own path (e.g. `{{baseUrl}}/api/health`), so the environment variable stays a plain domain.

Do not edit-and-save the *committed* `...production.example.json` file in this repository with the real deployed URL — keep it as the placeholder template so the repository stays reusable for the next deployment. Once you've filled in the real `baseUrl` inside Postman, either keep it only in your own Postman workspace, or export it to a file *outside* this repository if you want a saved copy.

**5. Run login** (`02 Auth > Login`, after `Register`) and **verify token auto-capture** — the collection's test scripts call `pm.environment.set('accessToken', ...)`/`pm.environment.set('refreshToken', ...)` automatically; check the environment's current values (the "eye" icon next to the environment selector) to confirm they populated after running the request.

**6. Run the complete business flow** per [Section 17](#17-deployment-smoke-test) below, roughly top-to-bottom by folder, same as local development.

---

## 17. Deployment Smoke Test

A practical checklist, using **test/demo data only** — never real payment data (this project has no real payment gateway integrated, so this is naturally already true, but worth stating).

Run these against the deployed `baseUrl`, via the imported Postman collection (Section 16):

- [ ] `GET /health` → `200`, `{"database":"up","redis":"up"}`
- [ ] `POST /auth/register` → `201`, new user created
- [ ] `POST /auth/login` → `200`, `accessToken`/`refreshToken` captured
- [ ] `POST /vendors` → `201`, vendor onboarded (`status: PENDING`)
- [ ] `PATCH /vendors/:id/verification` (as ADMIN) → vendor `VERIFIED`
- [ ] `PATCH /vendors/:id/activation` (as ADMIN) → vendor `ACTIVE`
- [ ] `POST /shops` → `201`
- [ ] `POST /categories` (as ADMIN) → `201`
- [ ] `POST /products` → `201`
- [ ] `POST /products/:productId/variants` → `201`
- [ ] `POST /products/:productId/variants/:variantId/inventory/restock` → stock increased
- [ ] `POST /products/:productId/images` (multipart, a real small JPEG/PNG) → `201`, `ProductImage` created
- [ ] `GET /products/:productId/images/:imageId` → `200`, correct `Content-Type`, image bytes stream back
- [ ] `POST /cart/items` → `201` (only succeeds once the vendor is `VERIFIED`+`ACTIVE` — see the Postman collection's own description for this dependency)
- [ ] `POST /checkout` → `201`, `MasterOrder` + `VendorOrder`(s) created, cart converted
- [ ] `GET /orders/:masterOrderId` → `200`
- [ ] `PATCH /vendor-orders/:vendorOrderId/status` → transitions correctly (e.g. `PENDING → CONFIRMED`)
- [ ] `POST /payments` → `201`, `Payment` + first `PaymentAttempt`
- [ ] `POST /payments/webhook` (`payment.succeeded`, matching `providerReference`) → `Payment`/`MasterOrder.paymentStatus` updated
- [ ] `POST /payments/:paymentId/refunds` (as ADMIN) → `201`
- [ ] `POST /payments/webhook` (`refund.succeeded`) → `Payment.refundedAmount`/status updated

**Also verify, per this project's actual security model:**

- [ ] A request with no `Authorization` header to a protected route → `401`
- [ ] A request with a valid token but the wrong role/ownership (e.g. a different vendor's product) → `403`
- [ ] A request for a nonexistent resource id → `404`
- [ ] A request with an invalid/incomplete DTO body → `400`
- [ ] **Ownership isolation:** confirm one test user cannot view/modify another user's cart, order, or vendor's resources
- [ ] **Image authorization:** confirm a non-`ACTIVE` product's image correctly requires ownership/ADMIN (not publicly streamable), matching `ProductImagesService.resolveStreamable`'s documented behavior

---

## 18. Security Checklist

What's actually implemented vs. what's an operator responsibility at deployment time:

- [x] **SSH key authentication** — configure this yourself (disable password auth in `/etc/ssh/sshd_config`, `PasswordAuthentication no`) if not already the case; not something the application controls.
- [x] **Firewall** — Section 4; PostgreSQL/Redis never publicly bound.
- [x] **PostgreSQL not public** — Section 7/9 (no `ports:` published in the production compose example).
- [x] **Redis not public** — Section 8/9 (same).
- [x] **Secrets outside Git** — `.env.production` never committed (Section 6); repository's own `.gitignore` already covers `.env*` except `.env.example`.
- [x] **Strong JWT secrets** — Section 6's generation method; enforced by `env.validation.ts` at startup (≥32 chars, access ≠ refresh).
- [ ] **HTTPS** — only true once Section 12 is actually completed with a real domain; do not check this box without having done it.
- [x] **Non-root Docker** — already true by the `Dockerfile` itself (`USER node`), verifiable with `docker exec <container> whoami`.
- [x] **Storage not publicly exposed** — Section 10; no Nginx `location`/`alias` should ever point at the storage directory.
- [x] **Upload MIME validation** — implemented (`file-type` content-sniffing, `src/catalog/product-images/`), not deployment-configured, just confirmed still true post-deployment via the smoke test.
- [x] **Path traversal protection** — implemented (`LocalFileStorageService.resolveSafePath`), same as above.
- [x] **Exception leakage protection** — implemented (`AllExceptionsFilter`); verify post-deployment that a genuinely unexpected error still returns a generic `500` body, not a stack trace (Section 22 has a troubleshooting angle on this too).
- [ ] **Swagger exposure** — currently public with no auth in front of it (Section 14); decide deliberately whether that's acceptable for your deployment (a portfolio/demo deployment reasonably leaves it open; a more guarded deployment might restrict it at the Nginx layer with basic auth — not currently configured, and adding it is a deliberate choice for you to make, not something this guide does automatically).

**Explicitly not implemented — do not claim these exist:** rate limiting, a CORS policy, a WAF, a secrets manager, webhook signature verification (no real payment gateway is integrated to verify signatures against). These are documented, disclosed gaps (see [`README.md`](../README.md#security) and [`docs/experience-level-readiness-audit.md`](experience-level-readiness-audit.md) Section 5), not oversights introduced by this deployment.

---

## 19. Backups

**What is currently implemented by the application: nothing.** No automated backup mechanism exists anywhere in this codebase — this is entirely an operator/infrastructure responsibility, stated honestly rather than implied to exist.

**PostgreSQL — a practical manual approach:**

```bash
docker exec multi-vendor-postgres-prod pg_dump -U ecommerce multi_vendor_ecommerce | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

Automate this with a simple cron entry if you want regular backups:

```bash
crontab -e
# 0 3 * * * docker exec multi-vendor-postgres-prod pg_dump -U ecommerce multi_vendor_ecommerce | gzip > /srv/backups/pg_$(date +\%Y\%m\%d).sql.gz
```

**Restore** (only ever against a genuinely intended target — never rehearse this against a live production database):

```bash
gunzip -c backup_20260101_030000.sql.gz | docker exec -i multi-vendor-postgres-prod psql -U ecommerce multi_vendor_ecommerce
```

**Uploaded product images:** the storage directory (Section 10) is real, un-backed-up data — a simple `rsync`/`tar` of `/srv/multi-vendor-ecommerce-api/storage` to another location (another server, or cloud storage used purely as a backup target — this doesn't contradict "no S3 for serving images," since it's not part of the application's own architecture) is the minimum reasonable approach:

```bash
tar czf storage_backup_$(date +%Y%m%d).tar.gz -C /srv/multi-vendor-ecommerce-api storage
```

**What you should configure externally, not something this guide implements:** off-server backup storage (don't keep backups only on the same disk they're protecting against), a retention policy, and periodic restore-testing. None of this exists today — this section describes what to set up, not something already running.

---

## 20. Logging / Monitoring

**Current reality, stated plainly:** this application uses NestJS's built-in `Logger` (`@nestjs/common`), writing plain-text log lines to stdout/stderr — nothing more. Confirmed by inspection: no `pino`/`winston`/`nestjs-pino` dependency exists in `package.json`, no external log-shipping, no metrics endpoint, no tracing.

**What you get today:**

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

This shows NestJS's own startup logs plus anything `AllExceptionsFilter` logs for a 5xx response (routine 4xx business errors are deliberately not logged — they're expected control flow, not incidents).

**What does not exist and should not be claimed:** structured/JSON logging, log aggregation (no ELK/Loki/CloudWatch integration), metrics (no Prometheus endpoint), distributed tracing (no OpenTelemetry), error tracking (no Sentry), alerting (nothing notifies anyone of anything).

**Future recommendations only** (for a real commercial production system beyond this portfolio deployment's scope — not implemented, not being added here):

- Structured JSON logging (e.g. `nestjs-pino`) so logs are queryable rather than grep'd by eye.
- Shipping container logs to a centralized destination (`docker`'s own log driver can forward to many targets without any application change).
- A basic uptime monitor (even a simple external `GET /api/health` poller) to get *some* signal before a user reports a problem.
- Error tracking (Sentry or similar) specifically for the 5xx path `AllExceptionsFilter` already isolates cleanly — it's a natural, low-effort integration point if this ever becomes a priority, but is not present today.

---

## 21. Restart / Recovery

**Application restart** (code/config unchanged, just cycling the process):

```bash
docker compose -f docker-compose.prod.yml restart app
```

**Full container restart** (e.g. after a host reboot — `restart: unless-stopped` handles this automatically, but to do it manually):

```bash
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
```

**After any restart, verify in this order:**

1. **Health:** `curl -s https://YOUR_DOMAIN/api/health` → both `database` and `redis` report `"up"`.
2. **PostgreSQL connectivity:** already implied by (1), but explicitly: `docker exec <postgres-container> pg_isready -U ecommerce`.
3. **Redis connectivity:** `docker exec <redis-container> redis-cli ping` → `PONG`.
4. **Image retrieval:** `GET /api/products/:productId/images/:imageId` on a previously-uploaded image → confirms the bind mount (Section 10) survived and the file is still there.
5. **Authentication:** run the Postman collection's `Login` request → confirms JWT signing still works (i.e., the same secrets are still configured).
6. **Basic business flow:** re-run a subset of Section 17's smoke test (at minimum: list products, view an order) to confirm the full stack is genuinely functional, not just "the container is running."

**Do not** run any command that drops/recreates volumes (`docker compose down -v`) as part of a routine restart — that destroys the Postgres data volume and the storage bind mount's *container-side* reference (the bind-mounted host directory itself would survive, but the named `postgres_data`/`redis_data` volumes would not).

---

## 22. Troubleshooting

| Symptom | Likely cause | What to check |
|---|---|---|
| **Docker container won't start** | Missing/invalid env var, port already in use | `docker compose -f docker-compose.prod.yml logs app` for the actual startup error; `env.validation.ts` throws a specific message for each missing/invalid variable — read it literally |
| **`DATABASE_URL` failure** | Wrong host/port/credentials, Postgres not yet up, network name mismatch | Confirm the host in `DATABASE_URL` matches the compose service name (`postgres`, not `localhost`); `docker compose ps` to confirm Postgres is healthy; `docker network ls`/`docker network inspect` if using `docker run` instead of compose |
| **Prisma migration failure** | Database not reachable, a genuinely conflicting migration state | `npx prisma migrate status` first, always — read its exact message before doing anything else; do **not** reach for `migrate reset` on a database with real data |
| **Redis connection failure** | Wrong `REDIS_HOST`/`REDIS_PORT`, Redis not yet started, network name mismatch | `docker exec <redis-container> redis-cli ping`; confirm `REDIS_HOST=redis` matches the compose service name |
| **Nginx 502** | The app container isn't running, or isn't listening on the port Nginx proxies to | `docker compose ps` to confirm `app` is up; `curl http://127.0.0.1:3000/api/health` directly on the server (bypassing Nginx) to isolate whether the app or the proxy is the problem |
| **HTTPS certificate issue** | DNS not yet propagated, port 80 blocked during Certbot's challenge, certificate expired | `dig YOUR_DOMAIN` to confirm DNS; `sudo ufw status` to confirm port 80 is open; `sudo certbot certificates` to check expiry |
| **Permission denied on storage** | The bind-mounted host directory isn't owned by uid 1000 (the container's `node` user) | `ls -la /srv/multi-vendor-ecommerce-api/storage`; re-run `sudo chown -R 1000:1000 ...` from Section 10 |
| **Image upload failure** | File exceeds the 5 MB limit, wrong/unsupported MIME type, Nginx `client_max_body_size` too low | Check the actual error response (`400`/`413`); confirm Nginx's `client_max_body_size` (Section 11) is ≥ the app's own limit |
| **Port conflict** | Something else on the host already bound to 5432/6379/3000/80/443 | `sudo ss -tlnp \| grep <port>` to find what's already listening |
| **Container restart loop** | A startup-time failure that `restart: unless-stopped` keeps retrying | `docker compose logs app` (not `-f`, so you see the full history including the crash) — the very first startup error is almost always the real cause, not the last line in the loop |

---

## 23. Rollback

A safe, basic rollback strategy — no destructive database commands assumed safe by default.

**Application code rollback** (straightforward — this is just redeploying an older, known-good state):

```bash
git log --oneline   # find the last known-good commit
git checkout <previous-good-commit>
docker build -t multi-vendor-ecommerce-api:previous .
# update docker-compose.prod.yml's app image tag to :previous, then:
docker compose -f docker-compose.prod.yml up -d app
```

Keeping the previous image tagged (`:previous`, or better, a real version tag per deploy) before building `:latest` again is the simplest safety net — you can revert to it instantly without rebuilding.

**Database/migration rollback — the honest limitation:** Prisma does not provide an automatic "undo the last migration" command. `prisma migrate deploy` only ever applies migrations forward, in order. Rolling back a schema change means one of:

1. Writing and applying a new, forward migration that reverses the change (the generally-recommended approach — treat rollback as "roll forward to the previous shape," not literally undoing history).
2. Restoring from a pre-migration database backup (Section 19) if the migration already caused data loss or corruption that a forward-fix can't cleanly resolve.

**Do not** attempt to manually delete rows from Prisma's `_prisma_migrations` tracking table to "un-apply" a migration — this desynchronizes Prisma's own bookkeeping from the database's actual schema and is a well-known way to make the situation significantly worse, not better.

**Practical guidance for this specific project:** since Phase 28 forbids creating new migrations except when deployment genuinely requires one, and no schema changes are anticipated as part of a normal deployment, the realistic rollback scenario here is almost always "redeploy the previous application image," not "reverse a database migration" — keep that distinction in mind rather than over-preparing for a scenario this project's own constraints make unlikely.

---

## 24. Production vs. Portfolio

Stated explicitly, because the distinction matters and this guide should not oversell what following it proves:

**This deployment demonstrates:**
- Real VPS provisioning and Linux server administration (firewall, Docker installation, non-root execution).
- A genuine, working containerized deployment of a NestJS + PostgreSQL + Redis application.
- Real reverse-proxy configuration and (where a domain is available) real TLS via Let's Encrypt.
- Real operational verification — health checks, graceful shutdown under an actual `docker stop`, file-storage persistence across a real container restart, and a real smoke test against the deployed API.
- Genuine, practiced deployment/rollback/troubleshooting judgment for a real, if modest, production-shaped environment.

**This deployment does NOT demonstrate:**
- High-scale production traffic — nothing has been load-tested; no request-per-second figure has been measured or should be claimed.
- Horizontal scaling — the current architecture (particularly local file storage) explicitly does not support multiple application instances behind a load balancer without further changes (see [`docs/experience-level-readiness-audit.md`](experience-level-readiness-audit.md) Section 10).
- Multi-region deployment.
- Kubernetes or any container-orchestration platform — a single Docker Compose stack on one VPS is the entirety of this deployment's scope, deliberately.
- Managed cloud infrastructure (RDS, managed Redis, managed Kubernetes, etc.) — everything here is self-hosted on one server, by design for this project's actual scope.
- Distributed tracing or full observability (Section 20) — logs only.
- Automated disaster recovery — Section 19's backup guidance is manual and operator-driven, not an automated DR system.

This is a genuine, honestly-scoped portfolio/MVP deployment — real infrastructure, real verification, real operational practice — not a claim of enterprise production readiness.

---

## 25. Final Deployment Checklist

```
[ ] VPS ready (Section 3)
[ ] SSH configured (Section 4)
[ ] Firewall configured (Section 4)
[ ] Docker installed (Section 4)
[ ] Domain configured (Section 11/12, if applicable)
[ ] HTTPS configured (Section 12, if a domain is available)
[ ] Production env configured (Section 6 — .env.production, outside Git)
[ ] PostgreSQL ready (Section 7)
[ ] Redis ready (Section 8)
[ ] Prisma migrations applied (Section 7 — migrate deploy, verified via migrate status)
[ ] Application running (Section 9)
[ ] Health verified (Section 13)
[ ] Swagger verified (Section 14)
[ ] File storage persistent (Section 10 — confirmed across a real restart)
[ ] Image upload tested (Section 17)
[ ] Container restart tested (Section 15/21)
[ ] Postman environment configured (Section 16 — baseUrl updated, not committed)
[ ] Full smoke test passed (Section 17)
[ ] Security smoke test passed (Section 18)
[ ] Backup plan documented (Section 19)
[ ] Logs verified (Section 20)
[ ] Deployment documentation reviewed (this document)
```
