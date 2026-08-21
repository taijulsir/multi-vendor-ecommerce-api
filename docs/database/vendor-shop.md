# Vendor & Shop Database Architecture

## Overview

The Vendor & Shop domain represents the business side of the multi-vendor
e-commerce platform.

The authentication identity is represented by the `User` entity, while
vendor-specific business information is represented by `Vendor`.

Each vendor owns one primary shop in the initial architecture.

### Core Entities

- Vendor
- Shop

### Core Relationship

```text
User
 │
 │ 1 : 0..1
 ▼
Vendor
 │
 │ 1 : 1
 ▼
Shop
````

---

# 1. Vendor

## Purpose

The `Vendor` entity represents the business-level profile of a user who
operates as a seller on the platform.

The `User` entity is responsible for authentication and identity, while
the `Vendor` entity contains business-specific information.

This separation allows the same user authentication system to support
customers, vendors, administrators, and future platform roles.

---

## Fields

| Field                | Type     | Required | Default           | Notes                       |
| -------------------- | -------- | -------: | ----------------- | --------------------------- |
| `id`                 | UUID     |      Yes | Generated         | Primary key                 |
| `userId`             | UUID     |      Yes | —                 | Foreign key → User, unique  |
| `businessName`       | String   |      Yes | —                 | Business/legal display name |
| `businessEmail`      | String   |       No | `null`            | Business contact email      |
| `businessPhone`      | String   |       No | `null`            | Business contact phone      |
| `status`             | Enum     |      Yes | `PENDING`         | Operational status          |
| `verificationStatus` | Enum     |      Yes | `PENDING`         | Verification state          |
| `verifiedAt`         | DateTime |       No | `null`            | Verification timestamp      |
| `createdAt`          | DateTime |      Yes | Current timestamp | Creation timestamp          |
| `updatedAt`          | DateTime |      Yes | Auto-updated      | Last update timestamp       |
| `deletedAt`          | DateTime |       No | `null`            | Soft-delete timestamp       |

---

# 2. Vendor Status

The vendor operational lifecycle is represented by:

```text
PENDING
ACTIVE
SUSPENDED
FROZEN
REJECTED
```

## PENDING

The vendor profile/application has been created but the vendor has not
yet been approved for normal platform operations.

## ACTIVE

The vendor is allowed to operate normally according to the permissions
assigned to the vendor's user account.

## SUSPENDED

The vendor is temporarily restricted from normal operations.

## FROZEN

The vendor is under a stronger operational restriction.

A frozen vendor may still be allowed to view certain information, but
vendor-side write actions and business operations can be restricted by
the authorization and business-rule layers.

## REJECTED

The vendor application has been rejected.

---

# 3. Vendor Verification Status

Vendor verification is intentionally separated from the operational
vendor status.

The verification lifecycle is:

```text
PENDING
UNDER_REVIEW
VERIFIED
REJECTED
```

## PENDING

The verification process has not started or the vendor has not yet been
reviewed.

## UNDER_REVIEW

The vendor information is currently being reviewed.

## VERIFIED

The vendor has successfully completed the verification process.

## REJECTED

The vendor verification request has been rejected.

---

# 4. Why Vendor Status and Verification Status Are Separate

Operational status and verification status represent two different
business concepts.

For example:

```text
status = FROZEN
verificationStatus = VERIFIED
```

This is a valid state.

The vendor may have been fully verified but later frozen by an
administrator due to a business or policy decision.

Therefore:

```text
verificationStatus
→ Represents whether the vendor is verified.

status
→ Represents whether the vendor is currently allowed to operate.
```

These concepts must not be combined into a single field.

---

# 5. Vendor Constraints

## Primary Key

```text
id
```

## Unique Constraint

```text
userId
```

This guarantees that a user can have at most one vendor profile.

```text
1 User → maximum 1 Vendor
```

## Indexes

The initial schema may index:

```text
status
verificationStatus
```

These fields are expected to be used frequently in administrative
vendor-management queries and filters.

Final indexes will be reviewed against actual query patterns before the
production schema is finalized.

---

# 6. Vendor Business Rules

## Vendor Creation

The initial vendor creation flow is:

```text
User
  ↓
Vendor Application
  ↓
Vendor Created
  ↓
status = PENDING
verificationStatus = PENDING
```

## Vendor Verification

The verification lifecycle is:

```text
PENDING
   ↓
UNDER_REVIEW
   ↓
VERIFIED
```

A verification request may also be rejected:

```text
PENDING / UNDER_REVIEW
          ↓
       REJECTED
```

## Vendor Activation

A successfully verified vendor can become operational:

```text
verificationStatus = VERIFIED
status = ACTIVE
```

Verification and activation may be implemented as separate service
operations so that the business rules remain explicit.

> **Approved (2026-08-22, ADR-1) and implemented (Phase 17, 2026-08-22):**
> two separate ADMIN-only operations —
> `PATCH /api/vendors/:vendorId/verification` and
> `PATCH /api/vendors/:vendorId/activation` — not a combined status
> endpoint. See `docs/remaining-architecture-plan.md`'s Architecture
> Decision Register for the full record. The implemented transition
> matrix is this phase's own narrow, documented reading of the arrows
> drawn above: `PENDING→UNDER_REVIEW`, `UNDER_REVIEW→VERIFIED`,
> `PENDING/UNDER_REVIEW→REJECTED` for verification, and
> `PENDING+VERIFIED→ACTIVE` for activation. `VERIFIED` and `REJECTED` are
> treated as terminal — **not implemented, and intentionally not
> invented:** `PENDING → VERIFIED` skipping `UNDER_REVIEW`, any
> re-verification/re-application path out of `REJECTED`, and any
> reactivation path for `SUSPENDED`/`FROZEN`/`REJECTED` vendors (those
> remain separate, undocumented administrative actions per §14, out of
> this phase's scope).

---

# 7. Shop

## Purpose

The `Shop` entity represents the vendor's storefront on the platform.

The shop contains storefront-specific information such as:

* Shop name
* Shop slug
* Description
* Logo
* Banner
* Shop status

---

# 8. Vendor-to-Shop Relationship

The initial architecture uses a one-to-one relationship:

```text
Vendor
  │
  │ 1 : 1
  ▼
Shop
```

Each vendor has one primary shop.

The initial system does not support multiple shops per vendor because
that would add unnecessary complexity for the current production
portfolio scope.

The architecture can be expanded later if multi-shop support becomes a
real business requirement.

---

# 9. Shop Fields

| Field         | Type     | Required | Default           | Notes                        |
| ------------- | -------- | -------: | ----------------- | ---------------------------- |
| `id`          | UUID     |      Yes | Generated         | Primary key                  |
| `vendorId`    | UUID     |      Yes | —                 | Foreign key → Vendor, unique |
| `name`        | String   |      Yes | —                 | Shop display name            |
| `slug`        | String   |      Yes | —                 | URL-friendly identifier      |
| `description` | Text     |       No | `null`            | Shop description             |
| `logoUrl`     | String   |       No | `null`            | Shop logo URL                |
| `bannerUrl`   | String   |       No | `null`            | Shop banner URL              |
| `status`      | Enum     |      Yes | `ACTIVE`          | Shop operational status      |
| `createdAt`   | DateTime |      Yes | Current timestamp | Creation timestamp           |
| `updatedAt`   | DateTime |      Yes | Auto-updated      | Last update timestamp        |
| `deletedAt`   | DateTime |       No | `null`            | Soft-delete timestamp        |

---

# 10. Shop Status

The initial shop statuses are:

```text
ACTIVE
INACTIVE
SUSPENDED
```

## ACTIVE

The shop is operational and can be displayed normally.

## INACTIVE

The shop is temporarily inactive.

This may be caused by the vendor disabling the shop or by a business
rule that temporarily prevents normal shop operation.

## SUSPENDED

The shop has been restricted by the platform or an administrator.

---

## API Contract (Phase 10)

`PATCH /api/shops/:shopId` reads "the vendor disabling the shop" (ACTIVE)
vs "restricted by the platform or an administrator" (SUSPENDED) as the
line between vendor-settable and administrator-only values: the owning
vendor may set `status` to `ACTIVE` or `INACTIVE` only. `SUSPENDED` is
rejected as an invalid request body on this endpoint — no transition
sequence/state machine is enforced beyond that (a vendor may freely
toggle between ACTIVE and INACTIVE). No separate administrative
suspend/unsuspend endpoint exists yet.

---

# 11. Shop Slug

Each shop will have a URL-friendly slug.

Example:

```text
businessName:
Taijul Electronics

slug:
taijul-electronics
```

The slug can be used for human-readable shop URLs and lookups.

Example:

```text
/api/shops/taijul-electronics
```

The exact public URL structure will be finalized during API routing
design.

---

## Slug Constraint

The shop slug will be unique across the platform:

```text
slug → UNIQUE
```

This makes routing and lookup predictable and avoids ambiguous shop URLs.

---

# 12. Shop Constraints

## Primary Key

```text
id
```

## Unique Constraint

```text
vendorId
```

This guarantees one primary shop per vendor.

```text
1 Vendor → 1 Shop
```

The shop slug is also unique:

```text
slug → UNIQUE
```

---

# 13. Vendor Freeze Behavior

Vendor status and shop status are intentionally independent database
fields.

For example:

```text
Vendor.status = FROZEN
Shop.status   = ACTIVE
```

This is technically valid at the database level.

However, an `ACTIVE` shop does not automatically mean that a frozen
vendor can perform write operations.

The application authorization and business-rule layers will evaluate the
vendor's operational status.

For example, vendor actions such as:

```text
POST   /products
PATCH  /products/:id
DELETE /products/:id
```

may be blocked when:

```text
Vendor.status = FROZEN
```

Read operations may still be allowed according to the platform's
business rules.

For example:

```text
GET /shop/:slug
GET /products
GET /shop/details
```

may remain available.

Therefore:

> Database state and authorization policy work together to determine
> actual platform behavior.

---

# 14. Vendor Suspension vs Freeze

The system intentionally keeps `SUSPENDED` and `FROZEN` as separate
vendor states.

## SUSPENDED

Represents a normal temporary operational restriction.

## FROZEN

Represents a stronger restriction where vendor business operations can be
aggressively limited.

The exact permission matrix for these states will be defined later in
the authentication, authorization, and security architecture.

The database is responsible for storing the current state.

The application/service layer is responsible for enforcing the behavior
associated with that state.

---

# 15. Soft Delete

Both `Vendor` and `Shop` support soft deletion through:

```text
deletedAt
```

Physical deletion should not be used casually.

Vendor and shop records may eventually be referenced by historical
business records such as:

* Products
* Orders
* Order items
* Payments
* Refunds
* Wallet transactions
* Commission records
* Audit logs

Soft deletion helps preserve historical business data and referential
integrity.

---

# 16. Relationship Map

```text
┌────────────────────┐
│       User         │
└─────────┬──────────┘
          │
          │ 1 : 0..1
          ▼
┌────────────────────┐
│      Vendor        │
├────────────────────┤
│ id                 │
│ userId UNIQUE      │
│ businessName       │
│ businessEmail      │
│ businessPhone      │
│ status             │
│ verificationStatus │
│ verifiedAt         │
│ createdAt          │
│ updatedAt          │
│ deletedAt           │
└─────────┬──────────┘
          │
          │ 1 : 1
          ▼
┌────────────────────┐
│       Shop         │
├────────────────────┤
│ id                 │
│ vendorId UNIQUE    │
│ name               │
│ slug UNIQUE        │
│ description        │
│ logoUrl             │
│ bannerUrl           │
│ status              │
│ createdAt           │
│ updatedAt           │
│ deletedAt           │
└────────────────────┘
```

---

# 17. Complete Business Flow

A simplified vendor onboarding flow:

```text
User
  ↓
Vendor Application
  ↓
Vendor
  ├── status = PENDING
  └── verificationStatus = PENDING
        ↓
   Under Review
        ↓
verificationStatus = VERIFIED
        ↓
status = ACTIVE
        ↓
Shop Created / Activated
        ↓
Vendor Can Manage Shop
```

If an administrator later freezes the vendor:

```text
Vendor.status
ACTIVE
  ↓
FROZEN
```

The vendor's permissions and business operations are then restricted by
the application authorization layer.

---

# 18. Design Decisions

| Decision                                           | Reason                                                          |
| -------------------------------------------------- | --------------------------------------------------------------- |
| User → Vendor = 1:0..1                             | Not every user is a vendor                                      |
| Vendor → Shop = 1:1                                | One primary shop per vendor in the initial scope                |
| `userId` is unique                                 | Prevent multiple vendor profiles for one user                   |
| `vendorId` is unique                               | Prevent multiple shops for one vendor                           |
| Vendor status is separate from verification status | Operational state and verification state are different concepts |
| Shop status is separate from vendor status         | Shop lifecycle can be independently controlled                  |
| `FROZEN` is a separate vendor state                | Required for strong vendor restrictions                         |
| Soft deletion is supported                         | Preserve historical business relationships                      |
| Shop slug is unique                                | Provides stable and unambiguous shop lookup                     |
| Database stores state                              | Business/service layers enforce behavior                        |
| Authorization is separate from database status     | A status field alone should not determine every permission      |

---

# 19. Security Considerations

Vendor and shop operations must always be scoped to the authenticated
vendor.

For example, a vendor should not be able to modify another vendor's shop
by simply providing another `shopId`.

The service layer must verify ownership:

```text
Authenticated User
        ↓
User → Vendor
        ↓
Vendor → Shop
        ↓
Requested Resource
```

Ownership checks must be performed server-side.

Client-provided vendor or shop identifiers must never be trusted without
authorization checks.

---

# 20. Data Isolation

Every vendor-owned resource should ultimately be traceable to a vendor.

For example:

```text
Shop
  ↓
Product
  ↓
OrderItem
  ↓
VendorOrder
  ↓
Vendor
```

This allows the application to enforce vendor-level data isolation.

A vendor should only be able to:

* View their own business data
* Modify their own shop
* Manage their own products
* View their own vendor orders
* Access their own financial records

unless an elevated role such as `ADMIN` explicitly has access.

---

# 21. Future Extensions

The following entities/features are intentionally not included in the
initial Vendor & Shop schema:

```text
VendorAddress
VendorDocument
VendorBankAccount
VendorTaxInformation
ShopAddress
ShopBusinessHours
ShopPolicies
VendorStaff
MultipleShops
```

These may be introduced later if required by the business domain.

In particular, financial information such as vendor bank accounts and
payout details will be designed separately as part of the Finance domain.

---

# 22. Implementation Status

```text
Vendor architecture        APPROVED
Shop architecture          APPROVED
Relationships              APPROVED
Vendor statuses            APPROVED
Verification model         APPROVED
Business rules             APPROVED
Constraints                APPROVED

Prisma models              IMPLEMENTED
Database migration          CREATED
API implementation          PARTIALLY IMPLEMENTED (Phases 10, 17)
Tests                       IMPLEMENTED (Phases 10, 17, for what exists)
```

> Phase 10 implemented vendor onboarding (`POST /api/vendors`,
> `GET /api/vendors/me`) and shop creation/retrieval/update
> (`POST /api/shops`, `GET /api/shops/slug/:slug`, `GET /api/shops/:shopId`,
> `PATCH /api/shops/:shopId`) exactly as specified above.
>
> Phase 17 implemented vendor verification/activation as two separate
> ADMIN-only endpoints — `PATCH /api/vendors/:vendorId/verification` and
> `PATCH /api/vendors/:vendorId/activation` (ADR-1,
> `docs/remaining-architecture-plan.md`'s Architecture Decision
> Register). See §6's update note for the exact implemented transition
> matrix and what was deliberately left unimplemented (skipping
> `UNDER_REVIEW`, any re-application out of `REJECTED`, reactivation from
> `SUSPENDED`/`FROZEN`). Neither endpoint touches `Shop` — Shop's own
> status remains entirely independent of Vendor's, per §13. Shop deletion
> is still not implemented (§15's soft-delete field exists on the model
> but nothing sets it via the API) — unrelated to Phase 17, unchanged.

This document represents the approved Vendor & Shop architecture for the
initial multi-vendor e-commerce implementation.

```
