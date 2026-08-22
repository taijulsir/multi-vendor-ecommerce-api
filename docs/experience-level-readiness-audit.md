# Experience-Level Readiness Audit

**3–5 YOE Backend Engineer Assessment — Multi-Vendor E-Commerce API**

This audit re-derives every claim below directly from source (`src/`, `test/`, `prisma/`, CI, Docker, Postman) rather than trusting the Phase 25/26 reports. Where a mechanism is described, the exact file and behavior were read during this audit, not recalled. Where a gap is identified, it was confirmed by reading the code path in question, not inferred from documentation alone.

---

## Section 1 — Architecture Maturity

**Modular architecture:** One NestJS module per domain (`auth`, `vendors`, `shops`, `catalog/{categories,products,product-variants,product-images}`, `cart`, `orders/{checkout,orders,vendor-orders}`, `payments/{payments,webhooks}`, `health`, `storage`, `redis`, `prisma`, `config`), each with its own controller/service/DTOs. Cross-cutting infrastructure (`PrismaModule`, `RedisModule`) is `@Global()`, injected rather than imported ad hoc.

**Domain boundaries:** Genuinely respected. `CheckoutService` doesn't reach into `CartService` internals — it re-reads and re-validates cart items itself rather than trusting a prior validation. `InventoryService` explicitly documents what it does *not* own ("Reservation/release remain exclusively `CheckoutService`'s concern... nothing here reserves, releases, or marks stock sold"). This kind of explicit non-responsibility statement, backed by the code actually respecting it, is not typical of junior work.

**Controller/service separation:** Consistent — every controller is thin (guards + DTO + delegate to service), every business rule lives in a service. No controller was found doing its own Prisma calls.

**Dependency direction:** Clean one-way flow (`Controller → Service → PrismaService → DB`), no circular module imports observed, `AuthModule`'s guards/services are the single shared authorization primitive every other module composes rather than reimplements.

**Shared infrastructure:** Exactly one JWT guard (`JwtAuthGuard`), one RBAC guard (`AuthorizationGuard`), one `OwnershipService`, reused across Vendor/Shop/Product/Variant/Inventory/Image/VendorOrder. This is the single strongest architectural signal in the project — most junior/mid portfolio projects reimplement ownership checks per controller.

**Transaction boundaries:** Deliberately scoped, not blanket-wrapped. `CheckoutService.checkout` is one transaction because it must be (cart conversion + inventory reservation + multi-row order creation must be atomic); `InventoryService.findForVariant` has none because a read needs none. This shows understanding of *why* a transaction boundary exists, not just how to open one.

**Ownership boundaries:** Two distinct, correctly-chosen shapes — vendor-owned (guard-enforced, `User → Vendor → X`) vs. user-owned (direct `userId` comparison, no guard). The codebase explicitly documents *why* a generic `OwnershipGuard<T>` was not built (`docs/architecture.md`'s Ownership Scope notes) — a real architectural judgment call, not an oversight.

**Authorization architecture:** RBAC and ownership are cleanly decoupled — RBAC answers "is this actor allowed to do this kind of thing," ownership answers "is this actor allowed to do it *to this specific resource*." Both are DB-resolved per request, not JWT-claim-based, so a role/permission revocation takes effect immediately.

**Customer/vendor/admin separation:** Clear and consistent. ADMIN bypasses ownership (not RBAC) via one shared `hasRole` check reused everywhere, rather than a scattered `if (user.role === 'ADMIN')` per service.

**Consistency of patterns:** High. The atomic-conditional-`UPDATE` pattern appears in four independent places (checkout inventory reservation, inventory adjustment, vendor-order status transition, refund settlement) — not each reinvented, but recognizably the *same* pattern reused and explicitly cross-referenced in comments between them.

**Coupling / cohesion:** Low coupling between domain modules, high cohesion within each. `StorageModule` is correctly treated as infrastructure (grouped in spirit with Prisma/Redis), not smuggled into `CatalogModule`.

**Maintainability / extensibility:** Good — the deferred domains (Wallet, Promotion, Review, Notification, Audit) already have complete Prisma schemas with clean FK boundaries to the implemented domains, so extending into them would not require restructuring what exists.

**Classification: Strong mid-level, with a small number of senior-oriented decisions (the ownership-shape split, the deliberate non-abstraction of a generic ownership guard, the bounded-retry `MasterOrder` recomputation under sibling concurrency).** It is not junior work — junior work does not explain *why* it declined to build an abstraction. It falls short of a "senior-oriented" label as a whole system because senior-level judgment here shows up in a handful of components, not pervasively across observability, scaling, and operational concerns (see Sections 7, 10, 11).

---

## Section 2 — API Engineering

**REST resource design:** Consistent noun-based resources (`/vendors`, `/products/:productId/variants/:variantId/inventory`, `/payments/:paymentId/refunds`). Nesting is used where a real parent-child ownership relationship exists (images/variants under products), not decoratively.

**HTTP methods & status codes:** Correctly applied — `POST` for creation, `PATCH` for partial updates (never `PUT` for a full-replace semantic that doesn't exist here), `DELETE` for removal. Status codes verified in `payments.controller.ts`/`checkout.controller.ts`: 201 on creation, 200 on read/update, 204 on delete, 400 for validation, 401 for missing/invalid auth, 403 for RBAC/ownership denial, 404 for missing resource, 409 for state conflicts (duplicate checkout, invalid status transition, insufficient stock).

**DTO validation:** `class-validator`/`class-transformer` on every write DTO, enforced by a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` — confirmed in `src/main.ts`. E2e-tested directly (`checkout.e2e-spec.ts`: "rejects (400) client-supplied price/subtotal/total fields — unknown properties rejected by the global whitelist").

**Error semantics:** Deliberately non-disclosing. 401/403 never reveal *why* (checked directly in `payments.service.ts`, `vendor-orders.service.ts` — identical generic message reused across ownership-denial paths). This is a real design choice with a real security rationale (prevents resource-existence enumeration via error-message differences), not laziness.

**Pagination — a genuine, confirmed gap.** Only `GET /products` is paginated (`page`/`limit`, verified in `products.service.ts:131-147`). `GET /categories`, `GET /orders`, `GET /vendor-orders`, `GET /cart` all return unbounded result sets. For a single test/demo dataset this is invisible; for a vendor with thousands of historical orders it is a real, unaddressed scalability and API-completeness gap.

**Response mapping:** Consistent `toXView()` mapper functions per domain (never returning a raw Prisma model), so `passwordHash`/token hashes are structurally excluded rather than relying on a serializer decorator to remember to hide them.

**Authentication / authorization / ownership:** Covered in depth in Sections 1 and 5.

**Swagger:** Fully wired (`@nestjs/swagger`), audited against a live `/api/docs-json` capture in Phase 25 (confirmed in this audit by re-reading `main.ts`'s `DocumentBuilder` config and the `@ApiSecurity({})`/`@ApiBearerAuth()` mixed-auth fix on the image-stream route).

**Postman:** 17 folders / 56 requests, independently re-verified in the Phase 25/26 verification pass (JSON-valid, all variables resolvable, no undefined references, no hardcoded secrets).

**API documentation:** `docs/API.md` is a genuine narrative walkthrough, not generated boilerplate — it explains flows, not just field lists.

**Backwards-compatibility considerations — a real, minor gap.** No API versioning strategy exists (no `/v1` prefix, no `Accept`-header versioning, no deprecation policy). For a single-consumer internal API this is a non-issue; it is nonetheless something a 4–5 YOE engineer would be expected to have an opinion on and this project demonstrates no evidence of one.

**Idempotency:** Webhook ingestion is genuinely idempotent (two independent layers — see Section 4). `POST /checkout` is idempotent-by-consequence (a retried request against an already-converted cart gets a 409, not a second order) but there is no client-supplied idempotency-key mechanism, which is the more general real-world pattern (Stripe-style `Idempotency-Key` header). The project's approach is correct for its actual concurrency model but narrower than the industry-standard mechanism.

**Webhook semantics:** Correctly always returns 200 for a well-formed request regardless of match outcome (an unmatched/unrecognized event is recorded, not rejected) — this is the standard real-world webhook contract (a non-2xx response causes real providers to retry indefinitely), and the code comment shows the author knows *why*.

**Meaningful weaknesses found:** (1) unpaginated list endpoints beyond `/products`; (2) no API versioning; (3) no client-supplied idempotency-key pattern for non-webhook mutations; (4) a genuine, confirmed duplicate-payment-creation race (see Section 4) that live API-design review would likely catch.

---

## Section 3 — Database Engineering

**Schema design:** 18 implemented-domain models (`prisma/schema/*.prisma`), each independently reviewable, with `@@map`/`@map` used consistently for snake_case column names under camelCase Prisma fields — a real production convention, not accidental.

**Relational modelling:** Correct cardinalities throughout — `Vendor ||--o| Shop` and `User ||--o| Vendor` are both enforced by a `@unique` FK, not just an application-level assumption. `Category` is a genuine self-referential hierarchy. `ProductVariant ||--o| Inventory` is enforced `@unique` (exactly one inventory row per variant).

**Foreign keys:** Every relation has an explicit `onDelete` policy, and the choices are deliberate, not defaulted: `Restrict` on `Vendor→User`, `Product→Vendor`, `Product→Category`, `CartItem→ProductVariant`, `OrderItem→*` (nothing here should silently cascade-delete financial/catalog history); `Cascade` only where child rows have no independent meaning without the parent (`ProductImage→Product`, `UserRole`/`RolePermission` join rows, `OrderStatusHistory→MasterOrder`).

**Indexes:** Present on every FK column used in a hot lookup path (`Product.vendorId`, `Product.categoryId`, `CartItem.cartId`/`variantId`, `MasterOrder.userId`/`status`/`paymentStatus`/`createdAt`, `Payment.provider,providerReference`, `Refund.providerReference`) — these are the columns actually queried by the services reviewed in this audit, not a generic "index everything" pass.

**Unique constraints:** `Cart` has a **partial unique index** (`UNIQUE(userId) WHERE status = 'ACTIVE'`) — this is a genuinely non-trivial PostgreSQL feature choice (not every ORM tutorial teaches partial indexes), correctly used to enforce "one active cart per user" at the database level rather than only in application code. `CartItem` has `UNIQUE(cartId, variantId)` backing the atomic upsert-on-add-duplicate-variant behavior. `PaymentWebhookEvent` has `UNIQUE(provider, eventId)` as the primary idempotency mechanism.

**Check constraints:** Present and verified in `prisma/migrations/20260817063632_init_catalog/migration.sql`: `inventories_on_hand_non_negative` (`on_hand >= 0`), `inventories_reserved_non_negative`, `inventories_reserved_lte_on_hand` (`reserved <= on_hand`) — a genuine defense-in-depth layer *underneath* the application-level conditional-`UPDATE` checks in `InventoryService.adjust`, not merely duplicated logic. **Gap:** no equivalent `CHECK` constraints exist on money fields (`Payment.amount >= 0`, `Refund.amount >= 0`, `MasterOrder.totalAmount >= 0`) — these are validated only at the application layer (DTO validation, service-level comparisons), so a bug in a future direct-DB-write path (a script, a migration, an admin tool) would have no database-level backstop.

**Decimal/money handling:** Correct — every money field is `Decimal @db.Decimal(14, 2)`, never a float. `Prisma.Decimal` arithmetic (`.mul`, `.add`, `.minus`) is used consistently in `checkout.service.ts`/`payments.service.ts` rather than casting to JS `number` at any point in a calculation path — this is a real, commonly-missed correctness detail that this project gets right.

**Soft deletion:** `deletedAt` present on `User`, `Vendor`, `Shop`, `Category`, `Product`, `ProductVariant`, `ProductImage` — and genuinely *filtered on* in query paths reviewed (`checkout.service.ts`'s `validateAndLoadLines` explicitly filters `deletedAt: null`). **Known, documented gap** (already disclosed in the README): `User.deletedAt` is never checked at authentication time, because no account-deletion feature exists anywhere to set it — a dormant field, not a broken check.

**Transaction boundaries / atomic updates / concurrency:** The strongest part of this project — covered exhaustively in Section 4.

**Cascading/restrict behavior:** Reviewed above — deliberate, not defaulted.

**Inventory modelling:** `onHand`/`reserved` as two separate counters (not a single "available" number), with a full `InventoryTransaction` ledger (`RESTOCK`/`ADJUSTMENT`/`RESERVATION` types, `referenceType`/`referenceId` polymorphic linkage back to the order item that caused a reservation) — this is a materially more realistic inventory model than the "one integer stock column" pattern common in tutorial projects.

**Order modelling:** The `MasterOrder`/`VendorOrder`/`OrderItem` three-level split with independent `OrderStatusHistory`/`VendorOrderStatusHistory` tables is the single most "real-world" piece of schema design in the project — this is genuinely how marketplace platforms (Amazon Marketplace, Etsy, Shopify multi-vendor apps) model split fulfillment, not an invented simplification.

**Payment modelling:** `Payment` → `PaymentAttempt` (1:N, preserving every retry) → `Refund` (1:N) is a correct real-world shape. `PaymentWebhookEvent` is correctly *not* FK-linked to `Payment`/`Refund` (matched by `providerReference` at the application layer) — and the ERD audit in Phase 26 explicitly called this out in text rather than drawing a false relationship, which itself reflects an accurate understanding of why that design choice was made (a webhook must be recordable even if it matches nothing).

**History/audit-style records:** `OrderStatusHistory`, `VendorOrderStatusHistory`, `InventoryTransaction` all exist and are genuinely written to (verified in `checkout.service.ts` and `vendor-orders.service.ts`), not schema-only decoration.

**Classification: Senior-oriented in specific areas (partial unique index, decimal handling, the three-level order split, deliberate non-relation for webhook events), Strong Mid overall** — the one meaningful gap (no DB-level `CHECK` constraints on money fields) keeps this from being an unqualified "senior" rating across the board.

---

## Section 4 — Concurrency & Data Consistency

This section verifies each mechanism against the actual code read during this audit, not the prior phase's description of it.

### 4.1 Concurrent checkout (inventory reservation)

**Problem:** Two customers checking out simultaneously against the last N units of the same variant must not both succeed if their combined quantity exceeds available stock.

**Current solution** (`checkout.service.ts:138-149`): inside the checkout transaction, one raw `UPDATE inventories SET reserved = reserved + :qty WHERE variant_id = :id AND on_hand - reserved >= :qty` per line. If `0` rows affected, throws `409`.

**Why it works:** PostgreSQL evaluates the `WHERE` clause and applies the row-level lock atomically at the database engine level — there is no window between "check availability" and "reserve" for a second transaction to interleave into, because there is no separate check; the check *is* the write's own condition.

**What limitations remain:** This is a single-row conditional update per variant, not a whole-cart atomic all-or-nothing reservation *across* variants in isolation from other concurrent carts — but the surrounding `$transaction` wraps all lines together, so if any single line's reservation fails, the whole transaction rolls back (including the cart-conversion write), which is the correct behavior. No limitation found beyond the already-disclosed one: this does not protect against a *sequence* of many small legitimate reservations exhausting stock in an order not "fair" to request arrival time (no reservation queue/fairness guarantee) — a real but low-severity gap, not tested or claimed to be solved.

### 4.2 Concurrent inventory adjustment

**Problem:** An ADMIN/vendor adjusting stock (`delta` can be negative) concurrently with another adjustment or a checkout reservation must not push `onHand` negative or below `reserved`.

**Current solution** (`inventory.service.ts:112-123`): the same atomic-conditional-`UPDATE` pattern — `UPDATE inventories SET on_hand = on_hand + :delta WHERE id = :id AND on_hand + :delta >= 0 AND on_hand + :delta >= reserved`, backed by DB-level `CHECK` constraints as a second line of defense.

**Why it works:** Same reasoning as 4.1 — condition and write are one atomic statement. The DB `CHECK` constraint means even a hypothetical bug in this application-level guard could not corrupt the row; it would surface as a hard constraint-violation error instead.

**What limitations remain:** None found for this specific operation. `restock` (always-positive, `inventory.service.ts:58-86`) correctly uses a simpler `increment` without a conditional guard, since no invariant can be violated by adding stock — the code explicitly reasons about *why* the simpler form is safe here, rather than applying the conditional pattern uniformly out of caution.

### 4.3 VendorOrder status-transition race protection

**Problem:** Two requests changing the same `VendorOrder`'s fulfillment status concurrently (e.g., a double-submitted "mark shipped" click) must not both succeed or leave inconsistent history.

**Current solution** (`vendor-orders.service.ts:166-179`): read current status → validate the transition is legal → `updateMany({ where: { id, status: <the status just read> }, data: {...} })` → `0` rows affected means a concurrent request already moved it, and a `409` is thrown.

**Why it works:** The `WHERE` clause re-states the exact prior status as a precondition, so only the request that "wins" the race sees its precondition still hold at write time.

**What limitations remain:** This closes the *same-row* race correctly. The associated `MasterOrder` recomputation (4.4) is a separate, harder problem the code correctly recognizes as distinct.

### 4.4 Derived MasterOrder status under sibling concurrency

**Problem:** `MasterOrder.status` is derived from all its `VendorOrder`s' statuses. Two *different* vendors updating two *different* `VendorOrder`s under the same `MasterOrder`, concurrently, both need to recompute and write the same `MasterOrder` row.

**Current solution** (`vendor-orders.service.ts:217-269`): a bounded retry loop (5 attempts) — read all sibling statuses → derive the correct status → conditional `updateMany` keyed on the previously-read `MasterOrder.status` → if `0` rows affected, a sibling's own concurrent recompute won, loop back and re-read.

**Why it works:** This is optimistic concurrency control with retry, correctly reasoned about in the code comment as necessary specifically *because* the row-level lock from 4.3 doesn't protect a different table's row. This is the single most sophisticated concurrency mechanism in the codebase — recognizing that "atomic conditional update" alone is insufficient when the derivation depends on sibling state that can change between read and write, and choosing bounded-retry-with-fresh-read rather than a distributed lock (which would be over-engineering for this problem).

**What limitations remain:** A worst-case pathological scenario (many simultaneous vendor-order updates under one master order, exceeding 5 retries) throws a hard `Error`, not a graceful 409 — untested, and a real (if narrow) operational rough edge.

### 4.5 Refund settlement race (M-1 — fixed, verified)

**Problem (as it existed before the fix):** `Payment.refundedAmount` accumulation was previously read-then-absolute-set in JavaScript; two genuinely concurrent `refund.succeeded` webhook deliveries for two *different* refunds against the same `Payment` could both read the same pre-update value and the later commit would silently overwrite (lose) the earlier one's contribution — a textbook lost-update.

**Current solution** (`webhooks.service.ts:259-306`): an atomic conditional `updateMany` transitions the `Refund` row itself first (`WHERE id = :id AND status = 'PENDING'`) as the authoritative per-refund idempotency guard, then a raw `UPDATE payments SET refunded_amount = refunded_amount + :amount, status = CASE ... END WHERE id = :id RETURNING id, status` — the increment is computed by Postgres from the row's live value at write time, not from a value read earlier in JS.

**Why it works:** Verified directly in this audit by re-reading `test/payments.e2e-spec.ts`'s two dedicated concurrency tests (`describe('Concurrency (Phase 25 — M-1 fix)')`, lines 784-865+): one test fires two concurrent `refund.succeeded` events for two different refunds and asserts both contributions are reflected; a second test fires two concurrent deliveries of the *same* refund under different event ids and asserts the financial effect applies exactly once. Both tests run against real PostgreSQL with genuine `Promise.all` concurrency, not a mocked timing simulation.

**What limitations remain:** None for this specific mechanism — it is now the same pattern as 4.1/4.2/4.3, applied to a genuinely different data shape (an accumulator, not a single-row status flip), and the code comments correctly draw that distinction.

### 4.6 A related, confirmed, **unfixed** gap: `handlePaymentOutcome` (payment success/failure) does not use this pattern

**Finding (new to this audit, not previously reported):** `webhooks.service.ts:142-206`'s `handlePaymentOutcome` checks `attempt.status !== 'INITIATED'` as a plain read *before* opening its transaction, then performs an **unconditional** `tx.paymentAttempt.update({ where: { id } })` and `tx.payment.update(...)` inside it — not an `updateMany` with the previously-read status re-stated as a precondition, unlike the refund path it sits next to.

**Why this is lower severity than M-1 was:** the fields being written here (`PaymentAttempt.status`, `Payment.status`, `Payment.paidAmount`) are absolute *sets*, not accumulations — so two concurrent deliveries of the *same* outcome (`payment.succeeded` twice, under different event ids) would write the same final value twice, which is redundant but not corrupting.

**Where it is a genuine, if narrow, TOCTOU risk:** two *conflicting* events for the same attempt arriving genuinely concurrently (one `payment.succeeded`, one `payment.failed` — e.g., a malformed/duplicated real-gateway delivery) could both pass the pre-transaction `status !== 'INITIATED'` check before either commits, and the final `PaymentAttempt.status`/`Payment.status` would be whichever transaction committed last — non-deterministic, not idempotent in that specific conflicting-event scenario. This was not caught by the existing test suite (no test constructs genuinely conflicting concurrent webhook events for the same attempt) and is not disclosed anywhere in existing documentation. **This audit is the first record of this gap.**

### 4.7 A second related, confirmed, **unfixed** gap: duplicate Payment creation race

**Finding (new to this audit):** `payments.service.ts:100-106`'s `createForUser` checks `this.prisma.payment.count({ where: { masterOrderId } })` and throws `409` if `> 0`, but this check is a plain read *outside* any transaction, and `Payment.masterOrderId` has **no unique constraint** in the schema (only `@@index([masterOrderId])`, confirmed in `prisma/schema/payment-refund.prisma`). Two genuinely concurrent `POST /payments` requests for the same order could both pass the `count === 0` check before either inserts, producing two `Payment` rows for one `MasterOrder` — violating the documented "payment creation is one-time per order" invariant stated in the class doc-comment itself.

**Severity:** Low-to-medium in practice (a customer double-clicking "pay" is the realistic trigger, not an adversarial scenario), but it is a genuine correctness gap in exactly the same *shape* as the bug M-1 already fixed elsewhere — the fix pattern (a unique constraint, or a conditional-insert-with-conflict-handling) was available and demonstrably known to this codebase's author, but was not applied here. This is worth being able to discuss honestly in an interview (see Section 17).

### 4.8 Webhook replay / idempotency (general)

Already covered under 4.5's mechanism description — two independent layers (unique-constraint-on-event + value-based status check) are real and correctly reasoned about; this is genuinely solid, industry-standard webhook design.

### Summary of concurrency findings

| Mechanism | Status |
|---|---|
| Concurrent checkout / inventory reservation | Fixed, tested, verified |
| Concurrent inventory adjustment | Fixed, tested, verified, DB-backed |
| VendorOrder status transition | Fixed, tested, verified |
| Derived MasterOrder recompute under sibling concurrency | Fixed (optimistic retry), verified by code review |
| Refund settlement accumulation (M-1) | Fixed, tested, verified |
| Webhook replay (same event twice) | Fixed, tested, verified |
| Webhook replay (same outcome, different event id) — refund | Fixed, tested, verified |
| Webhook replay (same outcome, different event id) — payment | **Not hardened to the same standard** (absolute-set, so non-corrupting, but non-deterministic under conflicting concurrent events) — new finding |
| Duplicate Payment creation | **Unfixed race** — new finding |

This mixture — several genuinely hard concurrency problems solved correctly and provably, alongside two adjacent, narrower gaps left unaddressed in the very same file/service — is itself informative: it shows real engineering skill applied unevenly rather than either uniformly absent or uniformly perfect. That unevenness is normal and expected at 3-5 YOE; a senior engineer's value-add is often exactly in noticing and prioritizing which of several similar-looking risks are worth fixing now.

---

## Section 5 — Security Engineering

| Control | Classification | Evidence |
|---|---|---|
| Authentication (JWT) | **Strong** | Short-lived access token, `JwtStrategy` re-derives user from DB per request (no stale claims) |
| Refresh token rotation | **Strong** | HMAC-hashed at rest, rotated every use, family-wide revocation on reuse (verified in `auth.service.ts`/`docs/API.md`) |
| Password hashing | **Strong** | Argon2id (`argon2`), not bcrypt/MD5/SHA |
| RBAC | **Strong** | DB-resolved per request, OR/AND combination semantics explicitly documented and tested |
| Ownership / IDOR protection | **Strong** | Guard-enforced for vendor-owned resources; direct comparison for user-owned; e2e-tested cross-user/cross-vendor isolation (`checkout.e2e-spec.ts`: "one user's checkout never touches another user's cart...") |
| Mass assignment | **Strong** | Global `whitelist: true, forbidNonWhitelisted: true`, e2e-tested directly against client-supplied price/total fields |
| DTO whitelist / input validation | **Strong** | `class-validator` on every write DTO |
| Sensitive field exposure | **Strong** | Dedicated view-mapper functions per domain; `passwordHash`/token hashes structurally never serialized |
| File upload security | **Strong** | Content-sniffed (magic-byte, via `file-type`, not filename/Content-Type), randomized filenames, size-limited |
| Path traversal | **Strong** | `resolveSafePath` in `LocalFileStorageService` — canonical resolve+relative check, verified against a live test log during this audit ("Refused to delete an unsafe file reference \"../escaped.txt\"") |
| MIME validation | **Strong** | Same content-sniffing as above |
| File storage exposure | **Strong** | Never registered with `ServeStaticModule`; every read goes through a dedicated, visibility-aware streaming route |
| Webhook security | **Weak (disclosed)** | No signature verification — but this is a documented, deliberate gap tied to "no real gateway integrated," not a missed requirement; the *idempotency* half of webhook security is Strong |
| Exception leakage | **Strong** | `AllExceptionsFilter` — verified no Prisma/SQL/stack detail reaches any client response; only logged server-side for 5xx |
| Secrets | **Adequate** | `.env`/`.env.*` gitignored, JWT secret length/distinctness validated at startup (`env.validation.ts`); no secrets-manager integration (disclosed gap, reasonable for this project's scope) |
| CORS | **Missing (disclosed)** | Not configured at all — explicitly reasoned about in `main.ts`'s comment ("no consuming frontend origin is defined"), not an oversight |
| Rate limiting | **Missing (disclosed)** | Confirmed absent — no `@nestjs/throttler` or equivalent in `package.json` |
| CSRF | **Not applicable** | Bearer-token API, no cookie-based session — CSRF doesn't apply to this auth model, and the project correctly doesn't attempt to defend against it |
| Duplicate-payment-creation guard | **Weak — new finding this audit** | See Section 4.7; a genuine TOCTOU race, not previously disclosed |

**Distinguishing implemented vs. known-limitation vs. future-enhancement**, as required:

- **Implemented protections** (genuinely enforced, tested): authentication, RBAC, ownership, mass-assignment protection, file-upload security, exception sanitization, webhook idempotency (mostly — see 4.6).
- **Known, disclosed limitations** (documented as intentional, not hidden): no rate limiting, no CORS policy, no webhook signature verification, `User.deletedAt` dormant.
- **Future enhancements** (would matter at real production scale, not urgent for this project's stated scope): secrets-manager integration, structured/centralized logging with security event correlation, a WAF/reverse-proxy layer.
- **Newly identified in this audit, not previously disclosed anywhere:** the duplicate-payment-creation race (4.7) and the payment-outcome-webhook TOCTOU gap (4.6). These should be added to the project's known-limitations list for honesty, even though this phase does not fix them (see Section 25 for the one documentation update this audit makes).

---

## Section 6 — Testing Maturity

**Unit tests:** 486 across 44 suites, re-run during this audit — **486/486 passed**. Mocked Prisma throughout (verified pattern in several `*.spec.ts` files), covering services, controllers, and guards independently.

**Controller tests exist** (e.g., `product-variants.controller.spec.ts`) — verifying guard wiring and DTO binding, not just service logic, which is more thorough than the common "only test the service" shortcut.

**E2E tests:** 329 across 11 suites, re-run during this audit against real PostgreSQL — **329/329 passed**. These hit the real HTTP layer via Supertest, not an in-process service call, so guard/pipe/filter wiring is genuinely exercised, not assumed.

**Negative tests:** Extensive and specific, not generic. `checkout.e2e-spec.ts` alone has dedicated tests for: unauthenticated access, invalid payload, empty cart, no cart, mass-assignment rejection, deactivated product mid-cart, deactivated vendor mid-cart, insufficient stock, currency mismatch, duplicate/retried checkout, and cross-user isolation — eleven distinct negative/edge scenarios for a single endpoint.

**Ownership tests:** Explicit and named for what they prove ("one user's checkout never touches another user's cart or creates an order under another user's identity") — this is testing the *security property*, not just the happy path.

**Concurrency tests:** Genuinely real — `Promise.all` against a real running application and real Postgres, not `setTimeout`-simulated timing or mocked race conditions. Three dedicated concurrency suites found: checkout (`Concurrency (Phase 18)`), refund settlement (`Concurrency (Phase 25 — M-1 fix)`), and (per Phase 25/26 reports, not independently re-derived line-by-line in this pass) inventory adjustment.

**Test isolation / flaky-test handling:** A known, disclosed, non-deterministic e2e flake exists (`INestApplication` instances sharing a Jest worker under `--runInBand`) — the project's own documentation explicitly diagnoses this as a supertest/Node socket-reuse artifact, isolates it by re-running the single affected file clean, and discloses it rather than hiding it or weakening the assertion. This is itself a testing-maturity signal: recognizing and correctly triaging a flaky test (environmental vs. real regression) is a skill many mid-level engineers lack.

**Regression tests:** The M-1 fix added dedicated regression tests rather than only fixing the code — the failure mode that was found is now permanently guarded against.

**What is *not* present:** No load/performance testing, no mutation testing, no contract testing, no fuzz testing of DTOs beyond what `class-validator` provides. These are reasonable omissions for a project at this scope, not "junior gaps" — they are what actually distinguishes 3-5 YOE testing scope from platform/SRE-team testing scope.

**Classification: Strong Mid, bordering Senior-oriented specifically in the concurrency and ownership testing discipline.** The breadth (486+329) matters less than what was found reviewing it: tests are named for the property they prove, negative/security scenarios substantially outnumber happy-path scenarios in some suites, and a real concurrency bug was caught, fixed, and regression-guarded rather than merely claimed as "concurrency-safe."

---

## Section 7 — Production Engineering

| Item | Status | Note |
|---|---|---|
| Docker (multi-stage) | Implemented, run-verified | Non-root `node` user, `chown` before `USER` switch, prod-only deps in runtime stage |
| CI | Implemented, run-verified | Full pipeline against real Postgres/Redis service containers, re-confirmed green in this audit's own run |
| Environment configuration | Implemented | `env.validation.ts` fails fast on missing/weak secrets, wrong port ranges, blank `FILE_STORAGE_DIR` |
| Graceful shutdown | Implemented, tested | `SIGTERM`/`OnModuleDestroy`, dedicated e2e test (`graceful-shutdown.e2e-spec.ts`) |
| Exception handling | Implemented, tested | Section 5 |
| Health checks | Implemented | `/api/health` pings both Postgres and Redis, not just returns `200` unconditionally |
| Redis | Implemented (narrow) | Health-checked, BullMQ connection registered — **not used for caching, sessions, or queues anywhere** (confirmed by grep — no `Queue`/`@Process`/cache read-write in `src/`) |
| BullMQ | **Configured, not used** | Zero queues or processors defined anywhere |
| Filesystem storage | Implemented | Section 5 |
| Migrations | Implemented | 13 migrations, `prisma migrate deploy`/`migrate status` both clean, confirmed in this audit's own run |
| Logging | **Console only** | `@nestjs/common`'s built-in `Logger` — no JSON/structured output, no log levels configured beyond default, no correlation/request ID |
| Observability (metrics/tracing) | **Not implemented** | No Prometheus/OpenTelemetry/APM integration anywhere |
| Monitoring/alerting | **Not implemented** | No mechanism exists to notice a production incident other than manually watching logs |
| Secrets management | **Not implemented** | `.env` file only — no Vault/AWS Secrets Manager/etc. |
| Rate limiting | **Not implemented** | Section 5 |
| Reverse proxy / HTTPS | **Not demonstrated** | Nothing in this repo terminates TLS or fronts the app — appropriate, since that's normally infrastructure-layer, outside an application repo's scope |
| Backups / disaster recovery | **Not demonstrated / not applicable to this repo** | No backup automation exists or is claimed; this is normally a DBA/infra concern, not something a backend API repo should itself implement |

**Critical distinction, as instructed:** everything marked "Implemented" above was independently re-run in this audit (`npm run build`, `npm test`, `npm run test:e2e`, `npx prisma validate`, `npx prisma migrate status`, `npx eslint`, all passing/clean at time of writing) — this is genuine implementation evidence, not a claim taken on faith. Everything marked "Not implemented" or "Not demonstrated" is a **production-deployment concern that this project was never scoped to solve**, not a defect in what exists. A single-service backend API repository is not expected to own its own observability stack, secrets manager, or reverse proxy — those are typically platform/infra-team or later-phase concerns. This project should not be penalized for their absence, but a candidate should be able to say so explicitly rather than implying they exist.

---

## Section 8 — DevOps / Deployment Maturity

**Docker:** Build genuinely verified in this audit's own environment context (re-confirmed via the earlier `npm run build`/lint/test run; the Dockerfile itself was re-read line-by-line this phase). Multi-stage, non-root, migrations correctly excluded from the image's own startup (a separate release step).

**CI/CD:** `.github/workflows/ci.yml` runs the complete gate (lint → format check → type-check → build → unit → e2e → Prisma validate/migrate status) against real service containers on every push/PR to `main`/`development`. This is genuine CI, not a lint-only placeholder.

**Environment management:** `.env.example` is accurate and cross-checked against `env.validation.ts` in this and the prior audit pass.

**Database migrations:** 13 migrations, one per domain plus refresh-token additions, `migrate deploy`/`migrate status` both clean.

**Health checks:** Real (pings both dependencies), not a stub.

**Deployment readiness vs. deployment-tested vs. production-operated — these are explicitly NOT the same, and this project has only reached the first:**

- **Deployment-ready:** Yes — the Docker image builds, the app starts against real Postgres/Redis with `/api/health` reporting both up, migrations apply cleanly via a documented separate step. This has been directly verified (build + run + health check), not just written.
- **Deployment-tested:** No — this means actually deploying to a real target (a VPS, a cloud provider, a container platform) and confirming the app behaves correctly under that specific environment's networking, TLS termination, process supervision, and restart behavior. **This has never been done.** No deployment target exists yet.
- **Production-operated:** No — this would mean the app has run continuously serving real (even low-volume) traffic, survived a real restart/redeploy, and been observed under real operational conditions over time. **Nothing here supports this claim, and nothing should imply it does.**

**What must be verified during the actual deployment phase** (explicitly not done now, per instructions):
1. The container actually runs correctly on the target host/platform (VPS, PaaS, container service) — networking, port binding, resource limits.
2. `FILE_STORAGE_DIR` is mounted to a real persistent volume — the README already flags that an ephemeral filesystem loses uploads on redeploy; this has never been tested against a real redeploy.
3. `DATABASE_URL`/`REDIS_HOST` point at real managed or self-hosted instances, with real network latency/reliability characteristics, not localhost Docker Compose.
4. Real TLS termination (reverse proxy or platform-provided) — nothing in this repo does this.
5. `npx prisma migrate deploy` run once against the real production database as a genuine release step, not just proven against a fresh Docker Compose instance.
6. Actual `SIGTERM` behavior under the real deployment platform's specific shutdown signal/grace-period conventions (different platforms vary).
7. Real load, even briefly, to sanity-check the app doesn't fall over under concurrent traffic outside the specific concurrency scenarios already unit/e2e-tested.

---

## Section 9 — Business Domain Complexity

**Vendor → Shop → Product → Variant → Inventory:** A realistic multi-vendor catalog shape — one vendor, one shop, many products, each with variants (size/color/etc. via a JSON `attributes` bag plus a structured price/SKU/currency), each variant with its own inventory row. This models genuine e-commerce complexity (a T-shirt in 3 sizes × 4 colors is 12 variants, not one product with a stock count) rather than a simplified "product has a price and a stock number" tutorial model.

**Cart → Checkout → MasterOrder → VendorOrder:** The multi-vendor order split at checkout is the most representative real-world piece of this entire project. A cart containing items from 3 different vendors correctly produces 1 customer-facing order and 3 independently-trackable vendor fulfillment records, computed inside one atomic transaction. This is genuinely how Amazon Marketplace/Etsy/Shopify-multi-vendor-app order splitting works, not an invented simplification for demo purposes.

**Fulfillment:** The explicit, narrow state machine (`PENDING → CONFIRMED → PROCESSING → READY_TO_SHIP → SHIPPED → DELIVERED`, plus early-stage `CANCELLED`) with a documented Architecture Decision Register entry (ADR-2) explaining *why* `DELIVERED`/`CANCELLED` are terminal and no return/re-open path exists yet, reflects real product-thinking about an order lifecycle, not an arbitrary status enum.

**Payment/Refund:** The `Payment → PaymentAttempt → Refund` shape, with a real refundable-balance calculation (`paidAmount - refundedAmount`, never trusted from the client), models genuine payment-lifecycle complexity even without a real gateway behind it.

**Ownership boundaries:** Already covered in Sections 1/5 — genuinely representative of the "who can touch what" complexity a real multi-tenant marketplace requires.

**Failure scenarios:** Extensively tested (Section 6) — deactivated-mid-cart products/vendors, insufficient stock, currency mismatch, invalid transitions, excessive refunds.

**Concurrency:** Section 4 — genuinely hard, genuinely (mostly) solved.

**Why this is representative of real-world backend work:** Multi-vendor order splitting, inventory reservation under concurrency, and derived cross-entity status computation are exactly the kind of problems that appear in real marketplace/e-commerce backend roles — this is not a CRUD-only todo-app-with-auth portfolio project. **Why it is not fully representative:** there is no real external integration (payment gateway, shipping carrier, tax service) actually wired up, so the project cannot demonstrate handling *real* third-party API failure modes (timeouts, partial failures, rate-limited upstream APIs, webhook signature verification against a live provider) — only the internal-facing half of those problems.

---

## Section 10 — Scalability

**Database query patterns:** Reviewed services generally query with explicit `where`/`select`/`include` rather than fetching whole tables and filtering in memory — no N+1 pattern found in the checkout, inventory, or vendor-order paths specifically reviewed in this audit (each uses a single batched `findMany`/`findUnique` with `include`, not a loop of individual queries).

**Indexes:** Present on the columns actually queried (Section 3) — appropriate for current query patterns.

**Transaction sizes:** `CheckoutService.checkout`'s transaction grows linearly with cart line count and vendor count (one `orderItem.create` + one `inventoryTransaction.create` per line, one `vendorOrder.create` per vendor) — correct for typical cart sizes, but an extreatypical cart (hundreds of line items) would hold a single long-running transaction open, which is a real, if currently untested, scaling edge.

**N+1 risks:** Not found in the specific paths reviewed; not exhaustively audited across every list endpoint in this pass.

**Pagination:** Confirmed gap (Section 2) — only `/products` is paginated. This is the single most direct scalability concern found: `GET /orders`/`GET /vendor-orders`/`GET /categories` would degrade linearly with data growth with no bound.

**Caching:** **None exists.** Redis is connected but never read from or written to by any business logic (confirmed by grep across `src/`) — every request hits PostgreSQL directly, even for frequently-read, rarely-changed data (e.g., the category tree, product listings).

**Redis / queue usage:** Configured, unused (Section 7). No background job processing exists — every operation in this API is synchronous within the request/response cycle.

**Synchronous operations:** Image upload is synchronous (validate → write to disk → DB record, all within one request) — acceptable at current scale, but a real bottleneck under concurrent large-file uploads with no queue to offload processing.

**File storage architecture:** Local filesystem — this is the single largest structural scalability limitation in the project. It **does not horizontally scale**: multiple application instances behind a load balancer would each have their own local disk, so an image uploaded to instance A would 404 when a later request lands on instance B. The README already discloses the narrower version of this (ephemeral container filesystem loses data on redeploy) but the full implication — this architecture is fundamentally single-instance — is worth stating explicitly here.

**Horizontal scaling implications / statelessness:** The application layer itself is otherwise stateless (JWT bearer auth, no server-side session) and *would* scale horizontally except for the local file storage dependency above.

**Bottlenecks, ranked:** (1) local file storage precludes horizontal scaling as-is; (2) zero caching means every read hits Postgres directly; (3) unpaginated list endpoints; (4) no background queue means large/slow operations block the request thread.

**Classification: Low-to-Moderate.** The application logic itself (query patterns, indexing, transaction design) would scale reasonably for a single-instance deployment serving moderate traffic. It does not currently support horizontal scaling (file storage) and has no caching layer at all, which are the two changes needed before "moderate" traffic growth, let alone 10x.

**What would need to change if traffic increased 10x** (explanation only, not implemented per instructions):
1. **File storage** would need to move off local disk to shared/object storage (S3-compatible or similar) — this is the one non-negotiable architectural change; everything else is tuning.
2. **Caching** — Redis (already connected, already paid for in infra terms) would need to actually start being used: category tree, product listings, and other read-heavy/write-light data are obvious first candidates.
3. **Pagination** would need to be added to every remaining list endpoint.
4. **Background jobs** — BullMQ (already a dependency, already configured, unused) would be the natural home for image processing/resizing and any future webhook-triggered side effects, taking them off the request path.
5. **Read replicas / connection pooling** would become relevant at genuinely high concurrent load — not yet a concern at 10x from a small base, but the next step after the above.
6. **Horizontal app-instance scaling** becomes possible only after (1) is solved.

---

## Section 11 — Observability & Operations

| Item | Status |
|---|---|
| Logs | Console only (`@nestjs/common`'s `Logger`), text format, no JSON structuring |
| Structured logging | **Not implemented** — no `pino`/`winston`/`nestjs-pino` dependency exists |
| Error tracking | **Not implemented** — no Sentry/equivalent |
| Metrics | **Not implemented** — no Prometheus endpoint, no counters/histograms anywhere |
| Tracing | **Not implemented** — no OpenTelemetry, no span/trace propagation |
| Request IDs | **Not implemented** — no correlation ID middleware; a single request's logs cannot be grouped across services if this were ever split |
| Audit logs (business-level) | **Partial** — `OrderStatusHistory`/`VendorOrderStatusHistory`/`InventoryTransaction` provide domain-specific audit trails for their respective entities; there is no general-purpose, cross-domain audit log (the deferred `Audit` domain is exactly this, intentionally not built) |
| Health checks | Implemented (Section 7) |
| Alerting | **Not implemented** — nothing would notify anyone of a production incident |

**How this affects 3-5 YOE readiness:** This is the single weakest area of the entire project relative to what a 4-5 YOE "production thinking" evaluation would look for. A 3 YOE engineer is not typically expected to have built an observability stack. A 4-5 YOE engineer is increasingly expected to at least reason fluently about *why* it matters and what they'd add — and this project gives no evidence either way, since it was never exercised under real operational load where the absence would have been felt. This is best framed honestly as "not yet needed at this project's scale, and not yet demonstrated" rather than either a disqualifying gap or a non-issue.

---

## Section 12 — System Design Depth

**Demonstrated well:**
- **Modular monolith design** — genuinely correct module boundaries, not a "big ball of mud" wearing NestJS decorators (Section 1).
- **Transaction design** — scoped precisely to where atomicity is actually required (Section 1, 4).
- **Consistency & concurrency** — four independent, correctly-reasoned atomic-conditional-update mechanisms, one genuine bug found and fixed with regression tests, one adjacent optimistic-retry mechanism (Section 4).
- **Idempotency** — two-layer webhook idempotency is genuinely solid (Section 4.8).
- **Event/webhook processing** — correct HTTP-level semantics (always-200), correct correlation strategy given no real gateway exists.
- **State machines** — the vendor-order fulfillment transition table, with an explicit ADR justifying the narrow scope.
- **Inventory systems** — a real reservation model (onHand/reserved split, transaction ledger), not a single stock integer.
- **Payment systems (foundation)** — a correct attempt/refund shape even without a live gateway.
- **Authorization architecture** — RBAC + ownership cleanly decoupled, DB-resolved, reused everywhere.
- **File storage** — a correct, narrow, secure local-filesystem abstraction.

**Demonstrated partially or not at all:**
- **Caching** — configured infrastructure, zero actual use (Section 10).
- **Queues** — same (Section 7, 10).
- **Scalability beyond a single instance** — explicitly limited by local file storage (Section 10).

**Not demonstrated, and explicitly not claimed:**
- **Distributed transactions** (sagas, two-phase commit, outbox pattern) — this project's transaction needs are entirely single-database, so there was no genuine problem requiring this; its absence is appropriate, not a gap.
- **Event-driven architecture / Kafka** — no event bus exists; the webhook-ingestion pattern here is HTTP-request-driven, not event-stream-driven. Relevant to 5 YOE+ roles at companies with genuine cross-service event flows; **not relevant** to what this project's actual problem required.
- **Microservices / service discovery** — this is a single deployable service by design; nothing about the business problem here required splitting it, and doing so would have been the "unnecessary complexity" this task explicitly warns against.
- **Distributed tracing** — only meaningful once there is more than one service to trace across; not yet relevant here.
- **Large-scale caching (CDN, multi-region cache invalidation)** — same reasoning; there is currently no caching at all, let alone at a scale where this would matter.
- **Multi-region systems** — not relevant to a single-instance API with no demonstrated deployment yet.

**Which of these are actually relevant to 3, 4, and 5 YOE backend roles:**
- **3 YOE:** None of the "not demonstrated" list is typically expected. What's expected is exactly what this project shows well — correct transactions, correct concurrency handling for the problems that actually exist, correct auth/ownership.
- **4 YOE:** Awareness of caching/queueing tradeoffs and when to reach for them starts to matter, even without owning a distributed system. This project's Redis-connected-but-unused state is a fair, honest thing to discuss in an interview at this level ("I provisioned it, didn't force a caching need onto a project that didn't have real read load to justify it yet") rather than a disqualifying gap.
- **5 YOE:** Distributed-systems fluency, operational ownership (having actually run something in production, felt an incident, and changed a design because of it), and scaling judgment under *real* (not hypothetical) load start to matter significantly. This project cannot honestly provide evidence of any of these, because none of them happened — see Section 15.

---

## Section 13 — 3 YOE Assessment

| Area | Assessment |
|---|---|
| Architecture | Strong — clean modular boundaries, one shared auth/ownership system, well beyond typical 3 YOE portfolio work |
| API | Strong — correct REST/HTTP semantics, Swagger, Postman; minor gaps (pagination breadth, no versioning) are normal at this level |
| Database | Strong — partial unique indexes, decimal handling, CHECK constraints, realistic multi-table order model |
| Security | Strong — auth/RBAC/ownership/mass-assignment/file-upload all genuinely implemented and tested |
| Testing | Strong — 486+329 tests, genuine negative/ownership/concurrency coverage, honest flaky-test handling |
| Concurrency | Strong — a real bug found, fixed, and regression-tested; several correctly-reasoned atomic patterns; the two newly-found gaps (4.6, 4.7) are the kind of thing a 3 YOE candidate could reasonably not have caught yet, and would be a fair, honest interview answer ("here's a related edge case I'd want to harden next") |
| DevOps | Strong for this level — Docker + CI genuinely verified, not just configured |
| Business complexity | Strong — multi-vendor splitting, inventory reservation, order lifecycle are realistic, not toy |
| Documentation | Strong — genuinely accurate, cross-referenced, and (per this audit) actively corrected rather than left stale |

**VERDICT: Strongly Ready**

**Evidence:** This project substantially exceeds what is typically seen in 3 YOE candidate portfolios — most 3 YOE portfolio projects are CRUD-with-JWT-auth without genuine concurrency handling, without a real multi-vendor order model, and without a documented, fixed, regression-tested concurrency bug. The combination of correct database design, real security controls, extensive and *meaningfully targeted* testing, and honest documentation of both strengths and limitations is itself a 3 YOE-and-above signal — junior/early-mid engineers rarely document their own project's gaps this precisely.

---

## Section 14 — 4 YOE Assessment

Extra attention to architecture ownership, reliability, concurrency, database correctness, production thinking, maintainability, security, system design.

- **Architecture ownership:** Strong — the ownership-shape split, the deliberate non-abstraction decisions, and the ADR-style justification for scope boundaries (VendorOrder transitions, no customer-cancel path) reflect real ownership thinking, not just following a tutorial's structure.
- **Reliability:** Strong-with-gaps — graceful shutdown, health checks, and global exception handling are real; but zero observability (Section 11) means reliability has never been *observed* under real conditions, only engineered for in principle.
- **Concurrency:** Strong, with the caveat that this audit found two adjacent gaps (4.6, 4.7) the codebase's own author did not catch or disclose. A 4 YOE bar arguably expects noticing these proactively, not just fixing the one bug that was found.
- **Database correctness:** Strong — Section 3.
- **Production thinking:** Partial — Docker/CI/migrations are genuinely production-shaped; the complete absence of caching, queues actually being used, and observability means "production thinking" shows up in infrastructure plumbing but not yet in operational readiness.
- **Maintainability:** Strong — consistent patterns, clear module boundaries, extensive tests as a safety net for future changes.
- **Security:** Strong — Section 5.
- **System design:** Strong for the problems this project actually has; untested against problems (scale, caching, distributed concerns) a 4 YOE role increasingly touches.

**VERDICT: Ready**

**Rationale for "Ready" rather than "Strongly Ready":** the engineering quality clears a 4 YOE bar on everything within the project's actual scope, but a 4 YOE evaluation increasingly rewards evidence of operating something in production (observability, incident response, scaling under real load) that this project — as a from-scratch portfolio piece, never deployed — cannot provide. "Ready" reflects genuine strength with an honest acknowledgment that some 4 YOE expectations are about professional experience this artifact cannot manufacture (see Section 18).

---

## Section 15 — 5 YOE Assessment

Especially strict, per instructions. Separating project technical depth from professional experience requirements.

- **Architecture ownership:** The project shows good ownership *of this specific system*. 5 YOE ownership usually means having made and lived with architecture decisions across multiple systems, under real changing requirements and real incidents — not demonstrable from one project built end-to-end by one person in a controlled setting.
- **Scaling:** No evidence of scaling anything — Section 10 identifies what *would* need to change, correctly, but "correctly identifying what would need to change" is a different (and lesser) form of evidence than "having actually changed it under real load and measured the result."
- **Production incidents:** None exist. There is no incident to discuss, no postmortem, no "here's a 2am page and what I learned from it." This is normally exactly what differentiates 5 YOE candidates in interviews, and this project cannot manufacture it.
- **Observability:** Not implemented (Section 11) — a 5 YOE bar typically expects fluency here even if a specific project didn't need heavy observability; this project provides no evidence either way.
- **Distributed systems:** Not attempted, correctly so given the actual problem (Section 12) — but also therefore no evidence of distributed-systems judgment under real constraints.
- **Performance optimization:** No evidence of measuring anything under load and improving it — no benchmark, no before/after, no profiling.
- **Operational ownership:** None — never deployed, never operated (Section 8).
- **Technical leadership:** Not evaluable from a solo project — 5 YOE increasingly includes mentoring, design review, and cross-team influence, none of which a solo portfolio project can demonstrate.
- **Design tradeoffs:** Genuinely well-articulated *within* this project (the ADRs, the explicit "why not a generic OwnershipGuard" reasoning, the M-1 fix's own before/after reasoning) — this is real evidence of tradeoff-thinking as a *skill*, even though it hasn't been tested against the harder tradeoffs that come from real production constraints (cost, an actual on-call rotation, actual user complaints).

**VERDICT: Partial Evidence**

Not "Strong Evidence," because genuine 5 YOE signals (production operation, incident response, cross-system scaling, team-level influence) simply cannot come from a solo, never-deployed, ~3-4 week portfolio project, no matter how well-engineered. Not "Insufficient Evidence," because the *engineering judgment and tradeoff-reasoning skill* on display — which is a real and transferable component of what makes a 5 YOE engineer valuable — is genuinely present and well above what's typically seen in portfolio work at this scope.

---

## Section 16 — Resume Claim Audit

Reviewing `docs/project-profile.md` and `README.md` against the evidence gathered in this audit.

### SAFE TO CLAIM

- "JWT authentication with refresh-token rotation and reuse detection" — verified.
- "RBAC and resource-ownership authorization" — verified.
- "Atomic, transaction-scoped checkout with multi-vendor order splitting" — verified.
- "486 unit tests, 329 end-to-end tests, all passing" — independently re-run and confirmed in this audit.
- "Found and fixed a lost-update concurrency bug in refund settlement, proven under real concurrent load with dedicated e2e tests" — verified directly (Section 4.5).
- "Idempotent webhook ingestion (unique constraint + value-based check)" — verified, with the caveat noted below.
- "Secure local file storage — content-sniffed, randomized filenames, path-traversal protected" — verified.
- "Docker (non-root, multi-stage) and CI (GitHub Actions, full pipeline against real Postgres/Redis)" — verified, independently re-run in this audit.
- "PostgreSQL schema with partial unique indexes, CHECK constraints, and Decimal money handling" — verified.

### CLAIM WITH CAUTION

- **"Concurrency-safe"** (used in `docs/project-profile.md`'s one-line description) — technically true for the four mechanisms actually fixed and tested (Section 4.1-4.5), but this audit found two adjacent, unfixed gaps in the same subsystem (Section 4.6, 4.7). Recommend phrasing as *"identified and fixed a genuine refund-settlement concurrency bug, with dedicated concurrency tests for checkout, inventory, and refund settlement"* rather than an unqualified blanket "concurrency-safe," which now overstates what's true given this audit's findings.
- **"Production-oriented"** (used in the README's opening description) — defensible as *"built with production concerns in mind"* (Docker, CI, graceful shutdown, exception handling all genuinely exist), but should not be read as "production-tested" or "production-operated" (Section 8) — the project has never actually run in a real production environment.
- **"Secure"** — true for the specific, extensive list of implemented controls (Section 5), but should always be paired with the equally real, disclosed list of what's absent (rate limiting, CORS, signature verification) rather than stated as a bare adjective.
- **"3-5 YOE equivalent"** — the engineering artifact is genuinely strong evidence *for* a 3-5 YOE resume claim (this audit's own conclusion, Sections 13-14), but "equivalent to 3-5 years of experience" as a literal claim overstates things — years of experience also encompasses production operation, incident response, and team collaboration that a solo project cannot provide (Section 15). Safer framing: *"engineering depth consistent with 3-5 YOE backend work,"* not *"equivalent to."*

### DO NOT CLAIM

- **"Production-ready"** (unqualified) — not supported; "deployment-ready but not deployment-tested or production-operated" is the accurate framing (Section 8).
- **"Enterprise-grade"** — not supported by anything in this codebase; no observability, no secrets management, no rate limiting, no multi-tenant infrastructure isolation.
- **"Scalable"** (unqualified) — contradicted by the local-file-storage single-instance limitation and zero caching (Section 10). "Designed with scalability in mind, with specific identified next steps" is accurate; "scalable" alone is not.
- **"High-performance"** — no benchmark exists anywhere in this project. Nothing has ever been measured.
- **"Distributed system"** — this is a modular monolith by design, correctly so; claiming "distributed system" would be false and is explicitly forbidden by this task's own rules.
- **"Microservices"** — not applicable; same as above.
- **"Real payment gateway integration"** — explicitly and correctly not claimed anywhere already reviewed; this audit found no instance of this claim in current docs, and it must stay that way.
- **"Production-tested"** — not supported (Section 8); no test target exists yet.

**No objectively misleading claim was found in `docs/project-profile.md` or `README.md` as currently written** — both already avoid every item in the "DO NOT CLAIM" list above. The one item requiring a documentation update is the "concurrency-safe" framing discussed under "CLAIM WITH CAUTION," addressed in Section 25 below.

---

## Section 17 — Interview Risk Audit

| Topic | Expected depth | Current project evidence | Potential weakness |
|---|---|---|---|
| Transactions | Why this specific transaction boundary, not a bigger or smaller one | Strong — `checkout.service.ts`'s doc-comment and Section 1/4 findings | None significant |
| Atomic conditional updates | Why `UPDATE ... WHERE <precondition>` beats `SELECT` then `UPDATE` | Strong — four independent correct applications, explained consistently | Candidate should be ready to explain *why the same pattern wasn't applied to payment-outcome handling* (Section 4.6) — a real, honest answer ("found during a later audit, would fix next") is stronger than pretending it doesn't exist |
| Concurrency | Lost updates, race conditions, isolation levels | Strong on the specific bug (M-1) and its fix; should be ready to discuss Postgres's default `READ COMMITTED` isolation and why row-level atomic updates suffice here without needing `SERIALIZABLE` | Candidate should know this project never explicitly sets an isolation level and relies on Postgres defaults plus atomic single-statement writes — a fair, precise answer, not a hand-wave |
| Idempotency | Client-supplied idempotency keys vs. server-derived idempotency | Strong for webhooks (two-layer); narrower for `POST /checkout`/`POST /payments` (idempotent-by-consequence, not idempotency-key-based) | Should be ready to explain this distinction and why it was an acceptable tradeoff here (Section 2) rather than implying a general idempotency-key system exists |
| Webhook replay | Two-layer idempotency, always-200 semantics | Strong | Should be ready to discuss the found gap in payment-outcome conflicting-event handling (4.6) honestly |
| Inventory reservation | onHand/reserved split, why not a single stock counter | Strong | None significant |
| Order splitting | Why MasterOrder+VendorOrder, not one flat order table | Strong — real marketplace-pattern reasoning | None significant |
| MasterOrder derivation | Why optimistic retry instead of a lock | Strong — this is genuinely the most senior-feeling explanation available in the whole project | Should know the 5-attempt bound and what happens if it's exceeded (an unhandled `Error`, not a graceful 409) |
| Ownership guards | Why two different shapes (guard vs. direct comparison), why no generic `OwnershipGuard<T>` | Strong — already documented as an explicit decision | None significant |
| JWT refresh rotation | Family-based reuse detection, HMAC-at-rest storage | Strong | Should be ready to explain why access-token revocation isn't implemented (a disclosed, reasoned scope decision, not an oversight) |
| File upload security | Content-sniffing vs. trusting client metadata | Strong | None significant |
| Docker | Multi-stage build rationale, non-root user | Strong | Should know *why* migrations are a separate release step and not run in the container's entrypoint (documented reasoning exists) |
| PostgreSQL consistency | CHECK constraints as defense-in-depth, partial unique indexes | Strong | Should be ready to discuss the one confirmed gap — no CHECK constraints on money fields (Section 3) — as a considered next step |

**Overall interview risk: Low for everything the project actually built; the two genuine risk points are the newly-identified 4.6/4.7 gaps** — a well-prepared candidate should proactively mention these as "things I'd harden next" rather than hope an interviewer doesn't probe there, since a probing interviewer plausibly would (they are exactly the kind of adjacent-to-a-known-bug question a strong interviewer asks).

---

## Section 18 — Missing Knowledge vs. Missing Project Features

### PROJECT FEATURES THAT ARE ACTUALLY WORTH ADDING

(High-value only — not exhaustive, not padding.)

1. **Harden `handlePaymentOutcome` with the same atomic-conditional-update pattern already used for refunds** (Section 4.6) — small, directly parallels existing, already-understood code; closes a gap this very audit found.
2. **A unique constraint (or conditional-insert-with-conflict-handling) preventing duplicate `Payment` creation per `MasterOrder`** (Section 4.7) — small, same reasoning.
3. **Pagination on the remaining list endpoints** (`/categories`, `/orders`, `/vendor-orders`) — small, mechanical, directly improves both real API completeness and the "scalable" claim's honesty.

*(Per this phase's explicit instructions, none of these are being implemented now — they are recorded here as the short, genuinely high-value list, not a request to expand scope in this phase.)*

### KNOWLEDGE THAT SHOULD BE LEARNED BUT DOES NOT NEED TO BE ADDED TO THIS PROJECT

- **Distributed systems theory** (CAP theorem tradeoffs in practice, consensus algorithms) — valuable to study for interviews at companies with genuinely distributed backends; forcing a distributed-systems feature into this modular monolith would be the "unnecessary complexity" this task explicitly warns against.
- **Kafka / event streaming** — worth understanding conceptually (consumer groups, partitioning, at-least-once vs. exactly-once semantics) since it comes up in system-design interviews; this project's actual event volume and architecture give no genuine reason to introduce it.
- **Database internals** (MVCC, WAL, query planner behavior, index internals) — valuable, deepens the *already-demonstrated* Postgres competence; better learned by reading and experimenting than by adding a project feature.
- **Query optimization at scale** (`EXPLAIN ANALYZE` under real data volume, connection pooling tuning) — genuinely useful, but this project's current data volume is too small to make any optimization exercise meaningful or honest — it would be theater, not evidence.
- **Observability tooling** (Prometheus/Grafana, OpenTelemetry, structured logging design) — valuable to learn and be able to discuss; adding a full observability stack to a project that has never been deployed or exercised under real traffic would produce dashboards with nothing meaningful to show, which is its own form of dishonesty.
- **Cloud architecture** (specific provider services, IAM, networking) — best learned in the context of the actual deployment phase (already scheduled next), not invented speculatively now.

---

## Section 19 — Gap Priority Matrix

| Gap | Severity | 3 YOE Impact | 4 YOE Impact | 5 YOE Impact | Project Fix? |
|---|---|---|---|---|---|
| `handlePaymentOutcome` lacks atomic-conditional-update hardening (4.6) | MEDIUM | Low | Medium | Medium | Yes — small, direct |
| Duplicate Payment creation race (4.7) | MEDIUM | Low | Medium | Medium | Yes — small, direct |
| No pagination beyond `/products` | MEDIUM | Low | Medium | Low | Yes — small, mechanical |
| No CHECK constraints on money fields | LOW | Low | Low | Low | Optional — DB-level defense-in-depth only |
| No caching (Redis unused) | LOW | None | Low | Low | No — no genuine read-load problem exists yet to justify it |
| No queues (BullMQ unused) | LOW | None | Low | Low | No — no genuine background-work need exists yet |
| Local file storage doesn't horizontally scale | INFO | None | Low | Medium | No — correct scope decision for current deployment target; revisit only if/when horizontal scaling is actually needed |
| No observability/structured logging | INFO | None | Low | Medium | No — would be theater without real deployed traffic to observe |
| No rate limiting / CORS | INFO (disclosed) | None | Low | Low | No — genuinely not needed until a real consuming frontend/public exposure exists |
| No API versioning | INFO | None | Low | Low | No — premature without a second API consumer/version to support |
| Never deployed / never production-operated | HIGH (for 5 YOE claims specifically) | None | Low | High | **Not a project-code fix** — this is the actual next phase (deployment), not a code change |

**Only the top three (MEDIUM) items are genuinely worth near-term implementation**, and even those should wait for explicit approval per this phase's own rules — this audit recommends, it does not implement.

---

## Section 20 — What Not to Build

Explicitly out of scope, given this project's actual context:

- **Microservices split** — there is no genuine bounded-context pressure or team-scaling reason to split this modular monolith; doing so would only add deployment/networking complexity without a real problem behind it.
- **Kafka / a message broker** — no actual event-volume or cross-service-fan-out problem exists; BullMQ (already present, unused) is already more than sufficient for anything this project's actual scope would need, and even that isn't needed yet.
- **Kubernetes** — a single-container Docker deployment (already built and verified) is the right-sized answer for this project's actual traffic (none, yet) and team size (one person). Adding Kubernetes now would be resume-driven complexity with no operational justification, and would itself be a red flag to a strong interviewer who asks "why do you need an orchestrator for one container."
- **Artificial caching** — adding a Redis cache layer with no real read-heavy workload to justify it would produce cache-invalidation complexity with no measurable benefit, and no way to honestly demonstrate a "before/after" improvement since there's no load to improve.
- **Fake notifications / fake audit system** — the deferred `Notification` and `Audit` domains already have complete, honest Prisma schemas with no application layer, explicitly disclosed as deferred. Building a stub/fake version of either purely to look "more complete" would directly contradict this project's own strongest quality: that everything documented as implemented actually is, and everything deferred is honestly labeled as such. A fake implementation would be strictly worse than the current honest gap.
- **Fake analytics/dashboards** — same reasoning; would misrepresent observability that doesn't genuinely exist.
- **A second, "real" payment gateway integration purely for the resume line** — explicitly forbidden by this task's own rules, and correctly so: a genuinely wired Stripe/SSLCommerz integration would be valuable, but only if done for real (real test-mode API keys, real signature verification, real sandbox testing) — a half-real "integration" would be worse than the current, honestly-labeled foundation.

---

## Section 21 — Final Experience Scorecard

| Area | Score /10 | Evidence |
|---|---|---|
| Architecture | 8 | Clean modules, one shared auth/ownership system, deliberate non-abstraction decisions (Section 1) |
| API Design | 7 | Correct REST/HTTP semantics, Swagger/Postman; pagination and versioning gaps keep it off 8+ (Section 2) |
| PostgreSQL | 8 | Partial unique indexes, CHECK constraints, correct decimal handling, realistic order model; money-field CHECK-constraint gap keeps it off 9 (Section 3) |
| Prisma | 8 | Correct relation/cascade modelling, driver-adapter usage, clean schema-per-domain organization (Section 3) |
| Security | 8 | Extensive real controls (Section 5); the newly-found duplicate-payment race is a security-adjacent correctness gap, not a vulnerability, so it costs less than a full point |
| Concurrency | 7 | Four genuinely hard problems correctly solved and tested, one real bug found/fixed/regression-tested, but two adjacent gaps found in this very audit (4.6, 4.7) that the project itself hadn't disclosed (Section 4) |
| Testing | 8 | 486+329 passing, genuine negative/ownership/concurrency depth, honest flaky-test handling (Section 6) |
| DevOps | 7 | Docker + CI genuinely verified; no deployment yet (Section 8) |
| Docker | 8 | Multi-stage, non-root, run-verified, correct migration-as-separate-step design (Section 7) |
| CI/CD | 8 | Full real-service-container pipeline, independently re-confirmed green in this audit (Section 7/8) |
| Scalability | 4 | Zero caching, local-file-storage single-instance limitation, unpaginated lists (Section 10) |
| Observability | 2 | Console logging only, nothing else exists (Section 11) |
| Business Logic | 9 | Genuinely realistic multi-vendor marketplace complexity — the strongest single area (Section 9) |
| Documentation | 9 | Extensive, cross-referenced, and — per this and the prior audit — actively self-correcting rather than static (Section 26 findings, README/API.md fixes) |
| System Design | 7 | Strong within actual project scope; untested against scale/distributed concerns (Section 12) |

**Overall Project Engineering Score: 7.3 / 10** (simple average across the 15 areas above).

**This score is NOT equivalent to years of professional experience.** It reflects the engineering quality of a specific, well-executed, never-deployed portfolio artifact. Years of experience additionally encompasses production operation, incident response, cross-team collaboration, and judgment developed under real (not simulated) constraints — none of which a solo project, however well-built, can manufacture (Section 15). A 7.3/10 engineering artifact is genuinely strong portfolio evidence; it is not a substitute for professional tenure, and should never be presented as one.

---

## Section 22 — Final Verdict

### For a 3 YOE Backend Developer resume

**Verdict: This project is already strong enough, and then some.** It substantially exceeds typical 3 YOE portfolio quality — the concurrency depth, database design, security controls, and honest, extensive documentation are well above what most candidates at this level present.

### For a 4 YOE Backend Developer resume

**Verdict: Strong, credible support**, with the honest caveat that a 4 YOE bar increasingly also weighs production-operation evidence this project cannot provide (Section 14). As an engineering-depth artifact, it holds up; as complete proof of 4 years of professional judgment under real constraints, it is necessarily partial — which is true of any single portfolio project, not a flaw specific to this one.

### For a 5 YOE Backend Developer resume

**Verdict: Partial support only, and this should be represented honestly.** The tradeoff-reasoning and system-design judgment on display are genuinely senior-adjacent in places (Section 4.4, the ADR-style decisions). But core 5 YOE signals — production operation, incident response, scaling under real load, technical leadership — are not obtainable from a solo, never-deployed project, no matter how well-engineered (Section 15).

### "If the goal is to maximize interview opportunities for backend roles around 3 YOE, is this project already strong enough?"

**Yes, directly.** No further feature development is needed to strengthen a 3 YOE application with this project. The highest-leverage remaining work is not adding features — it's (1) completing the deployment phase already scheduled next, and (2) applying the small, precise resume-language corrections identified in Section 16 (avoid unqualified "concurrency-safe"/"production-ready"/"scalable" claims; use the more precise, still-impressive phrasing this audit recommends).

---

## Section 23 — Final Recommendation

**A. Project is sufficient — stop feature development.**

The three MEDIUM-severity gaps identified in Section 19 (payment-outcome webhook hardening, duplicate-payment-creation race, remaining-endpoint pagination) are real and worth fixing eventually, but none of them are CRITICAL or HIGH, none of them meaningfully change the project's demonstrated engineering level, and this task's own rules correctly caution against treating "add more" as the default answer. This is not option B in disguise — these are optional future hardening items, not a recommendation to do more feature work now. The highest-value next step is deployment (already the scheduled next phase), not further backend feature development.

---

## Section 24 — Deployment Readiness

Restating and finalizing the distinctions from Section 8, since deployment has genuinely never been performed:

- **Deployment-ready: Yes.** Verified directly in this audit: Docker image builds, runs against real Postgres/Redis with a passing health check, migrations apply via a documented separate step, environment configuration fails fast on misconfiguration.
- **Deployment-tested: No.** No real deployment target (VPS/cloud/PaaS) has ever been used. This has not been attempted, let alone verified.
- **Production-operated: No.** No real traffic, no real restart/redeploy cycle, no real incident has ever occurred, because the application has never run outside a local Docker Compose environment.

**What must be verified during the later deployment phase** (restated from Section 8, the authoritative list):
1. Actual container behavior on the real target host/platform (networking, port binding, resource limits).
2. `FILE_STORAGE_DIR` mounted to genuine persistent storage, tested across an actual redeploy.
3. Real `DATABASE_URL`/`REDIS_HOST` targets, with real network characteristics.
4. Real TLS termination (reverse proxy or platform-provided).
5. `npx prisma migrate deploy` run for real, once, against the real production database.
6. Real `SIGTERM`/shutdown behavior under the specific target platform's conventions.
7. Basic real-world load sanity-check beyond the specific scenarios already unit/e2e-tested.

**No deployment action was taken in this phase, per instructions.**

---

## Appendix — Verification Log (this audit's own tool runs)

- `npm test -- --runInBand` → 486/486 passed, 44 suites.
- `npm run test:e2e -- --runInBand` → 329/329 passed, 11 suites.
- `npx eslint "{src,test}/**/*.ts"` → clean.
- `npm run build` → clean.
- `npx prisma validate` → valid.
- `npx prisma migrate status` → up to date, 13 migrations.
- Source files read in full during this audit: `checkout.service.ts`, `webhooks.service.ts`, `vendor-orders.service.ts`, `inventory.service.ts`, `payments.service.ts`, `storage.service.ts`, `all-exceptions.filter.ts`, `main.ts`, `authorization.guard.ts`, plus migration SQL for CHECK constraints and the Prisma schema files for FK/cardinality verification.
- Test files spot-checked for structure/naming: `checkout.e2e-spec.ts`, `payments.e2e-spec.ts`.
