# Backend Architecture

## 1. Purpose

This document defines the architectural decisions, module boundaries, API conventions, authentication model, authorization strategy, infrastructure responsibilities, and development principles for the Multi-Vendor E-Commerce API.

The purpose of this document is to keep the backend architecture consistent as the system grows.

Any new feature or module should follow the rules defined here unless an architectural decision is explicitly changed and documented.

---

# 2. Technology Stack

The backend is built with the following technologies:

- Node.js 22 LTS
- NestJS
- TypeScript
- PostgreSQL
- Prisma ORM
- Redis
- BullMQ
- Docker Compose
- Jest
- Supertest
- Swagger / OpenAPI

### Infrastructure

Development infrastructure currently includes:

- PostgreSQL 17
- Redis 7
- Docker Compose

---

# 3. High-Level Architecture

The application follows a modular NestJS architecture.

At a high level:

```text
                    ┌─────────────────────┐
                    │      HTTP Client    │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │    NestJS API       │
                    │     /api/*          │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
        Controllers       Guards / Pipes    Swagger
              │
              ▼
        Application /
        Domain Services
              │
       ┌──────┼────────┐
       │      │        │
       ▼      ▼        ▼
    Prisma   Redis    BullMQ
       │      │        │
       ▼      ▼        ▼
 PostgreSQL Redis    Redis
````

The application separates business modules from infrastructure modules.

---

# 4. Architectural Layers

The application follows a practical layered structure.

```text
HTTP Request
     │
     ▼
Controller
     │
     ▼
Service
     │
     ├── Domain / Business Logic
     │
     ├── Prisma
     │
     ├── Redis
     │
     └── Queue
     │
     ▼
Infrastructure
```

## Controller

Controllers are responsible for:

* Receiving HTTP requests
* Request parameter extraction
* Request DTO handling
* Calling application services
* Returning HTTP responses

Controllers should remain thin.

Business logic should not be implemented directly inside controllers.

---

## Service

Services contain:

* Business rules
* Application logic
* Authorization-related business checks
* Transaction orchestration
* Coordination between infrastructure services

Services should not depend on HTTP-specific behavior unless required by the framework boundary.

---

## Infrastructure

Infrastructure modules provide shared technical capabilities.

Current infrastructure modules include:

```text
config/
prisma/
redis/
health/
```

BullMQ infrastructure is configured globally and feature-specific queues will be registered by the modules that own them.

---

# 5. Project Structure

The expected application structure is:

```text
src/
├── config/
│   └── env.validation.ts
│
├── health/
│   ├── health.controller.ts
│   ├── health.module.ts
│   ├── health.service.ts
│   └── health.service.spec.ts
│
├── prisma/
│   ├── prisma.module.ts
│   └── prisma.service.ts
│
├── redis/
│   ├── redis.module.ts
│   └── redis.service.ts
│
├── auth/
├── users/
├── roles/
│
├── vendors/
├── shops/
│
├── catalog/
├── cart/
├── orders/
├── payments/
├── refunds/
├── promotions/
├── reviews/
├── notifications/
├── wallet/
├── commissions/
└── audit/
```

The business modules will be implemented incrementally.

The existence of a domain in this architecture does not mean that its implementation must be created immediately.

---

# 6. Domain Scope

The backend consists of the following core business domains.

## Identity & Access

Responsible for:

* Users
* Roles
* Permissions
* User-role relationships
* Role-permission relationships
* Authentication
* Authorization

---

## Vendor & Shop

Responsible for:

* Vendors
* Shops
* Vendor ownership
* Shop-related business rules

---

## Catalog

Responsible for:

* Categories
* Products
* Product variants
* Product images
* Product availability
* Catalog-related business rules

---

## Cart

Responsible for:

* Customer carts
* Cart items
* Cart validation
* Cart lifecycle

---

## Orders

Responsible for:

* Master orders
* Vendor orders
* Order items
* Order status
* Order status history
* Order lifecycle

---

## Payments & Refunds

Responsible for:

* Payments
* Payment attempts
* Payment webhook events
* Refunds
* Payment state transitions
* Refund business rules

---

## Promotions

Responsible for:

* Promotions
* Coupons
* Coupon redemption
* Product promotions
* Category promotions
* Vendor promotions

---

## Reviews

Responsible for:

* Product reviews
* Review validation
* Review lifecycle

---

## Notifications

Responsible for:

* User notifications
* Notification state
* Notification delivery workflows

---

## Wallet & Commission

Responsible for:

* Vendor wallets
* Wallet transactions
* Commission records
* Vendor earnings
* Financial ledger-related operations

---

## Audit

Responsible for:

* Audit logs
* Important business actions
* Actor tracking
* Security-sensitive activity tracking

---

# 7. Module Boundaries

Each business domain should have its own NestJS module.

For example:

```text
CatalogModule
    │
    ├── CatalogController
    ├── CatalogService
    └── catalog-specific providers
```

Similarly:

```text
OrderModule
    │
    ├── OrderController
    ├── OrderService
    └── order-specific providers
```

Modules should expose only the services or providers that other modules actually need.

---

# 8. Module Dependency Rules

## Rule 1 — No uncontrolled cross-module access

A module must not directly manipulate another module's internal implementation.

Avoid:

```text
OrderService
    ↓
Direct access to Vendor module internals
```

Prefer:

```text
OrderService
    ↓
VendorService public API
```

---

## Rule 2 — Modules expose explicit contracts

If another module requires functionality, the owning module should expose a service or provider through its public module interface.

Example:

```text
OrderModule
    ↓
VendorModule
    ↓
VendorService
```

The Order module should not depend on private implementation details of the Vendor module.

---

## Rule 3 — Business modules do not create infrastructure connections

Business modules must not create their own:

* PostgreSQL connections
* Prisma clients
* Redis clients
* BullMQ connections

Infrastructure is centralized.

---

# 9. Prisma Architecture

Prisma is the ORM used for PostgreSQL access.

The application uses a centralized:

```text
PrismaService
```

provided by:

```text
PrismaModule
```

Business modules should use the shared PrismaService rather than creating independent Prisma clients.

```text
Business Module
      │
      ▼
PrismaService
      │
      ▼
PostgreSQL
```

Database schema definitions are maintained under:

```text
prisma/schema/
```

Database domain documentation is maintained under:

```text
docs/database/
```

---

# 10. Redis Architecture

Redis is a shared infrastructure service.

The application provides:

```text
RedisModule
RedisService
```

Business modules should use the shared RedisService.

```text
Business Module
      │
      ▼
RedisService
      │
      ▼
Redis
```

Redis may be used for:

* Caching
* Temporary state
* Distributed coordination
* Rate limiting
* Session-related infrastructure
* BullMQ backend infrastructure

Specific usage should be introduced only when required by a feature.

---

# 11. BullMQ Architecture

BullMQ is used for asynchronous and background processing.

BullMQ infrastructure is configured globally.

Feature modules should register the queues they own.

Conceptually:

```text
Business Module
      │
      ▼
Queue
      │
      ▼
BullMQ
      │
      ▼
Redis
      │
      ▼
Worker / Processor
```

Examples of future asynchronous workloads may include:

* Email delivery
* Notification processing
* Payment webhook processing
* Order-related background work
* Cleanup jobs
* Scheduled business tasks

Temporary integration/test queue code should not remain in the production architecture.

---

# 12. Configuration

Environment configuration is centralized through:

```text
ConfigModule
```

Environment validation is handled by:

```text
src/config/env.validation.ts
```

Required configuration should be validated during application startup.

The application should fail fast when required environment variables are missing or invalid.

Secrets must never be committed to the repository.

Only example values belong in:

```text
.env.example
```

Actual development and production secrets belong in environment-specific secret management.

---

# 13. API Prefix

All application APIs use:

```text
/api
```

Example:

```text
GET /api/health
```

The API prefix is configured globally in:

```text
src/main.ts
```

API versioning is not currently introduced as `/api/v1`.

If versioning becomes necessary later, it must be introduced as an explicit architectural decision.

---

# 14. API Resource Naming

API resources should use plural nouns.

Examples:

```text
/api/users
/api/vendors
/api/shops
/api/products
/api/categories
/api/orders
/api/payments
/api/refunds
/api/promotions
/api/reviews
/api/notifications
/api/wallet
```

Avoid action-oriented resource names where a standard REST resource representation is sufficient.

Prefer:

```text
POST /api/orders
```

over:

```text
POST /api/create-order
```

Business-specific actions may use explicit action endpoints when a standard REST representation is not appropriate.

---

# 15. Request Validation

Global validation is enabled through NestJS ValidationPipe.

The application uses:

```text
whitelist: true
forbidNonWhitelisted: true
transform: true
```

DTOs should be used for validating incoming request data.

Controllers should not manually implement repetitive request validation logic.

---

# 16. Response Convention

Simple resource responses may return the resource directly.

Example:

```json
{
  "id": "uuid",
  "name": "Product"
}
```

Collection endpoints should use a consistent pagination structure.

Example:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

The exact pagination implementation may evolve, but the response contract should remain consistent across modules.

**Implemented (Phase 20):** `GET /api/products` is the first endpoint to
use this exact envelope (`src/catalog/products/products.service.ts`).
Other existing collection endpoints (`GET /api/categories`, `GET
/api/orders`, `GET /api/vendor-orders`) predate this convention and still
return a plain array — they were deliberately **not** retrofitted in
Phase 20 to avoid a breaking response-shape change to already-shipped,
tested behavior; adopting the envelope for them is a candidate for a
future, explicitly-scoped phase, not an oversight.

---

# 17. Error Handling

The application should use NestJS HTTP exceptions for standard API errors.

Common exceptions include:

```text
BadRequestException
UnauthorizedException
ForbiddenException
NotFoundException
ConflictException
UnprocessableEntityException
```

Examples:

```text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
```

Business services should throw meaningful domain-level exceptions instead of returning ambiguous error values.

---

# 18. Authentication Architecture

Authentication uses:

```text
Access Token
+
Refresh Token
```

The access token is short-lived.

The refresh token is longer-lived and uses rotation.

Rotation policy (implemented): each `POST /auth/refresh` call consumes the
presented refresh token and issues a new access token and a new refresh
token in its place, atomically. Every refresh token descended from one
login shares a token-family identifier. Presenting a refresh token that
has already been consumed (rotated away from, or previously revoked) is
treated as refresh-token reuse: the entire family is revoked immediately,
so every token in that chain — not just the reused one — stops working.
The public response for any refresh failure (unknown token, expired
token, reused token, or an account that can no longer authenticate) is a
single generic 401 with no distinguishing detail. Sessions (families) are
independent — revoking one never affects another, including other
sessions for the same user.

Logout policy (implemented): `POST /auth/logout` requires a valid access
token (it is not a public endpoint) and revokes the login session — the
entire refresh-token family — identified by the refresh token supplied in
the request body, reusing the same family-revocation mechanism as reuse
detection above. It only ever revokes a family owned by the authenticated
caller; an unknown, already-revoked, or another user's refresh token is a
silent no-op. Logout is therefore idempotent and always returns `204` for
an authenticated caller, regardless of the refresh token's validity. The
access token itself is not revoked or blacklisted — it remains valid,
stateless, until it naturally expires (`JWT_ACCESS_EXPIRES_IN`); logout
only guarantees the session cannot be *continued* past that point via
`/auth/refresh`.

The authentication system is centralized around the User entity.

There is no separate authentication system for vendors.

---

# 19. User and Role Model

The identity model is:

```text
User
  │
  ▼
UserRole
  │
  ▼
Role
  │
  ▼
RolePermission
  │
  ▼
Permission
```

A user may have one or more roles.

Core roles include:

```text
Customer
Vendor
Admin
```

Additional roles may be introduced later if required by the business.

---

# 20. JWT Strategy

The access token should contain only the information required for authentication and authorization.

Conceptual payload:

```json
{
  "sub": "user-id",
  "jti": "token-id",
  "roles": ["vendor"]
}
```

Sensitive information must not be placed inside JWT payloads.

The `sub` claim identifies the authenticated user.

The `jti` claim may be used for token tracking and revocation-related workflows.

---

# 21. Authentication Flow

The request lifecycle is conceptually:

```text
HTTP Request
     │
     ▼
JWT Guard
     │
     ▼
Authenticated User
     │
     ▼
Role / Permission Guard
     │
     ▼
Controller
     │
     ▼
Service
```

Authentication answers:

> Who is this user?

Authorization answers:

> What is this user allowed to do?

These responsibilities must remain separate.

---

# 22. Authorization

Authorization uses RBAC:

```text
Role-Based Access Control
```

The permission hierarchy is:

```text
User
  ↓
Role
  ↓
Permission
```

Example:

```text
Role: vendor

Permissions:
- product:create
- product:update
- product:delete
- order:read
- order:update
```

The exact permission list will be defined during the Identity & Access implementation phase.

## Authentication vs. Authorization (implemented)

Strictly separated, per §21: `JwtAuthGuard` answers "who is this user?" and
never checks roles/permissions. `AuthorizationGuard` answers "is this
authenticated user allowed to do this?" and never verifies a token — it
trusts `req.user` exactly as `JwtAuthGuard` (which always runs first in
the guard chain) already established it. Neither guard duplicates the
other's responsibility.

## Role / Permission Resolution (implemented)

A dedicated `AuthorizationService` (`src/auth/authorization/`) is the only
place RBAC queries are written — guards, decorators, and controllers never
query Prisma for roles/permissions directly. It walks the existing
`User → UserRole → Role → RolePermission → Permission` tables on every
call: `getUserRoles`, `getUserPermissions`, `hasRole`,
`hasPermission(resource, action)`. Permissions use the exact
`{ resource, action }` shape the `Permission` model already defines — no
second/colon-string syntax was introduced.

## Declaring requirements: `@Roles()` / `@Permissions()`

Route-level metadata only (`SetMetadata`); `AuthorizationGuard` reads it
via `Reflector` and enforces it. A route with neither decorator requires
authentication only.

## Combination semantics (implemented; not previously specified by this document)

- Multiple roles in one `@Roles(a, b)` → **OR** — any one of them is
  sufficient (matches the conventional RBAC interpretation: roles are
  alternative sufficient identities for an action).
- Multiple permissions in one `@Permissions(a, b)` → **AND** — all of
  them are required (permissions are treated as individually necessary
  capabilities for a composite action).
- `@Roles()` and `@Permissions()` both present on the same route →
  **AND** — both checks must independently pass. Decorators are additive
  constraints, not alternative paths.

## 401 vs. 403

No/invalid/expired access token → `401 Unauthorized` (from
`JwtAuthGuard`). Valid, authenticated identity but an unmet role/permission
requirement → `403 Forbidden` (from `AuthorizationGuard`), with a single
generic message — never a role ID, permission ID, or any database detail.

## Live database state, not JWT claims

Roles and permissions are **not** embedded in the access token (the
payload stays `{ sub: user.id }`, unchanged since Phase 3). Every
authorization check re-reads current database state, so granting,
changing, or revoking a role/permission takes effect on the very next
request — no re-login or new token required.

---

# 23. Resource Ownership

RBAC alone is not sufficient for vendor authorization.

Authorization must consider both:

```text
Role / Permission
+
Resource Ownership
```

Example:

```text
Vendor A
    │
    ▼
Product owned by Vendor B
```

Even if Vendor A has:

```text
product:update
```

Vendor A must not be allowed to update Vendor B's product.

The request must fail with an appropriate authorization error.

## RBAC vs. Ownership (implemented, Phase 9)

Two separate guards, separate concerns, composed per-route rather than
merged:

- `AuthorizationGuard` (Phase 8) answers "is this identity allowed to
  perform this **class** of action at all?" — role/permission metadata
  only, no awareness of any specific resource.
- Ownership guards (e.g. `VendorShopOwnershipGuard`, Phase 9) answer
  "does **this specific** resource belong to this identity?" — resolved
  from a `:id` route parameter, with no awareness of roles/permissions
  except for the documented ADMIN bypass (below).

A route may declare either, both (`@UseGuards(JwtAuthGuard,
AuthorizationGuard, VendorShopOwnershipGuard)`), or neither. Both fail
closed and both return `403 Forbidden` with the same generic,
non-disclosing message shape on denial — a client cannot tell from the
response alone which check failed, or (for ownership) whether the
resource exists, belongs to someone else, or the caller has no
owning relationship at all.

## Trusted Identity Source (implemented)

The owner identity used in every ownership comparison is always resolved
server-side from the authenticated user (`req.user.id`, established by
`JwtAuthGuard`/`JwtStrategy`) — **never** from a client-supplied
`vendorId`/`userId` in the request body, query string, or any field other
than the JWT-derived identity itself. A resource id (e.g. `:shopId`) is
expected as a route parameter — that identifies *what* is being
requested, not *who* is making the request.

## Admin Bypass (implemented, Phase 9)

`docs/database/vendor-shop.md` §20 explicitly names `ADMIN` as an
elevated role that may access vendor-owned resources without an
ownership match ("unless an elevated role such as ADMIN explicitly has
access"). This is the only role granted this bypass; no other role
bypasses ownership. The check reuses `AuthorizationService.hasRole`
(Phase 8) rather than a second role-resolution implementation.

## Ownership Scope (implemented, Phase 9; extended, Phases 10–11, 14)

Concretely implemented so far: `User → Vendor → Shop`
(`docs/database/vendor-shop.md` §19–20, Phase 9/10),
`User → Vendor → Product` (`docs/database/catalog.md` §8, Phase 11), and
`User → Vendor → VendorOrder` (`docs/database/order.md` §11, Phase 14).
`VendorShopOwnershipGuard` protects `GET`/`PATCH /api/shops/:shopId`
(`src/shops/`). `ProductOwnershipGuard` protects
`GET`/`PATCH /api/products/:productId` (`src/catalog/products/`).
`VendorOrderOwnershipGuard` protects `GET`/`PATCH /api/vendor-orders/:vendorOrderId`
(`src/orders/`) — the `PATCH .../status` fulfillment-transition route
added in Phase 19 reuses the same guard unchanged, not a second
ownership mechanism.

**Architectural decision (Phase 11, revisited Phase 14):** Product's
ownership shape is identical to Shop's (`User → Vendor → <resource>`, a
direct `vendorId` column, same ADMIN bypass), but `VendorShopOwnershipGuard`
was **not** generalized into a parameterized/generic ownership guard for
this — `ProductOwnershipGuard` mirrors the same structure with its own
`:productId` param instead, and that doc-comment explicitly named "a
third entity needing this exact shape" as the point where extraction
would become justified by real reuse. `VendorOrder` (Phase 14) is that
third entity, and `VendorOrderOwnershipGuard` is a third mirrored guard
— **the extraction was still not done**: this task's rules forbid
rewriting already-tested Phase 9/11 functionality, and retrofitting a
shared base onto two stable, working guards is exactly that kind of
rewrite, not new "order viewing" work. This is flagged as a legitimate
candidate for a dedicated future refactor rather than silently deferred
again. What *is* shared across all three guards, not duplicated:
`OwnershipService.getVendorIdForUser` and the ADMIN-bypass call to
`AuthorizationService.hasRole` — only the entity-specific ownership
query (`isShopOwnedByVendor` / `isProductOwnedByVendor` /
`isVendorOrderOwnedByVendor`, all on `OwnershipService`) and each
guard's thin route-param wiring differ.

Product creation resolves the caller's vendor id via `OwnershipService`
(no existing product to check ownership of yet), same pattern as Shop
creation. `GET /api/products/slug/:slug` is public/unauthenticated, same
pattern as `GET /api/shops/slug/:slug`. `GET /api/vendor-orders` (the
list endpoint, Phase 14) resolves the caller's vendor id the same way —
there is no existing single resource to check ownership of for a list,
so `VendorOrderOwnershipGuard` only protects the single-resource route.

`MasterOrder` (Phase 14) is user-owned, not vendor-owned — a direct
`User → MasterOrder` relationship, the same shape as `Cart` (Phase 12).
`OrdersService` therefore does **not** use `OwnershipService` or a
guard for it; it scopes queries directly to the authenticated `userId`,
with the ADMIN bypass applied by hand via `AuthorizationService.hasRole`
(`docs/database/order.md` §48: "Admins may have broader access").

Other vendor-owned entities the schema already models (`Wallet`,
`Commission`, `PromotionVendor`, all carrying a `vendorId`) are
architecturally covered by the same rule and the same intended pattern
but have no controllers yet — ownership checks for them will be added
alongside those controllers, not speculatively ahead of them.

`ProductVariant`/`Inventory` are a specific case of this: the ownership
chain `User → Vendor → Product → ProductVariant → Inventory` has been
explicitly approved (Architecture Decision Register, ADR-4, in
`docs/remaining-architecture-plan.md`) as an extension of the same
`OwnershipService` pattern one hop further through `ProductVariant`, with
inventory adjustment being vendor-self-service rather than ADMIN-only.
Neither `ProductVariant` nor `Inventory` has a controller yet — this
paragraph records the *approved design*, not current behavior.

`Category` (Phase 11, `docs/database/catalog.md` §2) is explicitly
**not** vendor-owned — it has no `vendorId`/`userId` column at all, and
is a shared, platform-wide taxonomy. Its mutating endpoints
(`POST`/`PATCH /api/categories`) are gated by RBAC (`@Roles('ADMIN')`)
rather than by `OwnershipService` — there is no owner to check ownership
against. This is an inference, not an explicit doc statement; see this
phase's final report.

---

# 24. Vendor Isolation

Vendor-owned resources must always enforce ownership boundaries.

Examples include:

* Products
* Product variants
* Orders
* Shop data
* Wallet information
* Earnings
* Vendor-specific promotions

A vendor must only access resources that belong to that vendor unless an explicit authorization rule allows broader access.

Admin-level access may bypass normal vendor ownership restrictions where permitted by the authorization model.

Implemented for `Shop` in Phase 9/10 (`VendorShopOwnershipGuard` +
`OwnershipService`, `src/shops/`) and for `Product` in Phase 11
(`ProductOwnershipGuard` + `OwnershipService`, `src/catalog/products/`)
— see §23's "RBAC vs. Ownership" / "Admin Bypass" / "Ownership Scope"
subsections for the concrete rule and current coverage.

## Cart Ownership — User-owned, not Vendor-owned (Phase 12)

`Cart` (`docs/database/cart.md` §20, `src/cart/`) has a different
ownership shape than `Shop`/`Product`: `User → Cart → CartItem` is a
direct `userId` match with no Vendor indirection at all. It deliberately
does **not** use `OwnershipService` or a dedicated ownership guard —
every `CartService` method scopes its own Prisma query straight to the
authenticated `userId` (e.g. `cart: { userId, status: 'ACTIVE' }`), and
an unowned/nonexistent `itemId` gets the same generic 403 used
elsewhere. There is also no RBAC role requirement on any Cart route:
authorization here is entirely resource ownership, since
`docs/database/cart.md` never ties cart operations to a role.

---

# 25. Transactions

Operations that modify multiple related financial or business records should use database transactions where atomicity is required.

Examples include:

* Order creation
* Payment state transitions
* Refund processing
* Wallet transactions
* Commission creation
* Vendor earnings updates

The system should avoid partial state updates.

For example:

```text
Payment
   +
Order
   +
Wallet
   +
Commission
```

must not become partially updated when the business operation requires atomicity.

## Checkout Transaction Boundary (implemented, Phase 13)

`CheckoutService.checkout` (`src/orders/`) wraps exactly the operations
that must succeed or fail together in one `prisma.$transaction`: the
atomic `Cart.status: ACTIVE → CONVERTED` guard, per-item inventory
reservation, and creation of the MasterOrder / VendorOrder(s) /
OrderItem(s) / OrderStatusHistory / VendorOrderStatusHistory /
InventoryTransaction rows. Cart validation (ownership, non-empty) and
product/variant/vendor/currency/inventory validation happen read-only
*before* the transaction opens, matching the pattern already established
by `CartService.addItem` (Phase 12) — external/slow work never happens
inside the transaction, and nothing not requiring atomicity is placed
inside it either.

Inventory reservation itself uses a single atomic conditional `UPDATE`
(`SET reserved = reserved + $qty WHERE ... AND on_hand - reserved >=
$qty`, checking the affected row count) rather than a
SELECT-then-check-then-UPDATE sequence — see
`docs/database/catalog.md` §47's explicit warning against the latter.
This requires no distributed lock and no Redis.

**Concurrency proof (Phase 18):** the cart-conversion guard above is
verified, not just designed — `test/checkout.e2e-spec.ts`'s
`Concurrency (Phase 18)` suite fires two genuinely simultaneous
`POST /api/checkout` requests (via `Promise.all`) against the same active
cart with inventory tight enough that a double-reservation would be
unmissable, and asserts the resulting database state directly (exactly
one `MasterOrder`/`VendorOrder`/`OrderItem`, `Inventory.reserved`
incremented exactly once, exactly one `RESERVATION`-type
`InventoryTransaction`). No production code changed as a result — the
Phase 13 design already held.

## Payment Transaction Boundary (implemented, Phase 15)

`PaymentsService`/`WebhooksService` (`src/payments/`) each wrap exactly
the writes that must be atomic: creating a `Payment` + its first
`PaymentAttempt` together (`createForUser`); creating a new
`PaymentAttempt` + resetting `Payment.status` together (`retry`); and,
per webhook event, updating the `PaymentAttempt`/`Payment`/
`MasterOrder.paymentStatus` (or `Refund`/`Payment`/
`MasterOrder.paymentStatus`) triple together
(`WebhooksService.handlePaymentOutcome`/`handleRefundOutcome`). The
`PaymentWebhookEvent` row itself is written *before* the transaction, as
its own atomic idempotency check (see below) — if that insert conflicts,
processing never starts. Ownership/ existence validation happens
read-only before any transaction opens, same pattern as Checkout.

---

# 26. Idempotency

Operations that may be retried must be designed to avoid duplicate side effects.

This is especially important for:

* Payment webhooks
* Payment callbacks
* Refund processing
* Order creation
* Wallet transactions
* Background jobs

External event identifiers and internal idempotency keys should be used where appropriate.

## Checkout Idempotency (implemented narrowly, Phase 13)

No idempotency-key table or header exists — the source documents
(`docs/database/order.md` §35, `docs/database/payment-refund.md` §40)
both describe the exact key/storage model as still "to be finalized,"
and inventing one was explicitly out of scope for this phase. Instead,
`CheckoutService` relies on the same atomic `Cart.status` transition
described above: a retried or concurrent checkout request against the
*same* cart necessarily loses that guard (the cart is no longer
`ACTIVE`) and fails cleanly rather than creating a second order. This is
a narrower guarantee than full request-level idempotency — it does not,
for example, deduplicate two genuinely separate checkout attempts built
from two different carts with identical contents.

## Webhook Idempotency (implemented, Phase 15; hardened, Phase 16)

`PaymentWebhookEvent`'s existing `UNIQUE(provider, eventId)` constraint
*is* the idempotency mechanism — no separate idempotency-key table was
introduced (`docs/database/payment-refund.md` §21 names this constraint
directly as the intended protection). `WebhooksService.processEvent`
always attempts to `create` the event row first; a unique-constraint
violation means this exact event was already received, and the
associated state change (Payment/Attempt/Refund/MasterOrder update) is
never re-applied — the request still returns 200 with
`{ status: 'duplicate' }`, since a non-2xx response would only cause a
real gateway to keep retrying.

**Second, independent idempotency layer (Phase 16):** the
`(provider, eventId)` constraint alone only catches the exact same event
delivered twice. `handlePaymentOutcome`/`handleRefundOutcome`
additionally check the target `PaymentAttempt`/`Refund`'s own current
status before applying any financial effect — an attempt/refund that is
no longer `INITIATED`/`PENDING` is treated as already resolved (event
marked `IGNORED`, `{ status: 'duplicate' }` returned) rather than
reapplied. This closes the gap where a (non-conforming) provider reports
the same underlying outcome under two different event ids — without it,
`Payment.refundedAmount` in particular (an accumulation, not an
absolute-set field) could be double-credited.

**Payment ownership (Phase 15):** `Payment` is reached through
`MasterOrder`, which is user-owned (the same pattern established for
`MasterOrder` itself in Phase 14) — `PaymentsService` does not use
`OwnershipService` or a vendor-ownership guard; it compares
`payment.masterOrder.userId` to the authenticated caller directly, with
an ADMIN bypass (`AuthorizationService.hasRole`) applied only to
*viewing* (`findById`), not to creating or retrying another user's
payment.

**Refund consistency (Phase 15):** a refund amount is never accepted
as authoritative — it is always validated against
`payment.paidAmount - payment.refundedAmount`
(`docs/database/payment-refund.md` §11/§34) both at creation (a
"sanity" pre-check) and implicitly enforced again by how
`refund.succeeded` recomputes `Payment.status`
(`PARTIALLY_REFUNDED` vs. `REFUNDED`) from the actual cumulative
`refundedAmount`, never from client input.

**No gateway, no signature verification (Phase 15, explicit gap):**
`docs/database/payment-refund.md` §22 requires webhook signature
verification in principle, but ties the exact mechanism to "the
provider" — undefined here, since this phase deliberately does not
integrate a real gateway (Stripe/SSLCommerz/bKash/...). Inventing a
signature scheme would mean inventing which gateway is being simulated.
`POST /api/payments/webhook` is therefore unauthenticated with no
signature check — a real, intentional, and documented security gap in
this foundation, not an oversight, to be closed only once a specific
provider is actually chosen and integrated.

---

# 27. Background Processing

Long-running or retryable tasks should not unnecessarily block HTTP requests.

The preferred architecture is:

```text
HTTP Request
     │
     ▼
Validate
     │
     ▼
Create Job
     │
     ▼
Return Response
     
Background Worker
     │
     ▼
Process Job
```

BullMQ should be used where asynchronous processing provides a clear benefit.

Not every operation should automatically become a background job.

---

# 28. Health Checks

The application exposes:

```text
GET /api/health
```

The health check verifies the availability of:

```text
PostgreSQL
Redis
```

Example response:

```json
{
  "status": "ok",
  "services": {
    "database": "up",
    "redis": "up"
  },
  "timestamp": "2026-08-17T00:00:00.000Z"
}
```

The health endpoint is intended for:

* Local verification
* Container health verification
* Deployment verification
* Monitoring integration

---

# 29. API Documentation

Swagger / OpenAPI is exposed during development at:

```text
/api/docs
```

The API documentation should be updated as controllers and DTOs are implemented.

Swagger decorators should describe:

* Endpoints
* Request DTOs
* Response schemas
* Authentication requirements
* Important parameters

---

# 30. Testing Architecture

The project uses two primary testing levels.

## Unit Tests

Unit tests verify isolated business logic using mocked dependencies.

Example:

```text
HealthService
    ↓
Mock Prisma
Mock Redis
```

Unit tests should not require running PostgreSQL or Redis unless the test is intentionally an integration test.

---

## E2E Tests

E2E tests verify the application through the HTTP layer.

Example:

```text
HTTP Request
    ↓
NestJS Application
    ↓
Controller
    ↓
Service
    ↓
Infrastructure
```

Current E2E coverage includes:

```text
GET /api/health
```

E2E tests should properly initialize and close the NestJS application.

---

# 31. Docker Development Environment

Docker Compose provides local infrastructure.

Current services:

```text
postgres
redis
```

PostgreSQL:

```text
localhost:5433
```

Redis:

```text
localhost:6379
```

The application itself currently runs directly through Node.js during development.

Infrastructure services run through Docker Compose.

This keeps local development simple while maintaining production-oriented infrastructure choices.

---

# 32. Production Deployment Principle

Development and production infrastructure should remain conceptually consistent.

Development currently uses:

```text
Application
    ↓
Docker PostgreSQL
Docker Redis
```

Production may use managed or containerized infrastructure depending on deployment requirements.

The application should not contain environment-specific business logic.

Configuration should come from environment variables.

---

# 33. Database Documentation

Detailed database design is maintained separately from this architecture document.

Database domain documentation is located under:

```text
docs/database/
```

Current domains include:

```text
audit
cart
catalog
identity-access
notification
order
payment-refund
promotion
review
vendor-shop
wallet-commission
```

The database implementation plan is located at:

```text
docs/plans/database-implementation-plan.md
```

This architecture document defines application-level boundaries.

The database documentation defines database-level design.

Both should remain aligned.

---

# 34. Development Principles

The following principles should guide future implementation.

## Keep Controllers Thin

Controllers should coordinate HTTP concerns, not contain business logic.

## Keep Business Logic in Services

Business rules belong in appropriate application/domain services.

## Avoid Premature Abstraction

Do not introduce repositories, factories, abstractions, or design patterns without a clear reason.

## Prefer Explicit Dependencies

Dependencies between modules should be visible and intentional.

## Avoid Circular Dependencies

Modules should have clear ownership and dependency direction.

## Validate at Boundaries

External input must be validated before entering business logic.

## Protect Ownership Boundaries

Authorization must verify both permissions and resource ownership where applicable.

## Prefer Transactions for Atomic Business Operations

Financial and multi-record state transitions should be atomic where required.

## Design Retryable Operations Carefully

External callbacks and background jobs must be safe to retry.

## Do Not Leak Secrets

Secrets must never be committed to Git or exposed through API responses or logs.

## Keep Infrastructure Centralized

Database, Redis, configuration, and queue infrastructure should be managed through dedicated modules.

---

# 35. Code Change Rules

Before introducing a new module, determine:

1. Which business domain owns the feature?
2. Which existing module should expose the required capability?
3. Does the feature require database changes?
4. Does the feature require Redis?
5. Does the feature require background processing?
6. Does the feature require authentication?
7. Does the feature require authorization?
8. Does the feature require resource ownership checks?
9. Does the feature require a transaction?
10. Does the feature require idempotency?

A feature should not bypass established architectural boundaries simply because doing so is faster.

---

# 36. Architectural Decision Changes

If a future requirement requires changing one of these architectural decisions, the change should be intentional.

Examples:

* Changing `/api` to `/api/v1`
* Replacing JWT authentication
* Changing the authorization model
* Introducing a repository abstraction
* Splitting the application into separate services
* Changing database infrastructure
* Changing queue infrastructure
* Introducing a multi-tenant architecture

Such changes should be documented before implementation when they materially affect the architecture.

---

# 37. Current Architecture Status

The current foundation includes:

```text
NestJS                         ✅
TypeScript                     ✅
Node.js 22 LTS                 ✅
PostgreSQL                     ✅
Prisma                         ✅
Redis                          ✅
BullMQ infrastructure          ✅
Environment validation         ✅
Global validation              ✅
Health checks                  ✅
Swagger                        ✅
Unit testing                   ✅
E2E testing                    ✅
Docker Compose                 ✅
Dependency security audit      ✅
```

The business modules will be implemented incrementally according to the project implementation plan.

---

# 38. Architecture Summary

The backend follows these core principles:

```text
Modular NestJS
      +
Clear domain boundaries
      +
Centralized infrastructure
      +
Strong request validation
      +
JWT authentication
      +
RBAC authorization
      +
Resource ownership checks
      +
Transactional business operations
      +
Idempotent retryable operations
      +
Automated testing
      +
Production-oriented infrastructure
```

The goal is not to maximize abstraction.

The goal is to maintain a backend that is:

* Maintainable
* Testable
* Secure
* Scalable
* Easy to reason about
* Consistent as new business domains are introduced

---

# 39. Architecture Decisions Approved (Implementation Status)

Some architectural decisions were formally approved by the project owner
ahead of their implementation phase. The full, authoritative record —
exact approved behavior, source basis, and implementation constraints —
lives in `docs/remaining-architecture-plan.md`'s **Architecture Decision
Register**, not here, to avoid duplicating a living planning document
inside this architectural reference. Status as of this note:

* **Implemented (Phase 17):** vendor verification and activation as two
  separate ADMIN-only operations (ADR-1) — extends §22-23's existing
  RBAC/ownership model, no new authorization mechanism.
* **Implemented (Phase 19):** the `VendorOrder` fulfillment lifecycle,
  scoped to `PENDING → CONFIRMED → PROCESSING → READY_TO_SHIP → SHIPPED →
  DELIVERED` plus early-state (`PENDING`/`CONFIRMED`) cancellation only
  (ADR-2) — no post-`PROCESSING` cancellation or return workflow is in
  scope, vendor-initiated only via the existing `VendorOrderOwnershipGuard`.
* **Implemented (Phase 19):** `MasterOrder.status` derived from its
  `VendorOrder`s, never client-settable (ADR-3) — a direct application of
  §7's existing requirement; see `src/orders/utils/master-order-status.ts`
  for the exact derivation formula.
* **Not yet implemented (planned for Phase 21):** inventory
  ownership/authorization extending the existing `User → Vendor →
  Product` ownership chain one hop further through `ProductVariant →
  Inventory`, with adjustment being vendor-self-service plus the existing
  ADMIN-bypass convention (ADR-4) — see §23's updated note above.

None of these decisions change this document's existing architectural
principles (§18-26) — they are applications of those principles to
domains that either now have controllers (ADR-1/2/3) or don't yet
(ADR-4), per the "existence of a domain does not mean its implementation
must be created immediately" rule in §5.

````

