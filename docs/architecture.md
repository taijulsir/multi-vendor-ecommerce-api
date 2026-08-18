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

````

