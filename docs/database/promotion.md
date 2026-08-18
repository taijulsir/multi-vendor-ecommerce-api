# Promotion and Coupon Database Architecture

## Overview

The Promotion and Coupon domain manages discounts and promotional
incentives applied during checkout.

This domain is responsible for:

- Coupons
- Promotion campaigns
- Discount rules
- Coupon redemption
- Usage limits
- Per-user usage limits
- Product/category/vendor targeting
- Fixed and percentage discounts
- Minimum order requirements
- Maximum discount limits
- Start/end dates
- Promotion activation
- Historical discount snapshots
- Preventing duplicate coupon usage

The Promotion domain integrates with:

- User
- Vendor
- Product
- ProductCategory
- Cart
- Order
- OrderItem
- Payment

The Promotion domain does not own final Order totals. The Order domain
stores the final historical pricing snapshot.

---

# 1. High-Level Architecture

The initial architecture separates:

```text
Promotion
    │
    ├── PromotionRule
    │
    └── Coupon
            │
            └── CouponRedemption
````

Conceptually:

```text
Promotion Campaign
       │
       ├── Eligibility Rules
       │
       ├── Discount Rules
       │
       └── Coupon
              │
              ▼
           Checkout
              │
              ▼
          Order Snapshot
```

---

# 2. Promotion

## Purpose

`Promotion` represents a promotional campaign.

A promotion defines:

* What discount is offered
* When it is active
* Who is eligible
* What products/vendors/categories are eligible
* Usage limits
* Discount constraints

A promotion may optionally have one or more coupons.

---

# 3. Promotion Fields

| Field                | Type     | Required | Default           | Notes                                      |
| -------------------- | -------- | -------: | ----------------- | ------------------------------------------ |
| `id`                 | UUID     |      Yes | Generated         | Primary key                                |
| `name`               | String   |      Yes | —                 | Internal/display promotion name            |
| `description`        | String   |       No | `null`            | Promotion description                      |
| `type`               | Enum     |      Yes | —                 | Discount type                              |
| `value`              | Decimal  |      Yes | —                 | Discount value                             |
| `maxDiscountAmount`  | Decimal  |       No | `null`            | Maximum discount for percentage promotions |
| `minimumOrderAmount` | Decimal  |       No | `null`            | Minimum eligible order value               |
| `currency`           | String   |       No | `null`            | Required for fixed monetary discounts      |
| `status`             | Enum     |      Yes | `DRAFT`           | Promotion lifecycle                        |
| `startsAt`           | DateTime |      Yes | —                 | Start time                                 |
| `endsAt`             | DateTime |       No | `null`            | End time                                   |
| `usageLimit`         | Integer  |       No | `null`            | Global usage limit                         |
| `perUserUsageLimit`  | Integer  |       No | `null`            | Per-user limit                             |
| `createdBy`          | UUID     |       No | `null`            | Admin/creator                              |
| `createdAt`          | DateTime |      Yes | Current timestamp |                                            |
| `updatedAt`          | DateTime |      Yes | Auto-updated      |                                            |

---

# 4. Promotion Type

Initial discount types:

```text
PERCENTAGE
FIXED_AMOUNT
```

## PERCENTAGE

Example:

```text
10% discount
```

## FIXED_AMOUNT

Example:

```text
500 BDT discount
```

---

# 5. Percentage Discount

Example:

```text
Order subtotal = 5000 BDT
Promotion = 10%

Discount = 500 BDT
```

If `maxDiscountAmount` is configured:

```text
Calculated discount = 1000 BDT
Maximum discount = 500 BDT

Applied discount = 500 BDT
```

---

# 6. Fixed Discount

Example:

```text
Order subtotal = 5000 BDT
Fixed discount = 500 BDT

Final subtotal = 4500 BDT
```

The discount must never reduce the applicable amount below zero.

---

# 7. Minimum Order Amount

A promotion may require a minimum eligible amount.

Example:

```text
minimumOrderAmount = 3000
```

Then:

```text
Order = 2500 → Not eligible
Order = 3000 → Eligible
Order = 5000 → Eligible
```

The exact calculation base must be defined by the promotion rule.

---

# 8. Maximum Discount Amount

Percentage promotions may define a maximum discount.

Example:

```text
Promotion:
10%

Maximum:
500 BDT
```

For:

```text
Order = 3000
Discount = 300
```

Applied:

```text
300 BDT
```

For:

```text
Order = 10000
Discount = 1000
```

Applied:

```text
500 BDT
```

---

# 9. Promotion Status

Initial statuses:

```text
DRAFT
SCHEDULED
ACTIVE
PAUSED
EXPIRED
CANCELLED
```

## DRAFT

Promotion is being configured.

## SCHEDULED

Promotion is configured but has not started.

## ACTIVE

Promotion can be applied if eligibility conditions are satisfied.

## PAUSED

Promotion is temporarily disabled.

## EXPIRED

Promotion's end time has passed.

## CANCELLED

Promotion has been permanently disabled.

---

# 10. Promotion Time Window

A promotion is eligible only within its configured time window.

Conceptually:

```text
startsAt <= currentTime
```

and:

```text
currentTime < endsAt
```

If `endsAt` is null, the promotion has no configured expiration time.

Application logic must still validate the promotion status.

---

# 11. Coupon

## Purpose

A Coupon represents a customer-entered promotional code.

Example:

```text
WELCOME500
SUMMER10
FIRSTORDER
```

A Coupon belongs to a Promotion.

---

# 12. Coupon Fields

| Field               | Type     | Required | Default           | Notes                              |
| ------------------- | -------- | -------: | ----------------- | ---------------------------------- |
| `id`                | UUID     |      Yes | Generated         | Primary key                        |
| `promotionId`       | UUID     |      Yes | —                 | FK → Promotion                     |
| `code`              | String   |      Yes | —                 | Unique coupon code                 |
| `status`            | Enum     |      Yes | `ACTIVE`          | Coupon lifecycle                   |
| `usageLimit`        | Integer  |       No | `null`            | Coupon-specific global usage limit |
| `perUserUsageLimit` | Integer  |       No | `null`            | Coupon-specific user limit         |
| `createdAt`         | DateTime |      Yes | Current timestamp |                                    |
| `updatedAt`         | DateTime |      Yes | Auto-updated      |                                    |

---

# 13. Coupon Code

Coupon codes must be unique.

Example:

```text
WELCOME500
```

Database constraint:

```text
UNIQUE(code)
```

Codes should be normalized consistently.

For example, the system may normalize:

```text
welcome500
Welcome500
WELCOME500
```

to:

```text
WELCOME500
```

The exact normalization strategy will be finalized during implementation.

---

# 14. Coupon Status

Initial statuses:

```text
ACTIVE
DISABLED
EXPIRED
```

A disabled coupon cannot be redeemed even if the underlying Promotion
remains active.

---

# 15. Promotion Scope

A promotion may apply to:

```text
GLOBAL
VENDOR
PRODUCT
CATEGORY
```

The initial schema should support targeting through separate relation
tables rather than storing arbitrary IDs in a JSON field.

---

# 16. PromotionVendor

Represents vendor-specific promotion targeting.

Fields:

| Field         | Type | Required |
| ------------- | ---- | -------: |
| `promotionId` | UUID |      Yes |
| `vendorId`    | UUID |      Yes |

Constraint:

```text
UNIQUE(promotionId, vendorId)
```

Example:

```text
Promotion A
├── Vendor 1
├── Vendor 2
└── Vendor 3
```

---

# 17. PromotionProduct

Represents product-specific promotion targeting.

Fields:

| Field         | Type | Required |
| ------------- | ---- | -------: |
| `promotionId` | UUID |      Yes |
| `productId`   | UUID |      Yes |

Constraint:

```text
UNIQUE(promotionId, productId)
```

---

# 18. PromotionCategory

Represents category-specific promotion targeting.

Fields:

| Field         | Type | Required |
| ------------- | ---- | -------: |
| `promotionId` | UUID |      Yes |
| `categoryId`  | UUID |      Yes |

Constraint:

```text
UNIQUE(promotionId, categoryId)
```

---

# 19. Why Separate Target Tables

Avoid storing targeting as:

```json
{
  "vendorIds": [],
  "productIds": [],
  "categoryIds": []
}
```

as the primary relational structure.

Separate relation tables provide:

* Referential integrity
* Proper indexing
* Efficient querying
* Clear relationships
* Easier authorization
* Better reporting

---

# 20. Global Promotion

A global promotion has no specific vendor/product/category targeting.

Example:

```text
Promotion:
WELCOME10

Scope:
GLOBAL
```

Eligibility can apply across the marketplace according to other rules.

---

# 21. Vendor Promotion

Example:

```text
Promotion:
Vendor Weekend Sale

Target:
Vendor A
```

Only products belonging to the eligible vendor can receive the promotion.

---

# 22. Product Promotion

Example:

```text
Promotion:
Laptop Sale

Target:
Product X
Product Y
```

Only matching products are eligible.

---

# 23. Category Promotion

Example:

```text
Promotion:
Electronics Week

Target:
Electronics Category
```

Products within the eligible category may qualify.

Category hierarchy rules must be defined separately if nested categories
are supported.

---

# 24. Promotion Eligibility

Eligibility may depend on:

```text
User
Order
Product
Category
Vendor
Coupon
Time
Usage
```

Conceptually:

```text
User
 ↓
Coupon
 ↓
Promotion
 ↓
Eligibility Rules
 ↓
Eligible Cart Items
 ↓
Discount
```

---

# 25. Coupon Redemption

A successful coupon application must create a redemption record.

This prevents the system from relying only on a usage counter.

---

# 26. CouponRedemption

## Purpose

`CouponRedemption` records the successful use of a coupon by a customer.

Fields:

| Field            | Type     | Required | Notes                   |
| ---------------- | -------- | -------: | ----------------------- |
| `id`             | UUID     |      Yes | Primary key             |
| `couponId`       | UUID     |      Yes | FK → Coupon             |
| `userId`         | UUID     |      Yes | FK → User               |
| `masterOrderId`  | UUID     |      Yes | FK → MasterOrder        |
| `discountAmount` | Decimal  |      Yes | Actual discount granted |
| `currency`       | String   |      Yes | Currency                |
| `createdAt`      | DateTime |      Yes | Redemption timestamp    |

---

# 27. Coupon Redemption Uniqueness

If a coupon allows only one use per user:

```text
UNIQUE(couponId, userId, masterOrderId)
```

However, the actual per-user usage limit may be greater than one.

Therefore the application must count successful redemptions for:

```text
couponId + userId
```

and compare against the configured limit.

---

# 28. Global Usage Limit

Example:

```text
usageLimit = 1000
```

After 1000 successful redemptions:

```text
Promotion:
No longer eligible
```

The implementation must use concurrency-safe logic.

Two simultaneous requests must not both succeed when only one usage
remains.

---

# 29. Per-User Usage Limit

Example:

```text
perUserUsageLimit = 1
```

User A:

```text
First use → Allowed
Second use → Rejected
```

User B:

```text
First use → Allowed
```

---

# 30. Usage Count

The system should prefer deriving usage from redemption records or
maintaining counters transactionally.

A simple mutable counter must not be treated as the only source of truth.

The authoritative record is:

```text
CouponRedemption
```

---

# 31. Promotion Stacking

The initial architecture should explicitly define whether multiple
promotions can be applied to the same order.

Initial decision:

```text
Only one coupon/promotion discount may be applied to a checkout.
```

This avoids complex stacking conflicts in the first implementation.

Future support may introduce:

```text
STACKABLE
NON_STACKABLE
```

rules.

---

# 32. Coupon and Promotion Separation

The Promotion defines:

```text
WHAT discount exists
```

The Coupon defines:

```text
WHICH code activates the promotion
```

Therefore:

```text
Promotion
   │
   ├── Coupon A
   ├── Coupon B
   └── Coupon C
```

may be supported if business requirements require multiple codes for the
same promotion.

---

# 33. Order Discount Snapshot

Once a discount is successfully applied to an Order, the final discount
must be stored as historical order data.

Example:

```text
Promotion:
SUMMER10

At checkout:
10% discount
Discount amount = 750 BDT
```

The Order must preserve:

```text
discountAmount = 750
```

Future changes to the Promotion must not modify the historical Order.

---

# 34. Promotion Snapshot

The order should preserve enough information to identify the applied
promotion.

Possible snapshot fields include:

```text
promotionId
couponId
promotionName
couponCode
discountType
discountValue
discountAmount
```

These may be stored at the appropriate Order/OrderItem level depending on
whether the discount is order-level or item-level.

---

# 35. Item-Level vs Order-Level Discount

The architecture should distinguish:

```text
ORDER_LEVEL
ITEM_LEVEL
```

discount application.

Example:

```text
ORDER_LEVEL:
500 BDT off entire eligible order

ITEM_LEVEL:
10% off selected products
```

The exact storage strategy will be finalized during Pricing
implementation.

---

# 36. Discount Allocation

When an order-level discount affects multiple VendorOrders, the discount
must be allocated deterministically.

Example:

```text
MasterOrder discount = 1000

Vendor A allocation = 600
Vendor B allocation = 400
```

The allocation strategy must be documented and deterministic.

This is important for:

* Vendor earnings
* Commission calculation
* Refunds
* Reporting

---

# 37. Promotion and Commission

Commission calculations may depend on discounted prices.

Therefore the system must define whether commission is calculated from:

```text
Gross price
```

or:

```text
Discounted price
```

Initial architecture:

```text
Commission base should use the final eligible vendor/item amount after
applicable discounts, unless a specific commission rule states otherwise.
```

The exact implementation will be centralized in the Pricing/Commission
service.

---

# 38. Promotion and Refund

Refunds must consider discounts that were applied during the original
order.

Example:

```text
Original item price = 5000
Promotion discount  = 500
Paid amount         = 4500
```

A refund must not automatically refund 5000.

Refund eligibility must be based on the historical order pricing snapshot.

---

# 39. Promotion and Payment

The Promotion domain does not modify payment state.

The flow is:

```text
Cart
 ↓
Promotion validation
 ↓
Discount calculation
 ↓
Final order total
 ↓
Payment
```

Payment receives the final payable amount.

---

# 40. Promotion and Cart

Promotion validation occurs during checkout.

A cart may temporarily calculate:

```text
subtotal
discount
finalTotal
```

But the final values are revalidated before Order creation.

The system must not trust a stale client-side discount calculation.

---

# 41. Server-Side Discount Validation

The client may submit:

```text
couponCode = "WELCOME500"
```

The server must determine:

* Coupon exists
* Coupon is active
* Promotion is active
* Current time is eligible
* User is eligible
* Usage limit is available
* Cart items qualify
* Minimum order requirement is satisfied
* Discount calculation is valid

The client must never submit the final discount amount as authoritative.

---

# 42. Concurrency

Promotion usage is concurrency-sensitive.

Example:

```text
Remaining coupon uses = 1

Request A → attempts redemption
Request B → attempts redemption
```

Only one request may consume the final available usage.

The redemption creation and usage validation must be protected by
appropriate database transaction logic.

---

# 43. Idempotency

Coupon redemption should be idempotent.

A retry of the same checkout request must not create duplicate successful
redemptions.

The final implementation may use:

* Checkout idempotency key
* Order reference
* Coupon/user uniqueness
* Transactional checks

or a combination of these.

---

# 44. Coupon Security

Coupon codes are user-controlled input.

The system must:

* Normalize coupon codes
* Validate length
* Avoid exposing internal promotion IDs unnecessarily
* Apply authorization/eligibility rules server-side
* Rate-limit coupon validation where appropriate
* Avoid revealing unnecessary information about restricted promotions

---

# 45. Admin Authorization

Promotion creation, update, activation, and cancellation must be
restricted to authorized administrative users.

Vendor users must not be able to modify global promotions unless a
specific vendor-promotion permission exists.

---

# 46. Vendor Promotion Authorization

If vendors are eventually allowed to create promotions for their own
products:

```text
Authenticated Vendor
       ↓
Vendor ownership
       ↓
Promotion target
       ↓
Owned Product/Category
```

A vendor must not be able to create a promotion targeting another
vendor's product.

---

# 47. Soft Delete / Historical Preservation

Promotions and coupons may become inactive.

Historical orders must retain their discount information.

Therefore:

```text
Promotion → EXPIRED/CANCELLED
```

is preferred over destructive deletion when historical references exist.

Coupon redemptions must never be deleted as part of normal operations.

---

# 48. Index Strategy

Initial indexes should include:

```text
Promotion
├── PRIMARY KEY (id)
├── INDEX (status)
├── INDEX (startsAt, endsAt)
└── INDEX (createdAt)

Coupon
├── PRIMARY KEY (id)
├── UNIQUE (code)
├── INDEX (promotionId)
└── INDEX (status)

CouponRedemption
├── PRIMARY KEY (id)
├── INDEX (couponId, createdAt)
├── INDEX (userId, createdAt)
└── INDEX (masterOrderId)

PromotionVendor
├── UNIQUE (promotionId, vendorId)
└── INDEX (vendorId)

PromotionProduct
├── UNIQUE (promotionId, productId)
└── INDEX (productId)

PromotionCategory
├── UNIQUE (promotionId, categoryId)
└── INDEX (categoryId)
```

---

# 49. Referential Integrity

The database must enforce:

```text
PromotionVendor → Promotion
PromotionVendor → Vendor

PromotionProduct → Promotion
PromotionProduct → Product

PromotionCategory → Promotion
PromotionCategory → Category

Coupon → Promotion
CouponRedemption → Coupon
CouponRedemption → User
CouponRedemption → MasterOrder
```

Application-level validation must enforce eligibility and ownership
rules.

---

# 50. Financial Precision

Discount values must use exact Decimal/Numeric types.

Examples:

```text
Promotion.value
Promotion.maxDiscountAmount
Promotion.minimumOrderAmount
CouponRedemption.discountAmount
```

Floating-point arithmetic must not be the authoritative calculation
mechanism.

---

# 51. Currency

Fixed monetary promotions must specify a currency.

Example:

```text
500 BDT
```

The promotion cannot be applied to an incompatible checkout currency.

Percentage promotions may not require a currency because the discount is
calculated against the order currency.

---

# 52. Promotion Calculation Principle

The calculation service should follow:

```text
1. Validate promotion
2. Validate coupon
3. Determine eligible items
4. Determine eligible amount
5. Validate minimum amount
6. Calculate discount
7. Apply maximum discount limit
8. Return discount breakdown
9. Revalidate during Order creation
10. Persist historical snapshot
```

The calculation must be deterministic.

---

# 53. Promotion Calculation Must Be Centralized

Controllers must not contain discount calculation logic.

Instead:

```text
PromotionController
        ↓
PromotionService
        ↓
PromotionCalculationService
        ↓
Eligibility + Pricing
```

This prevents different APIs from calculating different discounts.

---

# 54. Promotion Result

The promotion calculation service should return a structured result.

Conceptually:

```json
{
  "promotionId": "uuid",
  "couponId": "uuid",
  "eligible": true,
  "discountType": "PERCENTAGE",
  "discountValue": 10,
  "eligibleAmount": 5000,
  "discountAmount": 500,
  "currency": "BDT"
}
```

The exact DTO structure will be finalized during implementation.

---

# 55. Complete Promotion Entity Map

```text
                         ┌────────────────┐
                         │   Promotion    │
                         ├────────────────┤
                         │ type           │
                         │ value          │
                         │ limits         │
                         │ time window    │
                         └───────┬────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
              Promotion      Promotion    Promotion
                Vendor         Product      Category
                    │
                    │
                    ▼
                 Vendor


Promotion
    │
    └── Coupon
          │
          ▼
    CouponRedemption
          │
          ├── User
          └── MasterOrder
```

---

# 56. Design Decisions

| Decision                                 | Reason                                              |
| ---------------------------------------- | --------------------------------------------------- |
| Promotion separate from Coupon           | Separates campaign rules from customer-facing codes |
| Global/vendor/product/category targeting | Supports marketplace flexibility                    |
| Separate target tables                   | Referential integrity and queryability              |
| Coupon codes unique                      | Prevents ambiguous redemption                       |
| Redemption records persisted             | Reliable usage tracking                             |
| One promotion/coupon discount initially  | Avoids stacking complexity                          |
| Server calculates discount               | Prevents client-side manipulation                   |
| Discount snapshots stored in Order       | Historical accuracy                                 |
| Decimal/Numeric for discount amounts     | Financial precision                                 |
| Promotion usage is transaction-safe      | Prevents over-redemption                            |
| Coupon redemption is idempotent          | Prevents duplicate usage                            |
| Historical promotions are retained       | Preserves order references                          |
| Commission uses final eligible amount    | Keeps marketplace earnings consistent               |
| Refund uses historical pricing           | Prevents incorrect refunds                          |
| Promotion calculation centralized        | Prevents inconsistent pricing                       |
| Admin authorization required             | Protects promotional configuration                  |

---

# 57. Future Extensions

The following are intentionally outside the initial implementation:

```text
PromotionRule
PromotionCondition
PromotionStackingRule
BuyXGetY
FreeShippingPromotion
BundlePromotion
FlashSale
ReferralCode
AffiliatePromotion
LoyaltyPoints
GiftCard
StoreCredit
PromotionUsageCounter
PromotionAuditLog
ScheduledPromotionJob
```

These can be introduced as separate capabilities when required.

---

# 58. Implementation Status

```text
Promotion architecture               APPROVED
Coupon architecture                  APPROVED
Eligibility model                    APPROVED
Targeting model                      APPROVED
Usage limit model                    APPROVED
Redemption model                     APPROVED
Discount snapshot strategy           APPROVED
Concurrency strategy                 APPROVED
Idempotency strategy                 APPROVED
Security requirements                APPROVED

Prisma models                        IMPLEMENTED (schema only — no application layer)
Database migration                   CREATED
Promotion APIs                       NOT IMPLEMENTED
Coupon APIs                          NOT IMPLEMENTED
Promotion calculation service        NOT IMPLEMENTED
Coupon redemption service            NOT IMPLEMENTED
Redis integration                    NOT IMPLEMENTED
BullMQ integration                   NOT IMPLEMENTED
Tests                                NOT IMPLEMENTED
```

> This document defines the initial Promotion and Coupon architecture.
> Prisma models, migrations, promotion services, coupon redemption,
> pricing integration, Redis/BullMQ workflows, APIs, and tests will be
> implemented after the complete database architecture has been finalized.

The Promotion domain calculates and validates promotional eligibility,
while the Order domain preserves the final historical discount that was
actually applied to the purchase.

````