# Catalog Database Architecture

## Overview

The Catalog domain represents the products that vendors offer for sale
through the marketplace.

The Catalog domain is responsible for:

- Product categorization
- Vendor-owned products
- Product lifecycle management
- Product variants
- SKU management
- Product pricing
- Product attributes
- Product images
- Inventory tracking
- Inventory reservations
- Inventory movement history

### Core Entities

- Category
- Product
- ProductVariant
- ProductImage
- Inventory
- InventoryTransaction

---

# 1. Catalog Relationship

The high-level Catalog relationship is:

```text
Vendor
  │
  └── Product
        │
        ├── Category
        │
        ├── ProductImage
        │
        └── ProductVariant
                │
                └── Inventory
                        │
                        └── InventoryTransaction
````

---

# 2. Category

## Purpose

The `Category` entity organizes products into a hierarchical catalog
structure.

Categories support parent-child relationships so the platform can
represent nested product classifications.

Example:

```text
Electronics
├── Mobile
│   ├── Android Phones
│   └── iPhones
├── Laptops
└── Accessories
    ├── Headphones
    └── Chargers
```

---

## Fields

| Field         | Type     | Required | Default           | Notes                             |
| ------------- | -------- | -------: | ----------------- | --------------------------------- |
| `id`          | UUID     |      Yes | Generated         | Primary key                       |
| `parentId`    | UUID     |       No | `null`            | Self-reference to parent category |
| `name`        | String   |      Yes | —                 | Category name                     |
| `slug`        | String   |      Yes | —                 | URL-friendly identifier           |
| `description` | Text     |       No | `null`            | Category description              |
| `imageUrl`    | String   |       No | `null`            | Category image                    |
| `status`      | Enum     |      Yes | `ACTIVE`          | Category lifecycle                |
| `sortOrder`   | Integer  |      Yes | `0`               | Display ordering                  |
| `createdAt`   | DateTime |      Yes | Current timestamp |                                   |
| `updatedAt`   | DateTime |      Yes | Auto-updated      |                                   |
| `deletedAt`   | DateTime |       No | `null`            | Soft-delete timestamp             |

---

## Category Status

```text
ACTIVE
INACTIVE
```

### ACTIVE

The category can be displayed and used for normal catalog operations.

### INACTIVE

The category is temporarily unavailable for normal catalog operations.

---

## Category Hierarchy

A category with:

```text
parentId = null
```

is a root category.

A category with a non-null `parentId` is a child category.

Example:

```text
Electronics
    id = A

Mobile
    parentId = A
```

The database uses a self-referencing relationship:

```text
Category
   │
   ├── Parent Category
   │
   └── Child Categories
```

---

## Category Constraints

### Primary Key

```text
id
```

### Unique Constraint

```text
slug
```

The slug is globally unique across categories.

---

## Category Business Rules

* A category may have zero or more child categories.
* A category may have at most one parent.
* Root categories have `parentId = null`.
* Category deletion should be handled carefully when products reference
  the category.
* Categories should normally be soft-deleted rather than physically
  removed.
* The application layer must prevent invalid category cycles.

Example of an invalid structure:

```text
Category A
  ↓
Category B
  ↓
Category A
```

The service layer must prevent such circular relationships.

---

# 3. Product

## Purpose

The `Product` entity represents a vendor-owned catalog product.

The product contains catalog-level information, while the actual
sellable configuration is represented by `ProductVariant`.

---

## Fields

| Field         | Type     | Required | Default           | Notes                   |
| ------------- | -------- | -------: | ----------------- | ----------------------- |
| `id`          | UUID     |      Yes | Generated         | Primary key             |
| `vendorId`    | UUID     |      Yes | —                 | Foreign key → Vendor    |
| `categoryId`  | UUID     |      Yes | —                 | Foreign key → Category  |
| `name`        | String   |      Yes | —                 | Product name            |
| `slug`        | String   |      Yes | —                 | URL-friendly identifier |
| `description` | Text     |       No | `null`            | Product description     |
| `status`      | Enum     |      Yes | `DRAFT`           | Product lifecycle       |
| `productType` | Enum     |      Yes | `SIMPLE`          | SIMPLE or VARIABLE      |
| `createdAt`   | DateTime |      Yes | Current timestamp |                         |
| `updatedAt`   | DateTime |      Yes | Auto-updated      |                         |
| `deletedAt`   | DateTime |       No | `null`            | Soft-delete timestamp   |

---

# 4. Product Status

The product lifecycle is:

```text
DRAFT
ACTIVE
INACTIVE
ARCHIVED
```

## DRAFT

The product exists but is not published to customers.

## ACTIVE

The product is published and available for normal storefront operations,
subject to inventory and other business rules.

## INACTIVE

The product is temporarily unavailable.

## ARCHIVED

The product is no longer actively maintained or sold but historical
references must remain valid.

---

# 5. Product Type

The initial product types are:

```text
SIMPLE
VARIABLE
```

## SIMPLE

A simple product does not have multiple customer-selectable
configurations.

Example:

```text
Logitech Mouse
```

Internally, however, it still uses one default `ProductVariant`.

```text
Product
└── Default Variant
```

## VARIABLE

A variable product has multiple sellable variants.

Example:

```text
T-Shirt
├── Black / S
├── Black / M
├── Black / L
├── White / S
└── White / M
```

---

# 6. Why Simple Products Still Use Variants

The system intentionally treats `ProductVariant` as the canonical
sellable unit for both simple and variable products.

For a simple product:

```text
Product
   ↓
Default Variant
   ├── SKU
   ├── Price
   └── Inventory
```

For a variable product:

```text
Product
   ↓
Multiple Variants
   ├── SKU
   ├── Price
   └── Inventory
```

This keeps Cart, Order, Pricing, and Inventory logic consistent.

The application does not need completely separate purchasing logic for
simple and variable products.

---

# 7. Product Slug

Each product has a globally unique slug.

Example:

```text
name:
Apple iPhone 17 Pro Max

slug:
apple-iphone-17-pro-max
```

Constraint:

```text
slug → UNIQUE
```

The slug may be used for public product lookup and human-readable URLs.

---

# 8. Product Ownership

Every product belongs to exactly one vendor.

```text
Product.vendorId
```

The ownership chain is:

```text
Authenticated User
       ↓
Vendor
       ↓
Product
```

A vendor must only be able to access and modify their own products.

Example:

```text
Vendor A
 └── Product A

Vendor B
 └── Product B
```

Vendor A must not be able to update Product B by supplying Product B's
ID.

The service layer must verify ownership before allowing vendor-level
mutations.

---

# 9. Product Category

The initial architecture assigns one primary category to each product.

```text
Product
   │
   └── categoryId
```

This intentionally avoids a many-to-many `ProductCategory` relationship
in the initial version.

If future requirements require multiple categories per product, the
architecture can be extended with:

```text
ProductCategory
```

without changing the core Product identity.

---

# 10. ProductVariant

## Purpose

`ProductVariant` represents the actual sellable configuration of a
product.

A variant is the unit that ultimately participates in:

* Cart items
* Orders
* SKU management
* Pricing
* Inventory
* Stock reservations

Example:

```text
Product:
Nike T-Shirt

Variants:
├── Black / S
├── Black / M
├── Black / L
├── White / S
└── White / M
```

---

## ProductVariant Fields

| Field            | Type     | Required | Default           | Notes                       |
| ---------------- | -------- | -------: | ----------------- | --------------------------- |
| `id`             | UUID     |      Yes | Generated         | Primary key                 |
| `productId`      | UUID     |      Yes | —                 | Foreign key → Product       |
| `sku`            | String   |      Yes | —                 | Globally unique SKU         |
| `name`           | String   |       No | `null`            | Optional display label      |
| `price`          | Decimal  |      Yes | —                 | Current selling price       |
| `compareAtPrice` | Decimal  |       No | `null`            | Reference/original price    |
| `costPrice`      | Decimal  |       No | `null`            | Internal vendor cost        |
| `currency`       | String   |      Yes | —                 | ISO-style currency code     |
| `attributes`     | JSON     |       No | `{}`              | Variant-defining attributes |
| `isDefault`      | Boolean  |      Yes | `false`           | Default variant flag        |
| `status`         | Enum     |      Yes | `ACTIVE`          | Variant lifecycle           |
| `createdAt`      | DateTime |      Yes | Current timestamp |                             |
| `updatedAt`      | DateTime |      Yes | Auto-updated      |                             |
| `deletedAt`      | DateTime |       No | `null`            | Soft-delete timestamp       |

---

# 11. SKU

SKU means Stock Keeping Unit.

The SKU identifies a specific sellable configuration.

Example:

```text
NIKE-TSHIRT-BLK-M
```

Another example:

```text
IPHONE17PM-256-BLK
```

The SKU is globally unique:

```text
sku → UNIQUE
```

This simplifies:

* Inventory identification
* Order processing
* Vendor operations
* Product lookup
* Warehouse operations
* Reporting

---

# 12. Why SKU Belongs to ProductVariant

A product can contain multiple configurations.

Example:

```text
Nike T-Shirt
├── Black / S → NIKE-TS-BLK-S
├── Black / M → NIKE-TS-BLK-M
├── White / S → NIKE-TS-WHT-S
└── White / M → NIKE-TS-WHT-M
```

Therefore SKU belongs to the variant rather than the parent product.

---

# 13. Variant Pricing

Pricing is stored at the `ProductVariant` level.

```text
ProductVariant
├── price
├── compareAtPrice
└── costPrice
```

## `price`

The current customer-facing selling price.

## `compareAtPrice`

A reference/original price used to represent discounts or promotional
pricing.

Example:

```text
price = 2500.00
compareAtPrice = 3000.00
```

## `costPrice`

The vendor's internal acquisition or cost price.

This is a sensitive internal business field and must not be exposed to
public customers.

---

# 14. Money Representation

Financial values must not rely on JavaScript floating-point arithmetic.

PostgreSQL will use an exact decimal/numeric representation.

Prisma will map these values to its `Decimal` type.

Conceptually:

```text
price = Decimal
compareAtPrice = Decimal
costPrice = Decimal
```

Examples:

```text
1999.99
2500.00
49.95
```

Application-level financial calculations must use controlled decimal
arithmetic.

---

# 15. Currency

Each variant price is associated with a currency.

Example:

```text
price = 2500.00
currency = BDT
```

Another:

```text
price = 25.00
currency = USD
```

The initial implementation uses a three-letter currency code.

Examples:

```text
BDT
USD
EUR
GBP
```

The currency is stored together with the monetary value so that the
meaning of the price is explicit.

---

# 16. Initial Currency Strategy

The initial architecture stores one canonical price and currency per
variant:

```text
ProductVariant
├── price
└── currency
```

The initial system does not store arbitrary multiple currency prices for
the same variant.

If region-specific or multi-currency pricing becomes a requirement, a
separate pricing model can be introduced later.

For example:

```text
ProductPrice
```

This keeps the initial Catalog schema focused and avoids premature
complexity.

---

# 17. Variant Attributes

Variant-defining attributes are stored as JSON.

Example:

```json
{
  "color": "Black",
  "size": "M"
}
```

Another example:

```json
{
  "storage": "256GB",
  "color": "Titanium Black"
}
```

Different product categories may have different attributes.

Examples:

```text
T-Shirt
→ color, size

Phone
→ storage, color

Laptop
→ RAM, storage, processor
```

JSON provides flexibility without requiring a database column for every
possible product attribute.

---

# 18. Attribute Validation

Using JSON does not mean arbitrary attributes should be accepted.

The application/service layer must validate variant attributes according
to the product's allowed attribute rules.

Example:

```text
T-Shirt
Allowed attributes:
- color
- size
```

Valid:

```json
{
  "color": "Black",
  "size": "M"
}
```

Invalid:

```json
{
  "banana": "yes"
}
```

The exact attribute-definition system is intentionally left open for
future Catalog expansion.

---

# 19. Variant Name

The optional `name` field provides a human-readable display label.

Example:

```text
Black / Medium
```

The source of truth remains the structured `attributes` field.

Example:

```text
name:
Black / Medium

attributes:
{
  "color": "Black",
  "size": "M"
}
```

The application may generate the display name from attributes when
appropriate.

---

# 20. Default Variant

Each product must have a default sellable variant.

## Simple Product

A simple product has exactly one default variant.

```text
Logitech Mouse
└── Default Variant
```

## Variable Product

A variable product may contain multiple variants, with exactly one
active default variant.

Example:

```text
T-Shirt
├── Black / S
├── Black / M ← Default
├── Black / L
└── White / M
```

The system must ensure:

```text
One Product
→ Maximum one active default Variant
```

This rule should be enforced through a combination of database
constraints and application validation where appropriate.

---

# 21. Variant Status

The initial variant lifecycle is:

```text
ACTIVE
INACTIVE
ARCHIVED
```

## ACTIVE

The variant can be sold if all other business conditions are satisfied.

## INACTIVE

The variant is temporarily unavailable.

## ARCHIVED

The variant is no longer actively sold but must remain referenceable by
historical orders.

---

# 22. Product and Variant Rules

## SIMPLE

A simple product must have exactly one sellable/default variant.

## VARIABLE

A variable product may contain multiple variants.

The application layer must prevent inconsistent states such as:

```text
SIMPLE product
→ multiple active sellable variants
```

or:

```text
VARIABLE product
→ zero sellable variants
```

The exact validation rules will be implemented during the Catalog service
implementation.

---

# 23. ProductImage

## Purpose

`ProductImage` stores product and variant image references.

Images themselves will not be stored directly in PostgreSQL.

The database stores metadata and storage URLs/keys.

---

## Fields

| Field        | Type     | Required | Default           | Notes                        |
| ------------ | -------- | -------: | ----------------- | ---------------------------- |
| `id`         | UUID     |      Yes | Generated         | Primary key                  |
| `productId`  | UUID     |      Yes | —                 | Foreign key → Product        |
| `variantId`  | UUID     |       No | `null`            | Optional FK → ProductVariant |
| `url`        | String   |      Yes | —                 | Image URL                    |
| `storageKey` | String   |       No | `null`            | Object storage key           |
| `altText`    | String   |       No | `null`            | Accessibility text           |
| `sortOrder`  | Integer  |      Yes | `0`               | Display ordering             |
| `isPrimary`  | Boolean  |      Yes | `false`           | Primary image flag           |
| `createdAt`  | DateTime |      Yes | Current timestamp |                              |
| `updatedAt`  | DateTime |      Yes | Auto-updated      |                              |
| `deletedAt`  | DateTime |       No | `null`            | Soft-delete timestamp        |

---

# 24. Product-Level vs Variant-Level Images

A `ProductImage` can belong to:

* The product generally
* A specific variant

Example:

```text
Product
└── ProductImage
    └── General product image
```

or:

```text
Product
└── Variant
    └── ProductImage
        └── Black variant image
```

The application layer must validate that a `variantId`, when provided,
belongs to the same `productId`.

This prevents inconsistent relationships such as:

```text
Product A
   ↓
Image
   ↓
Variant belonging to Product B
```

---

# 25. Image Storage

The database does not store binary image data.

Instead, it stores references such as:

```text
url
storageKey
```

The actual files can be stored in object storage.

Potential infrastructure includes:

* S3-compatible storage
* Cloud object storage
* Private object storage

The exact provider is an infrastructure decision and is not part of the
Catalog schema.

---

# 26. ProductImage Constraints

The application should ensure that:

* A product image belongs to a valid product.
* A variant image belongs to the same product as the image's
  `productId`.
* A product can have multiple images.
* Display order is controlled through `sortOrder`.
* Primary-image rules are enforced at the application/database level.

---

# 27. Inventory

## Purpose

`Inventory` represents the current stock state of a sellable
`ProductVariant`.

Inventory is tracked at the variant level.

```text
Product
   ↓
ProductVariant
   ↓
Inventory
```

A product's stock is therefore determined by its sellable variants.

---

# 28. Inventory Fields

| Field               | Type     | Required |           Default | Notes                             |
| ------------------- | -------- | -------: | ----------------: | --------------------------------- |
| `id`                | UUID     |      Yes |         Generated | Primary key                       |
| `variantId`         | UUID     |      Yes |                 — | FK → ProductVariant, unique       |
| `onHand`            | Integer  |      Yes |               `0` | Physical/current stock            |
| `reserved`          | Integer  |      Yes |               `0` | Stock reserved for pending orders |
| `lowStockThreshold` | Integer  |      Yes |               `0` | Low-stock warning threshold       |
| `createdAt`         | DateTime |      Yes | Current timestamp |                                   |
| `updatedAt`         | DateTime |      Yes |      Auto-updated |                                   |

---

# 29. Inventory Relationship

Each variant has one inventory record:

```text
ProductVariant
      │
      │ 1 : 1
      ▼
 Inventory
```

Constraint:

```text
variantId → UNIQUE
```

This prevents multiple inventory records for the same variant in the
initial architecture.

---

# 30. On-Hand Stock

`onHand` represents the current stock quantity recorded for the variant.

Example:

```text
onHand = 100
```

This does not necessarily mean that all 100 units can currently be
purchased.

Some units may already be reserved.

---

# 31. Reserved Stock

`reserved` represents units temporarily reserved for orders or checkout
flows that have not yet completed the final stock lifecycle.

Example:

```text
onHand  = 100
reserved = 20
```

The available quantity is:

```text
available = onHand - reserved
```

Therefore:

```text
available = 80
```

---

# 32. Available Stock

Available stock is a derived value.

```text
available = onHand - reserved
```

We do not store `available` as a separate database field in the initial
schema.

This prevents inconsistent states such as:

```text
onHand = 100
reserved = 20
available = 95
```

The service/query layer calculates the available quantity.

---

# 33. Inventory Invariants

The following invariants must always hold:

```text
onHand >= 0
reserved >= 0
reserved <= onHand
```

Therefore:

```text
available >= 0
```

These rules must be protected through application validation and
transaction-safe database operations.

---

# 34. Low Stock Threshold

`lowStockThreshold` determines when the inventory should be considered
low.

Example:

```text
onHand = 10
reserved = 7
available = 3
lowStockThreshold = 5
```

The available quantity is below the threshold:

```text
3 < 5
```

The system can therefore generate a low-stock event or notification.

The exact notification mechanism belongs to the Notification domain.

---

# 35. InventoryTransaction

## Purpose

`InventoryTransaction` provides an immutable history of inventory
movements and reservations.

The current `Inventory` record represents the current state.

The `InventoryTransaction` records explain how that state changed.

```text
Inventory
   ↑
   │
InventoryTransaction
```

This creates an audit-friendly inventory ledger.

---

# 36. InventoryTransaction Fields

| Field           | Type        | Required | Default           | Notes                              |
| --------------- | ----------- | -------: | ----------------- | ---------------------------------- |
| `id`            | UUID        |      Yes | Generated         | Primary key                        |
| `inventoryId`   | UUID        |      Yes | —                 | FK → Inventory                     |
| `type`          | Enum        |      Yes | —                 | Transaction type                   |
| `quantity`      | Integer     |      Yes | —                 | Movement quantity                  |
| `referenceType` | String      |       No | `null`            | Related business entity type       |
| `referenceId`   | UUID/String |       No | `null`            | Related entity identifier          |
| `note`          | String      |       No | `null`            | Human-readable reason              |
| `createdBy`     | UUID        |       No | `null`            | User responsible for manual action |
| `createdAt`     | DateTime    |      Yes | Current timestamp | Immutable timestamp                |

---

# 37. Inventory Transaction Types

The initial transaction types are:

```text
RESTOCK
SALE
RESERVATION
RELEASE
RETURN
ADJUSTMENT
```

---

# 38. RESTOCK

Represents stock being added to inventory.

Example:

```text
Current:
onHand = 50

RESTOCK +20

New:
onHand = 70
```

---

# 39. SALE

Represents stock consumed by a completed/confirmed sale.

Example:

```text
onHand = 70

SALE -2

onHand = 68
```

The exact point at which `SALE` is recorded will be defined by the Order
and Payment lifecycle.

---

# 40. RESERVATION

Represents stock being reserved for an order or checkout flow.

Example:

```text
onHand = 70
reserved = 0

RESERVATION +2

onHand = 70
reserved = 2
```

Available stock becomes:

```text
70 - 2 = 68
```

---

# 41. RELEASE

Represents previously reserved stock being released.

Example:

```text
onHand = 70
reserved = 2

RELEASE -2 reserved

onHand = 70
reserved = 0
```

Release may happen when:

* Order is cancelled
* Payment fails
* Reservation expires
* Checkout fails

---

# 42. RETURN

Represents stock returning to available inventory after an eligible
return.

Example:

```text
RETURN +1
```

The exact restocking behavior will depend on the product and return
condition.

---

# 43. ADJUSTMENT

Represents a manual inventory correction.

Examples:

* Physical stock count correction
* Damaged inventory
* Lost inventory
* Warehouse correction
* Administrative adjustment

Manual adjustments must record the responsible user whenever possible.

Example:

```text
ADJUSTMENT -3
createdBy = adminUserId
note = "Damaged units removed"
```

---

# 44. Inventory Ledger Principle

The inventory system follows this principle:

```text
Current State
     +
Immutable Movement History
```

The `Inventory` table provides current state.

The `InventoryTransaction` table provides historical movement information.

This makes it possible to answer:

```text
Why is current stock 42?
```

by examining the inventory transaction history.

---

# 45. Inventory Transaction Immutability

Inventory transactions should be treated as immutable records.

Existing transactions should not normally be updated or deleted.

If an incorrect transaction occurs, a compensating transaction should be
created instead.

Example:

```text
Incorrect:
ADJUSTMENT -5

Correction:
ADJUSTMENT +5
```

This preserves the inventory audit trail.

---

# 46. Inventory Reservation Model

Reservations are separate from final sales.

Conceptually:

```text
Checkout
   ↓
Reserve Stock
   ↓
Payment
   ├── Success → Finalize Sale
   └── Failure → Release Reservation
```

This prevents multiple concurrent checkout requests from purchasing the
same available stock.

The final implementation will use database transactions and, where
appropriate, Redis/BullMQ-based asynchronous workflows.

---

# 47. Concurrency Considerations

Inventory operations are concurrency-sensitive.

Example:

```text
Available stock = 1

Customer A → checkout
Customer B → checkout
```

Both requests must not successfully reserve the same single unit.

Therefore inventory reservation must be implemented using atomic,
transaction-safe operations.

The implementation must avoid a naive flow such as:

```text
1. SELECT available stock
2. Check available > requested quantity
3. UPDATE stock
```

without transaction/concurrency protection.

The exact locking/atomic update strategy will be finalized during
implementation.

---

# 48. Redis and BullMQ Integration

Redis and BullMQ are infrastructure components, not replacements for
PostgreSQL inventory consistency.

PostgreSQL remains the source of truth for:

* Inventory state
* Reservations
* Orders
* Transactions

Redis may be used for:

* Short-lived coordination
* Caching
* Distributed locks where appropriate
* Queue infrastructure

BullMQ may be used for:

* Asynchronous inventory-related jobs
* Reservation expiry
* Notifications
* Post-order processing
* Reconciliation tasks

The system must never rely solely on Redis for permanent inventory
state.

---

# 49. Inventory Reservation Expiration

Reservations may have a limited lifetime.

Conceptually:

```text
Reserve Stock
     ↓
Reservation Active
     ↓
Payment / Order Completion
     ├── Success → Finalize
     └── Expired → Release
```

Reservation expiration will eventually be handled through an
asynchronous job.

BullMQ is a candidate for this workflow.

The exact reservation model and expiration timestamps will be finalized
during the Order/Checkout architecture.

---

# 50. Vendor Inventory Isolation

Inventory belongs to a variant.

The ownership chain is:

```text
Authenticated User
       ↓
Vendor
       ↓
Product
       ↓
ProductVariant
       ↓
Inventory
```

A vendor must only be able to view and modify inventory belonging to
their own products.

The service layer must verify ownership before inventory mutations.

---

# 51. Security Considerations

Vendor inventory operations must require authentication and appropriate
authorization.

Examples:

```text
inventory:view
inventory:update
inventory:adjust
```

may eventually become explicit permissions.

Customers must never be able to directly modify inventory.

Inventory adjustment endpoints must be protected because incorrect stock
adjustments can directly affect orders and financial outcomes.

Manual adjustments should record:

```text
createdBy
note
```

where applicable.

---

# 52. Product Image Security

Image URLs and storage keys should not expose private storage credentials.

If private object storage is used, access should be provided through
appropriate signed URLs or controlled media endpoints.

The database stores metadata and references, not storage credentials.

---

# 53. Soft Delete Strategy

The following entities support soft deletion:

```text
Category
Product
ProductVariant
ProductImage
```

Inventory and InventoryTransaction require special treatment.

Inventory transactions should remain historically available and should
not normally be deleted.

Inventory itself should remain available while historical business
records reference the variant.

---

# 54. Index Strategy

Initial indexes should include:

```text
Category
├── PRIMARY KEY (id)
└── UNIQUE (slug)

Product
├── PRIMARY KEY (id)
├── INDEX (vendorId)
├── INDEX (categoryId)
└── UNIQUE (slug)

ProductVariant
├── PRIMARY KEY (id)
├── INDEX (productId)
└── UNIQUE (sku)

ProductImage
├── PRIMARY KEY (id)
├── INDEX (productId)
└── INDEX (variantId)

Inventory
├── PRIMARY KEY (id)
└── UNIQUE (variantId)

InventoryTransaction
├── PRIMARY KEY (id)
├── INDEX (inventoryId, createdAt)
└── INDEX (referenceType, referenceId)
```

Additional indexes should only be introduced when justified by actual
query patterns and performance measurements.

---

# 55. Referential Integrity

The database must enforce valid relationships between:

```text
Product → Vendor
Product → Category
ProductVariant → Product
ProductImage → Product
ProductImage → ProductVariant
Inventory → ProductVariant
InventoryTransaction → Inventory
```

The application layer must additionally enforce business-level
ownership and state rules.

---

# 56. Catalog Business Rules Summary

## Category

* Categories can be hierarchical.
* Root categories have no parent.
* Category slugs are unique.
* Circular category relationships are forbidden.
* Categories support soft deletion.

## Product

* Every product belongs to one vendor.
* Every product belongs to one primary category.
* Product slugs are unique.
* Products have lifecycle states.
* Products can be simple or variable.
* Vendor ownership must be enforced server-side.

## ProductVariant

* Every variant belongs to one product.
* Every variant has a unique SKU.
* Prices are stored as Decimal/Numeric values.
* Currency is stored with the price.
* Variant attributes are stored as JSON.
* A product has at most one active default variant.
* Simple products use one default variant.
* Variable products use multiple variants.

## ProductImage

* Images belong to a product.
* Images may optionally belong to a specific variant.
* Variant images must belong to the same product.
* Image binaries are stored outside PostgreSQL.

## Inventory

* Inventory belongs to one variant.
* `onHand` represents current stock.
* `reserved` represents reserved stock.
* `available = onHand - reserved`.
* `reserved <= onHand`.
* Low-stock threshold is tracked.

## InventoryTransaction

* Transactions are immutable.
* Transactions record stock movements and reservations.
* Manual adjustments should record the responsible user and reason.
* Historical inventory records must be preserved.

---

# 57. Complete Catalog Entity Map

```text
                         ┌──────────────────┐
                         │     Category     │
                         └────────┬─────────┘
                                  │
                                  │ 1:N
                                  ▼
┌──────────────┐          ┌──────────────────┐
│    Vendor    │─────────▶│     Product      │
└──────────────┘   1:N    └────────┬─────────┘
                                   │
                       ┌───────────┼───────────┐
                       │           │           │
                       ▼           ▼           ▼
                ProductVariant  ProductImage  ...
                       │
                       │ 1:1
                       ▼
                  ┌───────────┐
                  │ Inventory │
                  └─────┬─────┘
                        │
                        │ 1:N
                        ▼
              ┌──────────────────────┐
              │ InventoryTransaction │
              └──────────────────────┘
```

---

# 58. Design Decisions

| Decision                                | Reason                                                  |
| --------------------------------------- | ------------------------------------------------------- |
| Product belongs to Vendor               | Enables vendor ownership and data isolation             |
| Product has one primary Category        | Keeps initial catalog structure simple                  |
| Category supports hierarchy             | Required for realistic e-commerce navigation            |
| Product and Variant are separate        | Product is catalog-level; Variant is sellable           |
| Simple products use a default Variant   | Keeps Cart/Order/Inventory logic consistent             |
| SKU belongs to Variant                  | Each sellable configuration needs unique identification |
| SKU is globally unique                  | Simplifies inventory and order processing               |
| Price belongs to Variant                | Variants may have different prices                      |
| Decimal/Numeric for money               | Prevent floating-point precision errors                 |
| Currency stored with price              | Makes monetary values explicit                          |
| Attributes use JSON                     | Supports different category-specific attributes         |
| Inventory belongs to Variant            | Stock must be tracked per sellable unit                 |
| `available` is derived                  | Prevent inconsistent stored values                      |
| Reservation is separate from sale       | Supports safe checkout workflows                        |
| Inventory transactions are immutable    | Preserves an audit trail                                |
| PostgreSQL is inventory source of truth | Provides durable transactional consistency              |
| Redis is not inventory source of truth  | Prevents cache/queue state from becoming authoritative  |
| BullMQ handles asynchronous workflows   | Suitable for expiry and background processing           |
| Product images use external storage     | Keeps binary files out of PostgreSQL                    |
| Soft deletion preserves history         | Historical orders must remain valid                     |

---

# 59. Future Extensions

The following features are intentionally outside the initial Catalog
schema:

```text
ProductCategory
ProductAttributeDefinition
ProductAttributeOption
Warehouse
WarehouseInventory
Multi-location inventory
Batch/Lot tracking
Serial number tracking
Supplier
PurchaseOrder
Advanced pricing
Regional pricing
Multi-currency pricing
Product bundles
Product kits
Digital product inventory
```

These can be introduced as separate domains when the business
requirements justify them.

---

# 60. Implementation Status

```text
Category architecture             APPROVED
Product architecture              APPROVED
ProductVariant architecture       APPROVED
ProductImage architecture         APPROVED
Inventory architecture            APPROVED
InventoryTransaction architecture APPROVED

Relationships                     APPROVED
SKU strategy                      APPROVED
Pricing strategy                  APPROVED
Inventory reservation model       APPROVED
Concurrency requirements          APPROVED
Vendor isolation                  APPROVED

Prisma models                     NOT IMPLEMENTED
Database migration                 NOT CREATED
API implementation                 NOT IMPLEMENTED
Redis integration                  NOT IMPLEMENTED
BullMQ integration                 NOT IMPLEMENTED
Tests                              NOT IMPLEMENTED
```

> This document defines the initial Catalog architecture. Prisma models,
> migrations, services, APIs, Redis workflows, BullMQ jobs, and tests will
> be implemented later after the complete database architecture has been
> finalized.

This document represents the approved Catalog architecture for the
initial production-grade multi-vendor e-commerce implementation.

````
