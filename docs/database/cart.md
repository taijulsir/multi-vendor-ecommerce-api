# Cart Database Architecture

## Overview

The Cart domain represents the user's current shopping intent before an
order is created.

The Cart domain is responsible for:

- Maintaining a user's active shopping cart
- Storing selected product variants
- Tracking requested quantities
- Supporting multi-vendor carts
- Preserving the user's current cart state
- Preparing data for checkout

The Cart domain does not create orders, process payments, or permanently
reserve inventory.

---

# 1. Cart Relationship

The high-level relationship is:

```text
User
  │
  └── Cart
        │
        └── CartItem
               │
               └── ProductVariant
````

A cart belongs to one user and contains zero or more cart items.

---

# 2. Cart

## Purpose

The `Cart` entity represents a user's active shopping session.

A cart may contain products from multiple vendors.

Example:

```text
User
  │
  └── Active Cart
       ├── Vendor A → Product Variant 1
       ├── Vendor A → Product Variant 2
       └── Vendor B → Product Variant 3
```

The cart itself does not need to be separated by vendor.

Vendor-specific grouping happens during checkout/order creation.

---

# 3. Cart Fields

| Field       | Type     | Required | Default           | Notes                    |
| ----------- | -------- | -------: | ----------------- | ------------------------ |
| `id`        | UUID     |      Yes | Generated         | Primary key              |
| `userId`    | UUID     |      Yes | —                 | Foreign key → User       |
| `status`    | Enum     |      Yes | `ACTIVE`          | Cart lifecycle           |
| `currency`  | String   |      Yes | —                 | Cart currency            |
| `createdAt` | DateTime |      Yes | Current timestamp |                          |
| `updatedAt` | DateTime |      Yes | Auto-updated      |                          |
| `expiresAt` | DateTime |       No | `null`            | Optional cart expiration |

---

# 4. Cart Status

The initial Cart lifecycle is:

```text
ACTIVE
CONVERTED
ABANDONED
EXPIRED
```

## ACTIVE

The cart is currently available for modification.

## CONVERTED

The cart has been successfully converted into an order.

The cart should no longer be modified after conversion.

## ABANDONED

The cart has not been actively used for a configured period.

## EXPIRED

The cart is no longer considered valid for checkout.

---

# 5. Active Cart Rule

The initial architecture supports one active cart per user.

Conceptually:

```text
User
  │
  ├── Active Cart
  │
  └── Historical/Converted Carts
```

Only one cart should have:

```text
status = ACTIVE
```

for a given user.

This rule should be enforced through an appropriate database constraint
and application logic.

---

# 6. Cart Currency

The cart has a canonical currency.

Example:

```text
currency = BDT
```

All cart items must be compatible with the cart's currency.

If the platform later supports multi-currency carts, the pricing architecture
must be extended explicitly rather than silently mixing currencies.

---

# 7. CartItem

## Purpose

`CartItem` represents one selected `ProductVariant` and its requested
quantity.

The sellable unit is always the ProductVariant.

```text
Cart
  │
  └── CartItem
         │
         └── ProductVariant
```

---

# 8. CartItem Fields

| Field                | Type     | Required | Default           | Notes                             |
| -------------------- | -------- | -------: | ----------------- | --------------------------------- |
| `id`                 | UUID     |      Yes | Generated         | Primary key                       |
| `cartId`             | UUID     |      Yes | —                 | Foreign key → Cart                |
| `variantId`          | UUID     |      Yes | —                 | Foreign key → ProductVariant      |
| `quantity`           | Integer  |      Yes | `1`               | Requested quantity                |
| `unitPriceSnapshot`  | Decimal  |      Yes | —                 | Price when item was added/updated |
| `currency`           | String   |      Yes | —                 | Currency associated with snapshot |
| `selectedAttributes` | JSON     |       No | `{}`              | Variant attributes at cart time   |
| `createdAt`          | DateTime |      Yes | Current timestamp |                                   |
| `updatedAt`          | DateTime |      Yes | Auto-updated      |                                   |

---

# 9. CartItem and ProductVariant

Cart items reference the sellable variant:

```text
CartItem
    │
    └── variantId
          ↓
    ProductVariant
```

The CartItem does not directly reference Inventory.

Inventory is reached through:

```text
CartItem
   ↓
ProductVariant
   ↓
Inventory
```

---

# 10. Unique Cart Item Rule

The same variant should not appear multiple times as separate rows in
the same active cart.

Therefore the initial design uses:

```text
UNIQUE(cartId, variantId)
```

Example:

Invalid:

```text
Cart
├── Product Variant A × 2
└── Product Variant A × 3
```

Correct:

```text
Cart
└── Product Variant A × 5
```

When the user adds an existing variant again, the application should
increase its quantity rather than create another CartItem.

---

# 11. Quantity Rules

Quantity must be a positive integer.

Valid:

```text
1
2
5
10
```

Invalid:

```text
0
-1
1.5
```

The service layer must validate quantity before modifying a CartItem.

Maximum quantity limits may also be introduced later according to
business requirements.

---

# 12. Cart Price Snapshot

The CartItem stores a non-authoritative price snapshot.

Example:

```text
unitPriceSnapshot = 2500.00
```

This allows the system to display the price that the user saw when the
item was added or last updated.

However, the CartItem price must never be treated as the final order
price.

---

# 13. Price Revalidation

Product prices can change after an item is added to the cart.

Example:

```text
At add-to-cart:
price = 2500

Later:
price = 2800
```

At checkout, the system must retrieve the current ProductVariant price
and revalidate the CartItem.

The checkout process must not blindly trust:

```text
CartItem.unitPriceSnapshot
```

The authoritative checkout price comes from the current pricing state
after all applicable pricing rules are evaluated.

---

# 14. Selected Attribute Snapshot

The CartItem may store the variant's selected attributes.

Example:

```json
{
  "color": "Black",
  "size": "M"
}
```

This is useful for:

* Cart display
* User-facing confirmation
* Debugging
* Detecting meaningful variant changes

The ProductVariant remains the authoritative catalog entity.

---

# 15. Product/Variant State Changes

A product or variant may become:

* inactive
* archived
* deleted
* unavailable

after being added to a cart.

The cart item should not necessarily be immediately deleted.

Instead, checkout must revalidate:

```text
Product status
Variant status
Inventory availability
Current price
Vendor status
Other business restrictions
```

If the item is no longer valid, checkout should fail gracefully with a
clear validation result.

---

# 16. Cart Does Not Reserve Inventory

Adding an item to the cart does not reserve inventory.

Example:

```text
User adds:
Product A × 2

Inventory:
onHand = 10
reserved = 0
```

After add-to-cart:

```text
onHand = 10
reserved = 0
```

No inventory reservation occurs.

This prevents users from holding inventory indefinitely by simply adding
items to their carts.

---

# 17. Inventory Reservation Starts During Checkout

The intended flow is:

```text
Add to Cart
     ↓
Cart
     ↓
Checkout
     ↓
Validate Cart
     ↓
Reserve Inventory
     ↓
Create Order
     ↓
Payment
```

Inventory reservation is therefore part of the checkout/order lifecycle,
not the Cart lifecycle.

The exact transaction boundaries will be defined in the Order domain.

---

# 18. Multi-Vendor Cart

A single cart may contain products from multiple vendors.

Example:

```text
Cart
├── Vendor A
│    ├── Product A1
│    └── Product A2
│
└── Vendor B
     └── Product B1
```

The Cart remains a single user-owned entity.

Vendor separation happens during order creation.

---

# 19. Multi-Vendor Checkout Preparation

During checkout, the cart can be grouped by vendor:

```text
Cart
 │
 ├── Vendor A
 │    ├── Item 1
 │    └── Item 2
 │
 └── Vendor B
      └── Item 3
```

This enables the Order domain to create:

```text
Master Order
├── Vendor Order A
└── Vendor Order B
```

The exact Master Order / Child Order structure belongs to the Order
architecture.

---

# 20. Cart Ownership and Security

The authenticated user is the owner of the cart.

The API must never trust a client-provided `userId` to determine ownership.

Correct flow:

```text
Authenticated User
       ↓
Authenticated identity
       ↓
User
       ↓
Active Cart
```

For vendor/admin operations, appropriate authorization must be applied.

Customers can only modify their own carts.

---

# 21. Cart Mutation Operations

The initial Cart domain should support:

```text
Add Item
Update Item Quantity
Remove Item
Clear Cart
Get Cart
```

Conceptual endpoints:

```text
POST   /cart/items
PATCH  /cart/items/:itemId
DELETE /cart/items/:itemId
DELETE /cart/items
GET    /cart
```

Exact endpoint naming can be finalized during API implementation.

---

# 22. Add Item Flow

The conceptual flow is:

```text
Request
  ↓
Authenticate User
  ↓
Get/Create Active Cart
  ↓
Validate ProductVariant
  ↓
Validate Product status
  ↓
Validate Vendor status
  ↓
Validate currency compatibility
  ↓
Check existing CartItem
  ↓
Create or increment CartItem
  ↓
Return updated Cart
```

Inventory should not be permanently reserved during this operation.

---

# 23. Update Quantity Flow

```text
Request
  ↓
Authenticate User
  ↓
Verify Cart ownership
  ↓
Verify CartItem belongs to Cart
  ↓
Validate quantity
  ↓
Update quantity
  ↓
Return updated Cart
```

If the requested quantity exceeds currently available stock, the system
may reject the update or allow the cart state to remain pending depending
on the chosen UX.

The final checkout validation is authoritative.

---

# 24. Remove Item Flow

```text
Request
  ↓
Authenticate User
  ↓
Verify Cart ownership
  ↓
Find CartItem
  ↓
Delete CartItem
  ↓
Return updated Cart
```

Because CartItems do not reserve inventory, removing a CartItem does not
require an inventory release operation.

---

# 25. Clear Cart Flow

Clearing the cart removes all active CartItems.

Conceptually:

```text
Active Cart
├── Item A
├── Item B
└── Item C

Clear Cart

Active Cart
└── Empty
```

No inventory release is required because the Cart domain does not hold
inventory reservations.

---

# 26. Cart Conversion

When checkout successfully creates an order:

```text
Cart
  ↓
Checkout
  ↓
Order Created
  ↓
Cart → CONVERTED
```

The converted cart must become immutable.

Historical cart information may be retained for auditing and user
history.

---

# 27. Cart and Order Separation

Cart and Order have different responsibilities.

### Cart

Represents:

```text
"What the user currently wants to buy."
```

### Order

Represents:

```text
"What the user actually purchased."
```

Therefore the Order must not depend on the Cart remaining unchanged.

The Order domain will create its own historical snapshots.

---

# 28. Order Price Snapshot

When an order is created, the order item must store its own immutable
pricing snapshot.

Example:

```text
Cart price:
2500

Current product price:
2800

Checkout final price:
2700
```

The OrderItem stores:

```text
2700
```

according to the final pricing calculation.

Later changes to the Product or ProductVariant must not change the
historical Order.

---

# 29. Cart Expiration

The Cart entity may contain:

```text
expiresAt
```

This allows future support for abandoned or expired carts.

Potential workflow:

```text
Cart
 ↓
Inactive for configured period
 ↓
BullMQ scheduled job
 ↓
Mark as ABANDONED / EXPIRED
```

The exact expiration duration is a business configuration and should not
be hardcoded into the database model.

---

# 30. Redis and BullMQ

Redis and BullMQ are not required for basic Cart CRUD.

They may later support:

* Cart caching
* Abandoned-cart processing
* Cart expiration
* Promotional recalculation
* Asynchronous notifications

PostgreSQL remains the durable source of truth.

Cart correctness must not depend solely on Redis.

---

# 31. Concurrency Considerations

Cart updates can happen concurrently.

Example:

```text
Request A:
Add Variant A × 1

Request B:
Add Variant A × 1
```

The system should avoid creating duplicate CartItems.

The unique constraint:

```text
UNIQUE(cartId, variantId)
```

combined with transaction-safe upsert/update logic should protect the
cart from duplicate rows.

Quantity updates must be atomic where concurrent modifications are
possible.

---

# 32. Index Strategy

Initial indexes should include:

```text
Cart
├── PRIMARY KEY (id)
├── INDEX (userId)
└── INDEX (status)

CartItem
├── PRIMARY KEY (id)
├── INDEX (cartId)
├── INDEX (variantId)
└── UNIQUE (cartId, variantId)
```

If one active cart per user is enforced through a partial unique index,
the database-specific implementation must ensure:

```text
UNIQUE(userId)
WHERE status = 'ACTIVE'
```

The exact Prisma/PostgreSQL implementation will be handled during schema
implementation.

---

# 33. Referential Integrity

The database must enforce valid relationships:

```text
Cart → User
CartItem → Cart
CartItem → ProductVariant
```

The application layer must additionally enforce:

* Cart ownership
* Variant availability
* Product state
* Vendor state
* Currency compatibility
* Quantity rules

---

# 34. Soft Delete Strategy

CartItems do not require soft deletion in the initial architecture.

Removing an item from a cart can physically remove the active CartItem.

Historical purchase information belongs to the Order domain, not the Cart
domain.

Converted carts may be retained for historical purposes.

---

# 35. Cart Business Rules Summary

## Cart

* A cart belongs to exactly one user.
* A user has one active cart.
* A cart may contain products from multiple vendors.
* Cart currency must remain consistent.
* Cart status controls whether modifications are allowed.
* Converted carts are immutable.
* Cart expiration is optional and configurable.

## CartItem

* A CartItem belongs to one Cart.
* A CartItem references one ProductVariant.
* Quantity must be a positive integer.
* The same variant cannot appear twice in the same cart.
* `UNIQUE(cartId, variantId)` is required.
* Cart price is a non-authoritative snapshot.
* Checkout must revalidate the current price.
* Variant attributes may be snapshotted for display.
* Removing a CartItem does not require inventory release.

## Inventory

* Adding to Cart does not reserve inventory.
* Inventory reservation begins during checkout.
* Checkout must perform final inventory validation.
* Order creation creates the authoritative purchase record.

---

# 36. Complete Cart Entity Map

```text
┌──────────────┐
│     User     │
└──────┬───────┘
       │
       │ 1:N
       ▼
┌──────────────┐
│     Cart     │
├──────────────┤
│ id           │
│ userId       │
│ status       │
│ currency     │
│ expiresAt    │
└──────┬───────┘
       │
       │ 1:N
       ▼
┌────────────────────┐
│     CartItem       │
├────────────────────┤
│ id                 │
│ cartId             │
│ variantId          │
│ quantity           │
│ unitPriceSnapshot  │
│ currency           │
│ selectedAttributes │
└──────────┬─────────┘
           │
           │ N:1
           ▼
┌────────────────────┐
│  ProductVariant    │
└────────────────────┘
```

---

# 37. Design Decisions

| Decision                                  | Reason                                                       |
| ----------------------------------------- | ------------------------------------------------------------ |
| One active cart per user                  | Simplifies checkout and cart ownership                       |
| Cart can contain multiple vendors         | Supports marketplace shopping                                |
| CartItem references ProductVariant        | Variant is the sellable unit                                 |
| Unique `(cartId, variantId)`              | Prevents duplicate cart rows                                 |
| Quantity stored on CartItem               | Represents requested quantity                                |
| Price snapshot stored on CartItem         | Improves cart display and change detection                   |
| Cart price is non-authoritative           | Product prices can change                                    |
| Checkout revalidates prices               | Prevents stale pricing                                       |
| Cart does not reserve inventory           | Prevents indefinite stock locking                            |
| Reservation starts at checkout            | Aligns inventory with purchase flow                          |
| PostgreSQL remains source of truth        | Ensures durable cart state                                   |
| Redis is optional infrastructure          | Cache should not become authoritative                        |
| BullMQ handles future async jobs          | Suitable for expiration/background work                      |
| Converted carts become immutable          | Preserves historical cart state                              |
| Order stores independent snapshots        | Product changes must not alter historical orders             |
| Multi-vendor grouping happens at checkout | Keeps Cart simple and Order responsible for vendor splitting |

---

# 38. Future Extensions

The following features are intentionally outside the initial Cart schema:

```text
Guest carts
Cart sharing
Wishlist
Save for later
Cart merge after login
Abandoned cart campaigns
Cart-level coupons
Vendor-specific cart restrictions
Subscription cart items
Buy-now flow
Saved carts
Advanced promotional pricing
```

These can be added later without changing the core Cart responsibility.

---

# 39. Implementation Status

```text
Cart architecture              APPROVED
CartItem architecture          APPROVED
Multi-vendor cart model        APPROVED
Price snapshot strategy        APPROVED
Inventory reservation model    APPROVED
Concurrency requirements       APPROVED
Cart lifecycle                 APPROVED

Prisma models                  NOT IMPLEMENTED
Database migration             NOT CREATED
API implementation             NOT IMPLEMENTED
Redis integration              NOT IMPLEMENTED
BullMQ integration             NOT IMPLEMENTED
Tests                          NOT IMPLEMENTED
```

> This document defines the initial Cart architecture. Prisma models,
> migrations, services, APIs, Redis workflows, BullMQ jobs, and tests will
> be implemented after the complete database architecture has been
> finalized.

````
