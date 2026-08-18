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

`@Roles('ADMIN')` / `@Permissions({resource, action})` decorators, enforced by `AuthorizationGuard`, resolved live from the database (`UserRole` → `Role` → `RolePermission` → `Permission`) on every request — no JWT-embedded role claims to go stale. Seeded roles: `ADMIN`, `VENDOR`, `CUSTOMER` (`prisma/seed.ts`). Multiple roles in one `@Roles()` are OR'd; multiple permissions in one `@Permissions()` are AND'd; a route declaring both requires both.

There is **no self-service admin-provisioning endpoint** — assigning `ADMIN` to a user requires direct database access (`prisma.userRole.create(...)`), by design (no documented business rule defines a self-service path).

### Ownership Model

Two distinct shapes, each using the mechanism that actually fits it:

- **Vendor-owned** (`Shop`, `Product`, `VendorOrder`) — `User → Vendor → <resource>`, enforced by a small per-entity guard (`VendorShopOwnershipGuard`, `ProductOwnershipGuard`, `VendorOrderOwnershipGuard`), all sharing `OwnershipService.getVendorIdForUser` and the same `ADMIN` bypass.
- **User-owned** (`Cart`, `MasterOrder`, `Payment`) — a direct `userId` comparison in the service layer, no guard.

A client-supplied `shopId`/`productId`/`vendorOrderId`/`paymentId` in a URL is always treated as *"which resource"*, never as an ownership claim — ownership is re-derived from the authenticated identity on every request.

### Error Conventions

| Situation | Status | Notes |
|---|---|---|
| Missing/invalid/expired access token | 401 | |
| Authenticated, but doesn't own the resource (or it doesn't exist) | 403 | Deliberately generic — "doesn't exist" and "not yours" are indistinguishable, so existence is never leaked |
| Invalid request body | 400 | class-validator DTOs, `whitelist: true, forbidNonWhitelisted: true` — an unrecognized field (e.g. a spoofed `userId`/`price`) is rejected outright, not silently dropped |
| Conflicts with current resource state (duplicate, insufficient balance/stock, wrong state for the action) | 409 | |
| Genuinely missing resource (no ownership question involved, e.g. an ADMIN hitting a nonexistent id) | 404 | |
| Unexpected server/database failure | 500 | Generic message only — no Prisma/SQL detail ever reaches the client |

---

## Main API Domains

| Domain | Base path | Notes |
|---|---|---|
| Health | `/health` | Public |
| Auth | `/auth` | Public: register/login/refresh. Protected: logout/me |
| Vendors | `/vendors` | Protected — self-service vendor onboarding |
| Shops | `/shops` | Mixed — public slug lookup, protected management |
| Categories | `/categories` | Mixed — public read, ADMIN-only write |
| Products | `/products` | Mixed — public slug lookup, protected management |
| Cart | `/cart` | Protected — the caller's own active cart only |
| Checkout | `/checkout` | Protected — cart → order |
| Orders | `/orders` | Protected — the caller's own orders |
| Vendor Orders | `/vendor-orders` | Protected — a vendor's own orders |
| Payments | `/payments` | Protected (refunds are ADMIN-only) |
| Webhooks | `/payments/webhook` | **Unauthenticated** |

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

Response: the created `MasterOrder` (status `PENDING`, `paymentStatus PENDING`) with nested `VendorOrder`s and `OrderItem`s.

---

## Order Flow

- `GET /api/orders` / `GET /api/orders/:masterOrderId` — the customer's own orders (ADMIN can view any).
- `GET /api/vendor-orders` / `GET /api/vendor-orders/:vendorOrderId` — a vendor's own orders (ADMIN can view any).

Fulfillment status transitions and cancellation are **not implemented** — these are read-only views of what checkout created.

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

   **Idempotent two ways**: the database's `UNIQUE(provider, eventId)` constraint (a replayed event is a no-op), *and* a value-based check on the target attempt/refund's own current status (so even the same underlying outcome reported under two different event ids can't double-apply — `refundedAmount` in particular is an accumulation, not an absolute-set field).

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
GET  /api/products/slug/:slug
POST /api/payments/webhook
```

Every other endpoint requires a valid access token; ADMIN-only endpoints (Category create/update, Refund create) additionally require the `ADMIN` role.

---

## Postman Usage

See the [Postman Collection](../README.md#postman-collection) section in the README, or [`postman/`](../postman/) directly. Requests are grouped in the same 12-domain order as this document; run each folder's requests roughly top-to-bottom once — several requests' test scripts populate environment variables (`accessToken`, `vendorId`, `shopId`, `productId`, `cartItemId`, `masterOrderId`, `paymentId`, ...) that later requests in the same or later folders depend on.
