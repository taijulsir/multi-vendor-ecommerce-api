# Project Profile

Resume/portfolio material for the Multi-Vendor E-Commerce API. Every claim below is verified against the actual repository state (route counts, test counts, and behaviors were re-derived from source, not copied from an earlier draft) — see [`README.md`](../README.md) and [`docs/architecture.md`](architecture.md) for the full technical record.

---

### One-line description

A multi-vendor e-commerce backend (NestJS + PostgreSQL + Prisma) with JWT auth, RBAC/ownership authorization, atomic multi-vendor checkout, and a concurrency-safe payment/refund/webhook foundation — 54 routes, 486 unit + 329 e2e tests.

---

### Short project description

A production-oriented, multi-vendor e-commerce backend built with NestJS, TypeScript, PostgreSQL, and Prisma ORM. Implements the full customer path from authentication through cart, atomic multi-vendor checkout, order viewing, and a payment/refund/webhook foundation, alongside the vendor path from onboarding through verification/activation, shop and catalog management (products, variants, inventory, images), and vendor-order fulfillment. Backed by 486 unit tests and 329 end-to-end tests against a real PostgreSQL database, a documented and fixed concurrency bug (refund-settlement lost-update race), Docker + CI, and a fully audited Swagger/Postman surface.

---

### Technical highlights

- **Atomic, transaction-scoped checkout**: cart → order conversion, inventory reservation, and multi-vendor order splitting all happen inside one Prisma transaction, using conditional `UPDATE`s (not read-then-write) to close every race window.
- **One authorization model, reused everywhere**: a single JWT guard, a single RBAC guard (roles/permissions resolved live from the database, not JWT claims), and a small set of purpose-built ownership guards — no per-domain reimplementation.
- **Found and fixed a real concurrency bug**: a lost-update race in refund-settlement accumulation (`Payment.refundedAmount`), rewritten to the same atomic-conditional-`UPDATE` pattern used elsewhere, proven safe with dedicated concurrent e2e tests (`Promise.all` against the real webhook endpoint, no artificial sleep).
- **Idempotent webhook ingestion**: a database unique constraint plus a value-based idempotency check, so the same outcome can't double-apply even under a different event id.
- **Secure local file storage**: content-sniffed (magic-byte, not filename/Content-Type) image uploads, randomized storage filenames, path-traversal-safe deletion, and a dedicated streaming route instead of static file serving.
- **Global exception handling and graceful shutdown**: every unhandled error is normalized and never leaks a Prisma/SQL error to a client; `OnModuleDestroy`/`SIGTERM` handling closes database and Redis connections cleanly.
- **Verified, not just written, infrastructure**: Docker build/run and CI (`.github/workflows/ci.yml`) were both independently exercised end-to-end (build → migrate → seed → lint → format → type-check → build → unit → e2e → Prisma validate), not just configured and assumed to work.

---

### Resume bullet candidates

1. Designed and built a multi-vendor e-commerce backend (NestJS, TypeScript, PostgreSQL, Prisma) with JWT authentication, refresh-token rotation with reuse detection, and a database-driven RBAC + resource-ownership authorization model spanning 54 API routes.
2. Implemented an atomic, transaction-scoped checkout flow that splits a single cart into a multi-vendor order structure (one master order, one vendor order per vendor) using conditional-`UPDATE` inventory reservation instead of read-then-write, eliminating overselling under concurrent load.
3. Diagnosed and fixed a lost-update concurrency bug in payment-refund settlement accumulation, replacing a read-then-set update with an atomic conditional `UPDATE`, and proved the fix under genuine concurrent load with dedicated end-to-end tests.
4. Built an idempotent payment-webhook ingestion pipeline combining a database unique constraint with a value-based idempotency check, preventing duplicate application of the same payment/refund outcome under replayed or re-ordered events.
5. Authored 486 unit tests and 329 end-to-end tests (Jest + Supertest, real PostgreSQL) covering authentication, authorization, ownership isolation, checkout, inventory, payments, refunds, webhook replay protection, and concurrency scenarios; wired into a GitHub Actions CI pipeline running lint, type-check, build, and both test suites against live Postgres/Redis service containers.
6. Implemented secure local file storage for product images with content-based MIME validation, randomized filenames, and path-traversal protection, plus global exception handling and graceful shutdown (`SIGTERM`-safe connection teardown) as cross-cutting engineering concerns.

---

### Portfolio description

*(120 words)*

A production-oriented, multi-vendor e-commerce backend built with NestJS, TypeScript, PostgreSQL, and Prisma ORM. It implements the complete customer journey — JWT authentication with refresh-token rotation, cart management, atomic multi-vendor checkout, and order viewing — alongside the vendor journey of onboarding, verification/activation, shop and catalog management (products, variants, inventory, images), and order fulfillment. A payment/refund/webhook foundation handles idempotent event ingestion and concurrency-safe refund settlement, including a documented and fixed lost-update race condition proven safe under real concurrent load. The project is backed by 486 unit tests and 329 end-to-end tests against a real PostgreSQL database, a fully audited Swagger/OpenAPI surface and Postman collection, Docker, and a GitHub Actions CI pipeline — all independently verified, not just configured.

---

### GitHub project description

Multi-vendor e-commerce backend (NestJS, TypeScript, PostgreSQL, Prisma) — JWT auth, RBAC + ownership authorization, atomic multi-vendor checkout, concurrency-safe payments/refunds/webhooks. 486 unit + 329 e2e tests, Docker, CI.

---

## Screenshots / visual assets

No screenshots are fabricated or included as of this document. The following are genuine assets already in the repository and can be linked directly:

- [`docs/architecture-diagram.md`](architecture-diagram.md) — Mermaid system, commerce-flow, and vendor-flow diagrams (renders natively on GitHub).
- [`docs/database/erd.md`](database/erd.md) — Mermaid ER diagram of the implemented schema (renders natively on GitHub).

If manual screenshots are captured later, these are the ones that would add the most recruiter-facing value, and exactly what each should show:

| Screenshot | What to capture |
|---|---|
| Swagger UI overview | `http://localhost:3000/api/docs` with a domain tag group (e.g. Orders or Payments) expanded, showing route list + auth padlocks |
| Swagger UI — try-it-out | A single endpoint expanded with its request/response schema visible (e.g. `POST /checkout`) |
| Postman collection | The 17-folder structure in the left sidebar, collapsed, showing the full domain breadth at a glance |
| Postman run | A successful request/response pair for a representative flow (e.g. `POST /payments/:id/refunds`) with the test-script "PASS" indicators visible |
| Terminal — test run | `npm test -- --runInBand` and `npm run test:e2e -- --runInBand` output showing `486/486` and `329/329` passing |
| Terminal — CI | A green GitHub Actions run for `.github/workflows/ci.yml` |

Do not substitute generic/stock UI screenshots for any of the above — this is a backend-only project with no frontend, so every visual should come from Swagger, Postman, a terminal, or GitHub itself.
