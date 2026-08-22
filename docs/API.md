# API Guide

A narrative walkthrough of the real, implemented API. For the exact request/response shape of every endpoint, use the live Swagger UI (`/api/docs`) or the OpenAPI JSON it serves (`/api/docs-json`) — this document explains *how the pieces fit together*, not every field.

This document only describes what is actually implemented. See each `docs/database/*.md`'s "Implementation Status" section for the authoritative record of what is and isn't built, and the README's [Known Limitations](../README.md#known-limitations).

---

## Base URL

```
http://localhost:3000/api
```

All routes are mounted under the global `/api` prefix (`app.setGlobalPrefix('api')` in `src/main.ts`).

---

## Authentication

JWT bearer authentication (`Authorization: Bearer <accessToken>`), issued via:

```
POST /api/auth/register   { email, password, firstName, lastName?, phone? }
POST /api/auth/login      { email, password } → { ...user, accessToken, refreshToken }
```

Passwords are hashed with Argon2id (`argon2`); `passwordHash` is never returned in any response.

### Access / Refresh Token Flow

- **Access token** — short-lived JWT (`JWT_ACCESS_EXPIRES_IN`), verified per-request by `JwtStrategy`/`JwtAuthGuard`. Every protected route re-derives the current user from the database on each request (role/status changes take effect immediately, not just at next login).
- **Refresh token** — opaque, HMAC-hashed at rest (never stored in plaintext), long-lived (`JWT_REFRESH_EXPIRES_IN`). Presenting it rotates it:

  ```
  POST /api/auth/refresh   { refreshToken } → { accessToken, refreshToken }
  ```

  The presented token is invalidated as part of rotation. **Reuse detection**: presenting an already-rotated (dead) refresh token revokes the *entire token family* (every token descended from the same original login) — a stolen-and-replayed refresh token cannot be used even once without also killing the legitimate session's ability to refresh further.
- **Logout** revokes the current session's token family:

  ```
  POST /api/auth/logout   (bearer)   { refreshToken }
  ```

  The current access token remains valid until it naturally expires — this phase does not implement access-token revocation.

### RBAC

`@Roles('ADMIN')` / `@Permissions({resource, action})` decorators, enforced by `AuthorizationGuard`, resolved live from the database (`UserRole` → `Role` → `RolePermission` → `Permission`) on every request — no JWT-embedded role claims to go stale. Seeded roles: `ADMIN`, `VENDOR`, `CUSTOMER` (`prisma/seed.ts`). **No permission is seeded by default** — `Permission`/`RolePermission` rows must be created directly if you want to exercise a `@Permissions()`-gated route. Multiple roles in one `@Roles()` are OR'd; multiple permissions in one `@Permissions()` are AND'd; a route declaring both requires both.

There is **no self-service admin-provisioning endpoint** — assigning `ADMIN` to a user requires direct database access (`prisma.userRole.create(...)`), by design (no documented business rule defines a self-service path).

### Ownership Model

Two distinct shapes, each using the mechanism that actually fits it:

- **Vendor-owned** (`Shop`, `Product`, `ProductVariant`, `Inventory`, `ProductImage`, `VendorOrder`) — `User → Vendor → <resource>` (extended one hop further for Variant/Inventory/Image, which resolve through their parent `Product`), enforced by a small per-entity guard (`VendorShopOwnershipGuard`, `ProductOwnershipGuard`, `VendorOrderOwnershipGuard`), all sharing `OwnershipService.getVendorIdForUser` and the same `ADMIN` bypass. `ProductOwnershipGuard` is reused **completely unchanged** for every route nested under `/products/:productId/...`, regardless of what follows.
- **User-owned** (`Cart`, `MasterOrder`, `Payment`) — a direct `userId` comparison in the service layer, no guard.

A client-supplied `shopId`/`productId`/`variantId`/`imageId`/`vendorOrderId`/`paymentId` in a URL is always treated as *"which resource"*, never as an ownership claim — ownership is re-derived from the authenticated identity on every request.

### Error Conventions

| Situation | Status | Notes |
|---|---|---|
| Missing/invalid/expired access token | 401 | |
| Authenticated, but doesn't own the resource (or it doesn't exist) | 403 | Deliberately generic — "doesn't exist" and "not yours" are indistinguishable, so existence is never leaked |
| Invalid request body | 400 | class-validator DTOs, `whitelist: true, forbidNonWhitelisted: true` — an unrecognized field (e.g. a spoofed `userId`/`price`) is rejected outright, not silently dropped |
| Conflicts with current resource state (duplicate, insufficient balance/stock, wrong state for the action) | 409 | |
| Genuinely missing resource (no ownership question involved, e.g. an ADMIN hitting a nonexistent id) | 404 | |
| Unexpected server/database failure | 500 | Generic message only — no Prisma/SQL/stack-trace detail ever reaches the client |

**Global exception contract (Phase 23):** every response above is produced by a single `AllExceptionsFilter` (`src/common/filters/all-exceptions.filter.ts`), registered once via `app.useGlobalFilters()`. It passes every already-typed exception through completely unchanged (so the table above reflects exactly what each service decided); its own job is only a safety net — an untranslated Prisma error becomes a generic 409/404/500, and any other unexpected exception becomes a safe `{statusCode: 500, message: "An unexpected error occurred.", error: "Internal Server Error"}` with no stack trace, SQL, or filesystem path ever included.

---

## Main API Domains

| Domain | Base path | Notes |
|---|---|---|
| Health | `/health` | Public |
| Auth | `/auth` | Public: register/login/refresh. Protected: logout/me. Also hosts 5 RBAC demonstration routes (`/auth/rbac-demo/*`) — not business endpoints, see below |
| Vendors | `/vendors` | Protected — self-service onboarding; verification/activation are ADMIN-only |
| Shops | `/shops` | Mixed — public slug lookup, protected management |
| Categories | `/categories` | Mixed — public read, ADMIN-only write |
| Products | `/products` | Mixed — public list + slug lookup, protected management |
| Product Variants | `/products/:productId/variants` | Protected — vendor-management only, no public route |
| Inventory | `/products/:productId/variants/:variantId/inventory` | Protected — vendor-management only |
| Product Images | `/products/:productId/images` | Mixed — upload/delete protected, streaming inherits the parent product's visibility |
| Cart | `/cart` | Protected — the caller's own active cart only |
| Checkout | `/checkout` | Protected — cart → order |
| Orders | `/orders` | Protected — the caller's own orders |
| Vendor Orders | `/vendor-orders` | Protected — a vendor's own orders, including fulfillment status updates |
| Payments | `/payments` | Protected |
| Refunds | `/payments/:paymentId/refunds` | Protected, ADMIN-only |
| Webhooks | `/payments/webhook` | **Unauthenticated** |

---

## Auth APIs

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | none | Creates a `User`; does not log in |
| POST | `/auth/login` | none | Returns the user + `accessToken` + `refreshToken` |
| POST | `/auth/refresh` | none (refresh token in body) | Rotates the refresh token; reuse of a dead token revokes the whole family |
| POST | `/auth/logout` | bearer | Revokes the current session's refresh-token family |
| GET | `/auth/me` | bearer | Returns the caller, re-derived from current DB state |

## RBAC Demo Endpoints

Five endpoints under `/auth/rbac-demo/*` exist **only** to exercise `AuthorizationGuard` end to end against a real route — they are demonstration routes, not business features, and are documented here because they are part of the live, Swagger-visible public API surface (per this phase's explicit instruction to document them if intentionally part of the public API):

| Path | Requirement |
|---|---|
| `GET /auth/rbac-demo/role` | `ADMIN` role |
| `GET /auth/rbac-demo/permission` | `products:read` permission |
| `GET /auth/rbac-demo/role-and-permission` | `ADMIN` role **and** `products:read` permission |
| `GET /auth/rbac-demo/roles-any` | `ADMIN` **or** `VENDOR` role (either suffices) |
| `GET /auth/rbac-demo/permissions-all` | `products:read` **and** `inventory:adjust` permissions (both required) |

## Vendor APIs

```
POST   /api/vendors                         (bearer)  Apply to become a vendor — creates a Vendor profile (status=PENDING, verificationStatus=PENDING)
GET    /api/vendors/me                      (bearer)  The caller's own vendor profile
PATCH  /api/vendors/:vendorId/verification  (ADMIN)   PENDING→UNDER_REVIEW, UNDER_REVIEW→VERIFIED, PENDING/UNDER_REVIEW→REJECTED
PATCH  /api/vendors/:vendorId/activation    (ADMIN)   PENDING→ACTIVE, only when verificationStatus=VERIFIED
```

Verification and activation are two separate ADMIN-only endpoints (an approved architecture decision, not open for reconsideration) — neither uses ownership: a vendor can never verify or activate itself or another vendor. Both are terminal once `VERIFIED`/`REJECTED`/`ACTIVE` — no re-verification or re-application path exists.

## Shop APIs

```
POST   /api/shops                (bearer)  Create the caller's own shop (vendorId always server-resolved; at most one shop per vendor)
GET    /api/shops/slug/:slug     (public)  Storefront lookup — only an ACTIVE shop, else 404
GET    /api/shops/:shopId        (owner/ADMIN)
PATCH  /api/shops/:shopId        (owner/ADMIN)  status may only be set to ACTIVE/INACTIVE — SUSPENDED is administrator-controlled
```

## Category APIs

```
GET    /api/categories               (public)  Every non-deleted category, flat list with parentId
GET    /api/categories/:categoryId   (public)
POST   /api/categories               (ADMIN)
PATCH  /api/categories/:categoryId   (ADMIN)
```

`Category` is a shared, platform-wide taxonomy with no owner — read is always public, write is always ADMIN-only.

## Product APIs

```
POST   /api/products                (bearer)  Create a product for the caller's own vendor profile
GET    /api/products                (public, paginated)  ACTIVE, non-deleted products only — {data, meta} envelope, no category/vendor/search filter
GET    /api/products/slug/:slug     (public)  ACTIVE only, else 404
GET    /api/products/:productId     (owner/ADMIN)
PATCH  /api/products/:productId     (owner/ADMIN)
```

## Product Variant APIs

Nested under `/products/:productId/variants` — every route requires owning the parent product, or ADMIN (`ProductOwnershipGuard`, reused unchanged). No public variant-browsing route exists.

```
POST   /products/:productId/variants                       Create a variant — the product's first variant is automatically its default (isDefault is never client-settable)
GET    /products/:productId/variants                       List every variant (any status — this is the management view)
GET    /products/:productId/variants/:variantId
PATCH  /products/:productId/variants/:variantId             isDefault cannot be changed through this endpoint
```

`price`/`compareAtPrice`/`costPrice` are decimal strings set by the owning vendor (a legitimate case, not price-spoofing, since the vendor owns the resource being priced); `costPrice` is never exposed in any customer-facing response.

## Inventory APIs

Nested under `/products/:productId/variants/:variantId/inventory` — same ownership rule as Product Variants.

```
GET    .../inventory              available (onHand - reserved) is always computed, never stored
POST   .../inventory/restock      Increments onHand; records a RESTOCK InventoryTransaction, both atomically
POST   .../inventory/adjust       Signed delta to onHand (vendor-self-service + ADMIN bypass, ADR-4); records an ADJUSTMENT InventoryTransaction; rejected (409) if the result would make onHand negative or fall below reserved
```

Both restock and adjust use an atomic conditional `UPDATE` (never a check-then-write) — proven safe under genuine concurrent load (two simultaneous adjustments that would together violate `onHand >= 0` — exactly one succeeds, the other gets a 409).

## Product Image APIs

Nested under `/products/:productId/images`. Local filesystem storage only (never S3/Spaces/MinIO/any object storage).

```
POST   /products/:productId/images            (owner/ADMIN, multipart/form-data)
GET    /products/:productId/images/:imageId    (mixed auth — see below)
DELETE /products/:productId/images/:imageId    (owner/ADMIN)
```

- **Upload**: `file` (JPEG/PNG/WebP, ≤5MB, validated by content-based magic-byte sniffing — never the client's declared `Content-Type` or filename) + optional `variantId`/`altText`/`isPrimary`. Stored under a server-generated random filename; the client's original filename is never used as a stored path (structurally eliminates path traversal). Returns the created image record; `url` is the path to the streaming endpoint below.
- **Stream**: visibility is **inherited from the parent product's own `status`** — an `ACTIVE` product's images are publicly streamable with no token required; any other status requires the caller to own the product or be ADMIN, exactly the same check as viewing the product itself. Not a separate visibility flag on the image.
- **Delete**: removes the DB record, then best-effort deletes the on-disk file (a leftover file on delete failure is logged server-side, not surfaced to the client).

No image listing endpoint, reordering, or single-primary-image enforcement exists — a vendor learns an image's id from its own upload response.

---

## Cart Flow

1. `GET /api/cart` — always 200, even with no active cart yet (a synthesized empty view, not a 404).
2. `POST /api/cart/items { variantId, quantity? }` — creates the caller's active cart on first use (its currency comes from the first item's variant currency), or upserts into the existing one. Adding an already-present variant **increments** its quantity rather than creating a duplicate row.
3. `PATCH /api/cart/items/:itemId { quantity }` / `DELETE /api/cart/items/:itemId` — must belong to the caller's own active cart.
4. `DELETE /api/cart/items` — clears the active cart (idempotent no-op if none exists).

Product/variant/vendor status is validated at add-time (must all be `ACTIVE`) — but this is **not** a guarantee that still holds by checkout time; checkout re-validates everything fresh.

---

## Checkout Flow

```
POST /api/checkout
{
  "shippingAddress": { "fullName", "phone", "addressLine1", "addressLine2?", "city", "state?", "postalCode", "country" },
  "billingAddress"?: { ...same shape, defaults to shippingAddress if omitted },
  "customerNote"?: "string"
}
```

One request, one Prisma transaction:

1. Re-validates every cart line's product/variant/vendor status, currency, and available inventory (`onHand - reserved`) — fresh from the database, not the cart's own prior snapshot.
2. Atomically reserves inventory per line (`reserved += qty`, never touching `onHand`) via a single conditional `UPDATE`, not a check-then-update.
3. Atomically flips the cart `ACTIVE → CONVERTED` — this is also what prevents a retried/duplicate checkout request from creating a second order.
4. Creates one `MasterOrder`, one `VendorOrder` per distinct vendor represented in the cart, and one `OrderItem` per line, plus initial status-history rows.

Response: the created `MasterOrder` (status `PENDING`, `paymentStatus PENDING`) with nested `VendorOrder`s and `OrderItem`s. Proven safe under genuine concurrent checkout of the same cart/inventory (exactly one request succeeds).

---

## Order Flow

- `GET /api/orders` / `GET /api/orders/:masterOrderId` — the customer's own orders (ADMIN can view any).

Customer-facing cancellation/returns are **not implemented** — these are read-only views of what checkout created.

## Vendor Order Flow

- `GET /api/vendor-orders` / `GET /api/vendor-orders/:vendorOrderId` — a vendor's own orders (ADMIN can view any).
- `PATCH /api/vendor-orders/:vendorOrderId/status { status }` — vendor-initiated fulfillment lifecycle (ADR-2/ADR-3):

  ```
  PENDING → CONFIRMED → PROCESSING → READY_TO_SHIP → SHIPPED → DELIVERED
  PENDING / CONFIRMED → CANCELLED
  ```

  Only these transitions are accepted (409 otherwise, including a concurrent/stale request that already changed the status — an atomic conditional update, not check-then-write). `DELIVERED`/`CANCELLED` are terminal. `MasterOrder.status` is always re-derived from all of its `VendorOrder`s, never client-settable. Post-`PROCESSING` cancellation and returns are **not implemented** by explicit decision (ADR-2), not oversight.

---

## Payment / Refund / Webhook Flow

**No real payment gateway is integrated.** This is a documented, intentional foundation covering the Payment/PaymentAttempt/Refund lifecycle and webhook idempotency — not a working checkout-to-cash pipeline.

1. `POST /api/payments { masterOrderId, method }` — one Payment per order (409 if one already exists), amount/currency always from the order. Creates the Payment (`PENDING`) and its first `PaymentAttempt` (`INITIATED`, with an internally-generated `providerReference` standing in for what a real gateway would return).
2. `POST /api/payments/:id/retry` — only from a `FAILED` payment; creates attempt N+1, preserves every prior attempt, resets the payment to `PENDING`.
3. `GET /api/payments/:id` — the payment plus its full attempt/refund history (owner or ADMIN).
4. `POST /api/payments/webhook` (**no auth** — a real gateway is not a logged-in user) — generic event ingestion:

   ```json
   { "provider": "MANUAL", "eventId": "evt-123", "eventType": "payment.succeeded", "providerReference": "ref_..." }
   ```

   Recognized `eventType` values (this foundation's own vocabulary, not any real gateway's): `payment.succeeded`, `payment.failed`, `refund.succeeded`, `refund.failed`. Anything else is recorded and ignored, not rejected.

   **Idempotent two ways**: the database's `UNIQUE(provider, eventId)` constraint (a replayed event is a no-op), *and* a value-based check on the target attempt/refund's own current status (so even the same underlying outcome reported under two different event ids can't double-apply). `Payment.refundedAmount` accumulates via an **atomic conditional `UPDATE`** (`refunded_amount = refunded_amount + $amount`, computed by Postgres from the row's current value at write time) — proven safe when two *different* refunds against the same payment settle genuinely concurrently — see `docs/remaining-architecture-plan.md`'s "Phase 25 — M-1 Fix" section for the full history of this fix, and `src/payments/webhooks.service.ts`'s `handleRefundOutcome` for the implementation.

   A successful `payment.succeeded`/`payment.failed`/`refund.succeeded`/`refund.failed` event updates the attempt/payment/refund **and** syncs `MasterOrder.paymentStatus` — but never `MasterOrder.status` (fulfillment lifecycle is a separate, untouched concern).

5. `POST /api/payments/:id/refunds { amount, reason }` — **ADMIN-only**. `amount` is validated against `paidAmount - refundedAmount`; a request exceeding the refundable balance is rejected (409). Currency always comes from the Payment.

**Explicitly not implemented, and why:** real gateway calls (no provider is chosen — implementing one would mean inventing which provider is being simulated), webhook signature verification (the exact mechanism is provider-specific and no provider is chosen), a customer-facing refund-request workflow (no such workflow is documented anywhere in the source docs — only administrative actor/audit language is).

---

## Public vs Protected Endpoints

**Public (no token required):**

```
GET  /api/health
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
GET  /api/shops/slug/:slug
GET  /api/categories
GET  /api/categories/:categoryId
GET  /api/products
GET  /api/products/slug/:slug
POST /api/payments/webhook
```

**Mixed (public only for a public parent resource):**

```
GET  /api/products/:productId/images/:imageId   — public if the parent product is ACTIVE, otherwise owner/ADMIN
```

Every other endpoint requires a valid access token; ADMIN-only endpoints (Category create/update, Vendor verification/activation, Refund create) additionally require the `ADMIN` role.

---

## Postman Usage

See the [Postman Collection](../README.md#postman-collection) section in the README, or [`postman/`](../postman/) directly. Requests are grouped in the same 17-domain order as this document; run each folder's requests roughly top-to-bottom once — several requests' test scripts populate environment variables (`accessToken`, `vendorId`, `shopId`, `productId`, `variantId`, `imageId`, `cartItemId`, `masterOrderId`, `paymentId`, `refundId`, ...) that later requests in the same or later folders depend on. ADMIN-gated requests (Vendor verification/activation, Category create/update, Refund creation) and permission-gated RBAC demo requests need `adminAccessToken` (and, for permission-based RBAC demos, manually-seeded `Permission`/`RolePermission` rows) set up first — see the collection's own top-level description.
