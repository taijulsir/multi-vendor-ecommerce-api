# Order Database Architecture

## Overview

The Order domain represents a confirmed purchase created from a user's
checkout process.

The Order domain is responsible for:

- Creating the authoritative purchase record
- Supporting multi-vendor orders
- Preserving historical product information
- Preserving historical pricing
- Preserving shipping/billing address snapshots
- Tracking order lifecycle
- Tracking vendor-specific fulfillment lifecycle
- Tracking status history
- Supporting cancellation workflows
- Maintaining references to payment and inventory workflows

The Order domain is separate from the Cart domain.

A Cart represents what the user currently wants to purchase.

An Order represents what the user actually purchased.

---

# 1. Core Order Architecture

The marketplace supports multi-vendor checkout.

A single customer checkout may contain products from multiple vendors.

Therefore the initial architecture uses:

```text
User
 │
 └── MasterOrder
       │
       ├── VendorOrder
       │      ├── OrderItem
       │      └── Vendor fulfillment state
       │
       ├── VendorOrder
       │      ├── OrderItem
       │      └── Vendor fulfillment state
       │
       ├── Billing Address Snapshot
       └── Shipping Address Snapshot
````

Example:

```text
Customer Checkout
       │
       ▼
Master Order #ORD-2026-000001
       │
       ├── Vendor Order A
       │    ├── Product A × 2
       │    └── Product B × 1
       │
       └── Vendor Order B
            └── Product C × 1
```

---

# 2. Why Master Order + Vendor Order

A marketplace checkout may contain products belonging to multiple vendors.

The customer should experience the checkout as one purchase.

However, vendors must independently manage their own fulfillment.

Therefore:

```text
Customer perspective
       ↓
Master Order
```

and:

```text
Vendor perspective
       ↓
Vendor Order
```

This separation allows:

* One customer checkout
* One payment flow
* Multiple vendors
* Vendor-specific fulfillment
* Vendor-specific cancellation
* Vendor-specific shipping
* Vendor-specific earnings
* Vendor-specific order status

---

# 3. MasterOrder

## Purpose

`MasterOrder` represents the complete customer checkout.

It is the top-level order record.

A MasterOrder may contain one or more VendorOrders.

---

# 4. MasterOrder Fields

| Field                     | Type     | Required | Default           | Notes                              |
| ------------------------- | -------- | -------: | ----------------- | ---------------------------------- |
| `id`                      | UUID     |      Yes | Generated         | Primary key                        |
| `orderNumber`             | String   |      Yes | Generated         | Human-readable unique order number |
| `userId`                  | UUID     |      Yes | —                 | FK → User                          |
| `status`                  | Enum     |      Yes | `PENDING`         | Master order lifecycle             |
| `currency`                | String   |      Yes | —                 | Order currency                     |
| `subtotal`                | Decimal  |      Yes | `0`               | Sum before order-level charges     |
| `discountAmount`          | Decimal  |      Yes | `0`               | Total discount                     |
| `shippingAmount`          | Decimal  |      Yes | `0`               | Shipping charge                    |
| `taxAmount`               | Decimal  |      Yes | `0`               | Tax amount                         |
| `serviceFee`              | Decimal  |      Yes | `0`               | Platform/service fee               |
| `totalAmount`             | Decimal  |      Yes | `0`               | Final customer payable amount      |
| `paymentStatus`           | Enum     |      Yes | `PENDING`         | Payment lifecycle                  |
| `shippingAddressSnapshot` | JSON     |      Yes | —                 | Immutable shipping snapshot        |
| `billingAddressSnapshot`  | JSON     |      Yes | —                 | Immutable billing snapshot         |
| `customerNote`            | String   |       No | `null`            | Customer-provided note             |
| `placedAt`                | DateTime |       No | `null`            | Order placement timestamp          |
| `createdAt`               | DateTime |      Yes | Current timestamp |                                    |
| `updatedAt`               | DateTime |      Yes | Auto-updated      |                                    |
| `cancelledAt`             | DateTime |       No | `null`            | Cancellation timestamp             |

---

# 5. Order Number

The database primary key is a UUID.

The customer-facing order identifier is `orderNumber`.

Example:

```text
ORD-2026-000001
ORD-2026-000002
ORD-2026-000003
```

The order number must be unique.

```text
orderNumber → UNIQUE
```

The UUID remains the internal relational identifier.

The human-readable order number is used for:

* Customer support
* Emails
* Invoices
* Admin dashboards
* Vendor communication
* Customer-facing URLs where appropriate

---

# 6. Master Order Status

The initial MasterOrder lifecycle is:

```text
PENDING
CONFIRMED
PROCESSING
PARTIALLY_FULFILLED
FULFILLED
CANCELLED
COMPLETED
```

## PENDING

The order is being created or awaiting required confirmation.

## CONFIRMED

The order has been successfully placed and accepted by the platform.

## PROCESSING

The order is actively being processed.

## PARTIALLY_FULFILLED

At least one VendorOrder has progressed while other VendorOrders
remain incomplete.

## FULFILLED

All fulfillment requirements have been completed.

## CANCELLED

The order has been cancelled according to applicable cancellation rules.

## COMPLETED

The complete purchase lifecycle has finished.

The exact status transition matrix will be enforced by the Order service.

---

# 7. Master Order Status Is Derived Carefully

The MasterOrder status must represent the overall checkout state.

VendorOrders have their own fulfillment states.

Example:

```text
MasterOrder
├── VendorOrder A → SHIPPED
└── VendorOrder B → PROCESSING
```

The MasterOrder should reflect that the complete order is not yet fully
fulfilled.

Therefore the MasterOrder status must not simply be updated independently
without considering its child VendorOrders.

> **Approved (2026-08-22, ADR-3) and implemented (Phase 19, 2026-08-22):**
> `MasterOrder.status` is derived server-side from child `VendorOrder`
> states and is never directly client-settable. All (non-cancelled)
> children `DELIVERED` → `FULFILLED`; some but not all →
> `PARTIALLY_FULFILLED`; every child `CANCELLED` → `CANCELLED`; otherwise
> the least-advanced active child's stage (`PENDING`/`CONFIRMED`/
> `PROCESSING`) — see `src/orders/utils/master-order-status.ts` for the
> full, documented bucket mapping and
> `docs/remaining-architecture-plan.md`'s Architecture Decision Register
> for the approved principle. Recomputed inside the same transaction as
> every `VendorOrder` status write.

---

# 8. VendorOrder

## Purpose

`VendorOrder` represents the portion of a MasterOrder belonging to one
vendor.

Example:

```text
MasterOrder
├── VendorOrder A
│    ├── Item A1
│    └── Item A2
│
└── VendorOrder B
     └── Item B1
```

Each VendorOrder belongs to exactly one Vendor.

---

# 9. VendorOrder Fields

| Field              | Type     | Required | Default           | Notes                                |
| ------------------ | -------- | -------: | ----------------- | ------------------------------------ |
| `id`               | UUID     |      Yes | Generated         | Primary key                          |
| `masterOrderId`    | UUID     |      Yes | —                 | FK → MasterOrder                     |
| `vendorId`         | UUID     |      Yes | —                 | FK → Vendor                          |
| `orderNumber`      | String   |      Yes | Generated         | Vendor-facing order identifier       |
| `status`           | Enum     |      Yes | `PENDING`         | Vendor fulfillment lifecycle         |
| `subtotal`         | Decimal  |      Yes | `0`               | Vendor item subtotal                 |
| `discountAmount`   | Decimal  |      Yes | `0`               | Vendor-level discount                |
| `shippingAmount`   | Decimal  |      Yes | `0`               | Vendor shipping charge               |
| `taxAmount`        | Decimal  |      Yes | `0`               | Vendor tax amount                    |
| `commissionAmount` | Decimal  |      Yes | `0`               | Platform commission                  |
| `vendorNetAmount`  | Decimal  |      Yes | `0`               | Vendor-side amount                   |
| `totalAmount`      | Decimal  |      Yes | `0`               | Customer charge for this VendorOrder |
| `trackingNumber`   | String   |       No | `null`            | Shipment tracking reference          |
| `shippingProvider` | String   |       No | `null`            | Shipping provider                    |
| `shippedAt`        | DateTime |       No | `null`            | Shipment timestamp                   |
| `deliveredAt`      | DateTime |       No | `null`            | Delivery timestamp                   |
| `cancelledAt`      | DateTime |       No | `null`            | Cancellation timestamp               |
| `createdAt`        | DateTime |      Yes | Current timestamp |                                      |
| `updatedAt`        | DateTime |      Yes | Auto-updated      |                                      |

---

# 10. VendorOrder Status

Vendor fulfillment uses a separate lifecycle:

```text
PENDING
CONFIRMED
PROCESSING
READY_TO_SHIP
SHIPPED
DELIVERED
CANCELLED
RETURN_REQUESTED
RETURNED
```

## PENDING

Vendor order has been created but has not yet entered active fulfillment.

## CONFIRMED

Vendor has accepted/confirmed the order.

## PROCESSING

Vendor is preparing the items.

## READY_TO_SHIP

Items are ready for shipment.

## SHIPPED

The vendor has handed the package to the shipping provider.

## DELIVERED

The shipment has been delivered.

## CANCELLED

The VendorOrder has been cancelled.

## RETURN_REQUESTED

A return process has been initiated.

## RETURNED

The return has been completed.

The exact transition rules will be enforced by the Order service.

---

# 11. Vendor Isolation

Every VendorOrder has a direct:

```text
vendorId
```

relationship.

The vendor authorization chain is:

```text
Authenticated User
       ↓
Vendor
       ↓
VendorOrder
```

A vendor must only be able to access VendorOrders belonging to that
vendor.

A vendor must never be able to access another vendor's VendorOrder by
guessing or submitting its ID.

---

# 12. VendorOrder Uniqueness

A vendor should have only one VendorOrder for a given MasterOrder.

Therefore:

```text
UNIQUE(masterOrderId, vendorId)
```

is required.

Example:

```text
MasterOrder A
├── Vendor A → one VendorOrder
├── Vendor B → one VendorOrder
└── Vendor C → one VendorOrder
```

---

# 13. OrderItem

## Purpose

`OrderItem` represents one purchased ProductVariant.

OrderItem is the historical purchase snapshot.

It must preserve the information required to understand the purchase even
if the Product or ProductVariant changes later.

---

# 14. OrderItem Fields

| Field            | Type     | Required | Default           | Notes                             |
| ---------------- | -------- | -------: | ----------------- | --------------------------------- |
| `id`             | UUID     |      Yes | Generated         | Primary key                       |
| `vendorOrderId`  | UUID     |      Yes | —                 | FK → VendorOrder                  |
| `productId`      | UUID     |      Yes | —                 | Original Product reference        |
| `variantId`      | UUID     |      Yes | —                 | Original ProductVariant reference |
| `productName`    | String   |      Yes | —                 | Historical product name           |
| `variantName`    | String   |       No | `null`            | Historical variant label          |
| `sku`            | String   |      Yes | —                 | Historical SKU                    |
| `attributes`     | JSON     |       No | `{}`              | Historical selected attributes    |
| `unitPrice`      | Decimal  |      Yes | —                 | Final unit price                  |
| `quantity`       | Integer  |      Yes | —                 | Purchased quantity                |
| `discountAmount` | Decimal  |      Yes | `0`               | Discount applied to this item     |
| `taxAmount`      | Decimal  |      Yes | `0`               | Tax applied to this item          |
| `totalAmount`    | Decimal  |      Yes | `0`               | Final line total                  |
| `currency`       | String   |      Yes | —                 | Currency                          |
| `createdAt`      | DateTime |      Yes | Current timestamp |                                   |

---

# 15. Why OrderItem Stores Product References and Snapshots

The OrderItem keeps references:

```text
productId
variantId
```

for relational reporting and navigation.

It also stores snapshots:

```text
productName
variantName
sku
attributes
unitPrice
```

because catalog information can change after purchase.

Example:

```text
At purchase:
Product name = "Premium T-Shirt"
SKU = "TS-BLK-M"
Price = 2500
```

Later:

```text
Product name = "Premium Cotton T-Shirt"
Price = 2800
```

The historical order must still show:

```text
Premium T-Shirt
TS-BLK-M
2500
```

Therefore OrderItem snapshots are authoritative for historical order
display.

---

# 16. OrderItem Price

The OrderItem `unitPrice` is the final unit price used during order
creation after applicable pricing rules.

The value must not depend on the current ProductVariant price after the
order has been created.

---

# 17. OrderItem Quantity

Quantity must be a positive integer.

Valid:

```text
1
2
10
```

Invalid:

```text
0
-1
1.5
```

---

# 18. Order Totals

The Order domain must maintain consistent monetary calculations.

Conceptually:

```text
items subtotal
      +
shipping
      +
tax
      +
service fee
      -
discount
      =
total amount
```

The exact formula depends on the final pricing architecture.

The stored total values are snapshots of the final checkout calculation.

---

# 19. Money Representation

All financial values use PostgreSQL exact decimal/numeric types.

Examples:

```text
subtotal
discountAmount
shippingAmount
taxAmount
serviceFee
totalAmount
commissionAmount
vendorNetAmount
unitPrice
```

Prisma will map these values to its Decimal type.

JavaScript floating-point arithmetic must not be used as the authoritative
mechanism for financial calculations.

---

# 20. Currency

The MasterOrder has one canonical currency.

All VendorOrders and OrderItems belonging to that MasterOrder must use the
same currency in the initial architecture.

Example:

```text
MasterOrder
currency = BDT

VendorOrder A
currency = BDT

VendorOrder B
currency = BDT
```

Arbitrary currency mixing within one checkout is not supported in the
initial version.

---

# 21. Shipping Address Snapshot

The order must preserve the shipping address at the time of purchase.

The order must not depend on the user's current profile address.

The snapshot may contain:

```json
{
  "fullName": "Customer Name",
  "phone": "+8801XXXXXXXXX",
  "addressLine1": "House 10, Road 5",
  "addressLine2": null,
  "city": "Dhaka",
  "state": "Dhaka",
  "postalCode": "1207",
  "country": "BD"
}
```

The exact address fields will be finalized with the User/Address domain.

---

# 22. Billing Address Snapshot

The billing address is also preserved as an immutable order snapshot.

Example:

```json
{
  "fullName": "Customer Name",
  "phone": "+8801XXXXXXXXX",
  "addressLine1": "House 10, Road 5",
  "city": "Dhaka",
  "postalCode": "1207",
  "country": "BD"
}
```

The initial architecture stores snapshots as JSON.

If the platform later requires advanced address analytics or normalized
address querying, a dedicated address snapshot model can be introduced.

---

# 23. Why Address Snapshots Are Required

User addresses can change.

Example:

```text
Before order:
Dhaka address

After order:
Chittagong address
```

The historical order must still contain the original delivery address.

Therefore the Order must not simply reference:

```text
User.addressId
```

as the only source of truth.

The order stores the address snapshot used for that purchase.

---

# 24. Customer Note

The MasterOrder may contain an optional:

```text
customerNote
```

Examples:

```text
"Please call before delivery."
"Leave package with reception."
```

This is customer-provided information and must be treated as untrusted
input.

The application layer must validate length and content according to
normal input validation rules.

---

# 25. Payment Status

Payment lifecycle is intentionally separate from order fulfillment
status.

Initial payment states:

```text
PENDING
AUTHORIZED
PAID
FAILED
REFUNDED
PARTIALLY_REFUNDED
```

The Payment domain will own the detailed payment records and gateway
transactions.

The MasterOrder stores the summarized payment state required for order
processing.

---

# 26. Order vs Payment

The Order domain does not contain gateway-specific implementation details.

Conceptually:

```text
MasterOrder
      │
      └── Payment
            ├── PaymentAttempt
            ├── Gateway reference
            └── Transaction details
```

The Payment domain will be designed separately.

The Order only maintains the necessary payment status/reference boundary.

---

# 27. Order Status History

Every meaningful order status change should be recorded.

The system uses an immutable status history.

```text
Order
  │
  └── OrderStatusHistory
```

---

# 28. OrderStatusHistory Fields

| Field           | Type     | Required | Default           | Notes                   |
| --------------- | -------- | -------: | ----------------- | ----------------------- |
| `id`            | UUID     |      Yes | Generated         | Primary key             |
| `masterOrderId` | UUID     |      Yes | —                 | FK → MasterOrder        |
| `fromStatus`    | Enum     |       No | `null`            | Previous status         |
| `toStatus`      | Enum     |      Yes | —                 | New status              |
| `reason`        | String   |       No | `null`            | Transition reason       |
| `note`          | String   |       No | `null`            | Additional information  |
| `changedBy`     | UUID     |       No | `null`            | User/admin/vendor actor |
| `createdAt`     | DateTime |      Yes | Current timestamp | Immutable timestamp     |

---

# 29. VendorOrderStatusHistory

Vendor fulfillment also requires its own status history.

```text
VendorOrder
      │
      └── VendorOrderStatusHistory
```

Fields:

| Field           | Type     | Required | Notes                  |
| --------------- | -------- | -------: | ---------------------- |
| `id`            | UUID     |      Yes | Primary key            |
| `vendorOrderId` | UUID     |      Yes | FK → VendorOrder       |
| `fromStatus`    | Enum     |       No | Previous status        |
| `toStatus`      | Enum     |      Yes | New status             |
| `reason`        | String   |       No | Transition reason      |
| `note`          | String   |       No | Additional information |
| `changedBy`     | UUID     |       No | Actor                  |
| `createdAt`     | DateTime |      Yes | Immutable timestamp    |

This allows the platform to distinguish:

```text
MasterOrder lifecycle
```

from:

```text
Vendor fulfillment lifecycle
```

---

# 30. Status History Immutability

Status history records should be treated as immutable.

Existing history records should not normally be updated or deleted.

If a correction is necessary, a new status/history event should be
created.

This preserves an audit trail.

---

# 31. Cancellation

Cancellation is state-dependent.

Not every order status can necessarily be cancelled.

The service layer must enforce a transition matrix.

Example:

```text
PENDING       → CANCELLED
CONFIRMED     → CANCELLED
PROCESSING    → depends on business rules
SHIPPED       → normally not directly cancelled
DELIVERED     → return/refund flow
COMPLETED     → return/refund flow
```

The exact cancellation rules will be finalized together with Payment,
Refund, and Fulfillment domains.

> **Approved (2026-08-22, ADR-2) and implemented (Phase 19, 2026-08-22):**
> the in-scope MVP progression is `PENDING → CONFIRMED → PROCESSING →
> READY_TO_SHIP → SHIPPED → DELIVERED`, with cancellation approved and
> implemented only for `PENDING`/`CONFIRMED` (vendor-initiated,
> `PATCH /api/vendor-orders/:vendorOrderId/status`). `PROCESSING →
> CANCELLED`, `SHIPPED → CANCELLED`, and any return/refund-driven
> fulfillment flow remain explicitly **excluded from this MVP** by
> decision, not merely unimplemented. See
> `docs/remaining-architecture-plan.md`'s Architecture Decision Register.
> **Customer-initiated cancellation was not implemented** — re-reading
> §48 ("Security and Authorization") directly during this phase found no
> textual basis for a customer mutation capability; §48 lists only
> viewing rights for customers and "Update fulfillment-related state"
> only for vendors. See this phase's final report for the full reasoning.

---

# 32. Vendor-Specific Cancellation

A multi-vendor order may have partial cancellation.

Example:

```text
MasterOrder
├── VendorOrder A → DELIVERED
└── VendorOrder B → CANCELLED
```

The MasterOrder must remain able to represent the overall lifecycle.

This is one of the primary reasons MasterOrder and VendorOrder are
separate entities.

---

# 33. Inventory Relationship

The Order domain does not directly own Inventory.

The relationship is:

```text
OrderItem
   ↓
ProductVariant
   ↓
Inventory
```

During checkout:

```text
Cart
 ↓
Validate inventory
 ↓
Reserve inventory
 ↓
Create order
```

After successful order/payment progression, the Inventory domain records
the appropriate stock movement.

The exact reservation and finalization sequence will be defined during
checkout and Payment architecture.

---

# 34. Order Creation Transaction

Order creation is transaction-sensitive.

The core checkout process must ensure that the following operations do not
leave the system in an inconsistent state:

```text
Validate Cart
Validate Pricing
Validate Inventory
Create MasterOrder
Create VendorOrders
Create OrderItems
Create necessary inventory reservation records
Create initial status history
Convert Cart
```

The exact transaction boundary will be finalized during implementation.

Payment gateway calls must not be treated as normal database
transactions because external network calls cannot participate directly
in PostgreSQL transactions.

---

# 35. Idempotency

Order creation must support idempotency.

Duplicate client requests must not create duplicate orders.

Example:

```text
Client request
   ↓
Checkout
   ↓
Network timeout
   ↓
Client retries
```

The retry must not produce:

```text
Order A
Order B
```

for the same checkout operation.

An idempotency mechanism will be implemented at the application/API
layer.

The exact `idempotencyKey` storage model will be finalized during
checkout/payment implementation.

---

# 36. Order Number Generation

Order numbers must be unique and collision-safe.

The system must not rely on:

```text
COUNT(*) + 1
```

because concurrent requests can generate duplicates.

A database-backed sequence, atomic counter, or equivalent collision-safe
strategy should be used.

The exact implementation will be selected during Prisma/database
implementation.

---

# 37. Order Creation From Cart

The conceptual flow is:

```text
User
 ↓
Active Cart
 ↓
Checkout Request
 ↓
Validate Cart
 ↓
Validate Product/Variant
 ↓
Validate Vendor
 ↓
Validate Current Prices
 ↓
Validate Currency
 ↓
Validate Inventory
 ↓
Reserve Inventory
 ↓
Create MasterOrder
 ↓
Group items by Vendor
 ↓
Create VendorOrders
 ↓
Create OrderItems
 ↓
Create Status History
 ↓
Convert Cart
 ↓
Continue Payment Flow
```

The exact ordering of inventory reservation, order persistence, and
payment initialization will be finalized in the Payment/Checkout design.

---

# 38. Multi-Vendor Grouping

Example cart:

```text
Cart
├── Vendor A
│    ├── Variant A1 × 2
│    └── Variant A2 × 1
│
└── Vendor B
     └── Variant B1 × 3
```

Order result:

```text
MasterOrder
├── VendorOrder A
│    ├── OrderItem A1
│    └── OrderItem A2
│
└── VendorOrder B
     └── OrderItem B1
```

The customer sees one checkout/order.

Each vendor manages their own VendorOrder.

---

# 39. Shipping Information

VendorOrder stores shipment-related fields because each vendor may have
an independent shipment.

Initial fields include:

```text
trackingNumber
shippingProvider
shippedAt
deliveredAt
```

Future shipment architecture may introduce a dedicated:

```text
Shipment
```

entity when multiple packages, split shipments, or carrier integrations
become necessary.

---

# 40. Vendor Financial Fields

VendorOrder contains financial snapshot fields:

```text
commissionAmount
vendorNetAmount
```

These values are historical order-level calculations.

The detailed Wallet/Commission domain will be responsible for:

* Vendor earnings
* Platform commission
* Transaction fees
* Wallet credits
* Wallet debits
* Settlement
* Refund adjustments

The VendorOrder stores enough information to understand the financial
state of the purchase without replacing the Wallet/Commission domain.

---

# 41. Order Totals and Vendor Totals

MasterOrder represents customer-level totals.

VendorOrder represents vendor-level totals.

Example:

```text
MasterOrder total = 5000 BDT

Vendor A total = 3000 BDT
Vendor B total = 2000 BDT
```

The sum of applicable VendorOrder components must reconcile with the
MasterOrder calculation according to the final fee/shipping allocation
rules.

The exact allocation of:

* shipping
* discount
* tax
* service fee

will be finalized in the Pricing/Payment architecture.

---

# 42. Order Data Integrity

The system must maintain consistency between:

```text
MasterOrder
VendorOrder
OrderItem
```

Rules include:

* Every VendorOrder belongs to exactly one MasterOrder.
* Every VendorOrder belongs to exactly one Vendor.
* Every OrderItem belongs to exactly one VendorOrder.
* Every OrderItem references one ProductVariant.
* The ProductVariant must belong to the product referenced by the
  OrderItem where applicable.
* Vendor ownership must remain consistent.
* Currency must remain consistent within the initial checkout model.

---

# 43. Vendor Ownership Integrity

An OrderItem ultimately belongs to a vendor through:

```text
OrderItem
   ↓
VendorOrder
   ↓
Vendor
```

The referenced ProductVariant also belongs to:

```text
ProductVariant
   ↓
Product
   ↓
Vendor
```

These ownership relationships must agree.

The system must prevent an inconsistent state where:

```text
VendorOrder.vendorId = Vendor A
```

but the OrderItem's Product belongs to:

```text
Vendor B
```

This must be enforced through service-layer validation and transaction
boundaries.

---

# 44. Historical Data Principle

The Order domain is a historical business record.

Therefore order data must remain understandable even when current catalog
data changes.

Historical snapshots include:

```text
Product name
Variant name
SKU
Variant attributes
Unit price
Quantity
Discount
Tax
Currency
Shipping address
Billing address
```

Catalog changes must not rewrite these historical values.

---

# 45. Soft Delete Strategy

Orders must never be physically deleted as part of normal business
operations.

VendorOrders and OrderItems are also historical records.

Cancellation is represented by status rather than deletion.

Status history must remain available.

Payment and financial records must also remain preserved according to
their own retention requirements.

---

# 46. Index Strategy

Initial indexes should include:

```text
MasterOrder
├── PRIMARY KEY (id)
├── UNIQUE (orderNumber)
├── INDEX (userId)
├── INDEX (status)
├── INDEX (paymentStatus)
└── INDEX (createdAt)

VendorOrder
├── PRIMARY KEY (id)
├── INDEX (masterOrderId)
├── INDEX (vendorId)
├── INDEX (status)
└── UNIQUE (masterOrderId, vendorId)

OrderItem
├── PRIMARY KEY (id)
├── INDEX (vendorOrderId)
├── INDEX (productId)
└── INDEX (variantId)

OrderStatusHistory
├── PRIMARY KEY (id)
├── INDEX (masterOrderId, createdAt)
└── INDEX (changedBy)

VendorOrderStatusHistory
├── PRIMARY KEY (id)
├── INDEX (vendorOrderId, createdAt)
└── INDEX (changedBy)
```

Additional indexes should be introduced only when justified by actual
query patterns.

---

# 47. Referential Integrity

The database must enforce valid relationships:

```text
MasterOrder → User
VendorOrder → MasterOrder
VendorOrder → Vendor
OrderItem → VendorOrder
OrderItem → Product
OrderItem → ProductVariant
OrderStatusHistory → MasterOrder
VendorOrderStatusHistory → VendorOrder
```

Application-level validation must enforce business ownership and
transition rules.

---

# 48. Security and Authorization

Customers may:

* View their own MasterOrders
* View their own VendorOrders through their orders
* View their own OrderItems

Vendors may:

* View VendorOrders belonging to themselves
* Update fulfillment-related state according to permissions
* Access only their own financial/order information

Admins may have broader access according to RBAC permissions.

No endpoint may trust a client-provided `userId` or `vendorId` as the sole
authorization mechanism.

Ownership must be resolved from authenticated identity and server-side
relationships.

---

# 49. Order Status Transition Principle

Order statuses must not be changed arbitrarily.

The service layer should implement an explicit state transition matrix.

Conceptually:

```text
PENDING
   │
   ├── CONFIRMED
   └── CANCELLED

CONFIRMED
   │
   ├── PROCESSING
   └── CANCELLED

PROCESSING
   │
   ├── PARTIALLY_FULFILLED
   ├── FULFILLED
   └── CANCELLED (if allowed)

FULFILLED
   │
   └── COMPLETED
```

The exact transition graph will be finalized after Payment, Fulfillment,
and Refund requirements are documented.

> **Approved (2026-08-22, ADR-2/ADR-3):** the graph above is narrowed —
> `PROCESSING → CANCELLED` and any `* → COMPLETED` trigger are not part
> of this MVP. See `docs/database/order.md` §31's update note and
> `docs/remaining-architecture-plan.md`'s Architecture Decision Register
> for the full record. Not yet implemented.

---

# 50. Order Status History as Audit Trail

For every meaningful state transition:

```text
Old State
   ↓
New State
   ↓
History Record
```

Example:

```text
PENDING
   ↓
CONFIRMED

OrderStatusHistory:
fromStatus = PENDING
toStatus   = CONFIRMED
changedBy  = system/admin/user
```

This makes the order lifecycle traceable.

---

# 51. Async Processing

Some order operations may later be processed asynchronously.

Potential BullMQ jobs include:

```text
Order confirmation notification
Vendor notification
Inventory reservation expiration
Shipment tracking synchronization
Delivery notification
Post-order processing
Review eligibility generation
Financial settlement
```

The database remains the source of truth.

BullMQ is used for asynchronous work and retries, not as a replacement
for persistent order state.

---

# 52. Redis Usage

Redis may support:

* Idempotency state
* Short-lived checkout coordination
* Caching
* Distributed coordination where appropriate
* Rate limiting

Redis must not become the authoritative source of Order state.

PostgreSQL remains authoritative.

---

# 53. Order and Cart Conversion

When an order is successfully created:

```text
Cart
  ↓
CONVERTED
```

The Cart is not the source of historical order information.

The Order domain creates independent historical snapshots.

Therefore future Cart changes do not affect the existing Order.

---

# 54. Order Domain Boundaries

The Order domain depends conceptually on:

```text
User
Vendor
Product
ProductVariant
Inventory
Cart
```

The Order domain will integrate with:

```text
Payment
Refund
Wallet
Commission
Shipment
Notification
Review
```

These domains should remain separate rather than placing all business
logic into the Order module.

---

# 55. Future Extensions

The following are intentionally outside the initial Order schema:

```text
Shipment
ShipmentPackage
CarrierIntegration
ReturnRequest
ReturnItem
Refund
Exchange
Invoice
TaxBreakdown
Payment
PaymentAttempt
CouponAllocation
PromotionSnapshot
Advanced Order Notes
Fraud Detection
Dispute
Delivery Slot
Warehouse Fulfillment
Partial Shipment
Split Shipment
```

These will be introduced as separate domains where required.

---

# 56. Complete Order Entity Map

```text
                           ┌──────────────┐
                           │     User     │
                           └──────┬───────┘
                                  │
                                  │ 1:N
                                  ▼
                         ┌─────────────────┐
                         │   MasterOrder   │
                         ├─────────────────┤
                         │ orderNumber     │
                         │ status          │
                         │ paymentStatus   │
                         │ totals          │
                         │ addressSnapshot │
                         └────────┬────────┘
                                  │
                                  │ 1:N
                                  ▼
                         ┌─────────────────┐
                         │   VendorOrder   │◀──── Vendor
                         ├─────────────────┤
                         │ orderNumber     │
                         │ status          │
                         │ totals          │
                         │ tracking        │
                         └────────┬────────┘
                                  │
                                  │ 1:N
                                  ▼
                            ┌────────────┐
                            │ OrderItem  │
                            ├────────────┤
                            │ productId  │
                            │ variantId  │
                            │ SKU        │
                            │ snapshots  │
                            │ price      │
                            │ quantity   │
                            └────────────┘

MasterOrder
    │
    └── OrderStatusHistory

VendorOrder
    │
    └── VendorOrderStatusHistory
```

---

# 57. Design Decisions

| Decision                                        | Reason                                                    |
| ----------------------------------------------- | --------------------------------------------------------- |
| MasterOrder + VendorOrder                       | Supports multi-vendor marketplace checkout                |
| One customer checkout                           | Provides simple customer experience                       |
| VendorOrder per vendor                          | Enables independent fulfillment                           |
| Unique `(masterOrderId, vendorId)`              | Prevents duplicate vendor orders                          |
| OrderItem references ProductVariant             | Variant is the actual sellable unit                       |
| OrderItem stores historical snapshots           | Catalog changes must not alter historical orders          |
| OrderNumber is separate from UUID               | Human-friendly order identification                       |
| Decimal/Numeric for money                       | Prevents financial precision errors                       |
| Address stored as snapshot                      | User address can change after purchase                    |
| Payment status separate from fulfillment status | Payment and fulfillment have different lifecycles         |
| Status history is immutable                     | Preserves complete lifecycle audit trail                  |
| Orders are never normally deleted               | Orders are permanent business records                     |
| Vendor authorization through VendorOrder        | Prevents cross-vendor access                              |
| Inventory remains separate                      | Keeps domain boundaries clear                             |
| Cart converts into Order                        | Cart is temporary intent; Order is authoritative purchase |
| Idempotency is required                         | Prevents duplicate orders during retries                  |
| PostgreSQL remains source of truth              | Ensures durable transactional consistency                 |
| Redis is supporting infrastructure              | Prevents cache state from becoming authoritative          |
| BullMQ handles asynchronous workflows           | Supports retries and background processing                |

---

# 58. Implementation Status

```text
MasterOrder architecture              APPROVED
VendorOrder architecture              APPROVED
OrderItem architecture                APPROVED
Address snapshot strategy             APPROVED
Pricing snapshot strategy             APPROVED
Status architecture                   APPROVED
Status history architecture           APPROVED
Multi-vendor checkout model           APPROVED
Vendor isolation model                APPROVED
Idempotency requirement               APPROVED
Concurrency requirements              APPROVED

Prisma models                         IMPLEMENTED
Database migration                    CREATED
API implementation                    PARTIALLY IMPLEMENTED (Phase 13 checkout + Phase 14 viewing + Phase 19 fulfillment lifecycle)
Payment integration                   NOT IMPLEMENTED
Refund integration                    NOT IMPLEMENTED
Redis integration                     NOT IMPLEMENTED
BullMQ integration                    NOT IMPLEMENTED
Tests                                 IMPLEMENTED (Phases 13–14, 18–19)
```

> Phase 13 implemented `POST /api/checkout` — Cart → MasterOrder +
> VendorOrder(s) + OrderItem(s) creation, exactly following the §37 flow
> (validate cart/product/variant/vendor/price/currency → reserve
> inventory → create the order structure → record initial status history
> → convert the cart). Order *viewing/management* (a customer or vendor
> retrieving an already-created order, status transitions beyond the
> initial PENDING, cancellation) remains unimplemented — this phase only
> covers order *creation*. No Payment/PaymentAttempt record is created
> (`MasterOrder.paymentStatus` keeps its schema default, PENDING);
> `docs/database/payment-refund.md`'s own Implementation Status still
> marks Payment APIs as NOT IMPLEMENTED, and `Payment.provider` has no
> configured gateway to supply it. Likewise no Commission/WalletTransaction
> is created — `VendorOrder.commissionAmount`/`vendorNetAmount` keep their
> schema default (0), since no commission rate exists anywhere in the
> persisted data model and `docs/database/wallet-commission.md`'s
> Commission service is also NOT IMPLEMENTED. No coupon/discount is
> accepted (`docs/database/promotion.md`'s entire domain is NOT
> IMPLEMENTED). `shippingAmount`/`taxAmount`/`serviceFee` stay at 0 — no
> calculation rule for either is documented anywhere in the source
> documents. §36's order-number requirement ("not `COUNT(*)+1`") is met
> without a Postgres sequence: a 48-bit cryptographically random suffix
> plus the existing `orderNumber` `UNIQUE` constraint, matching this
> codebase's established pattern for `RefreshToken`/slugs — see
> `src/orders/utils/order-number.ts`. §35's idempotency requirement is
> met narrowly: the atomic `Cart.status: ACTIVE → CONVERTED` transition
> (guarded inside the same transaction as order creation) makes a
> retried/concurrent checkout against the *same* cart fail rather than
> create a second order; no separate idempotency-key table/header exists
> (none is implemented in this codebase, and the source documents
> themselves say the exact storage model is still "to be finalized").

> Phase 14 implemented order *viewing* — §48's "Customers may view their
> own MasterOrders... Vendors may view VendorOrders belonging to
> themselves... Admins may have broader access": `GET /api/orders`,
> `GET /api/orders/:masterOrderId` (customer, own MasterOrders + nested
> VendorOrders/OrderItems, ADMIN bypass), `GET /api/vendor-orders`,
> `GET /api/vendor-orders/:vendorOrderId` (vendor, own VendorOrders,
> ADMIN bypass via a new `VendorOrderOwnershipGuard` mirroring the
> existing Shop/Product ownership guards). The vendor-facing view
> includes `commissionAmount`/`vendorNetAmount` (their own financial
> data, currently always 0 — no commission is calculated anywhere yet);
> the customer-facing view excludes both fields, matching this
> codebase's existing response-shaping convention. Still unimplemented:
> fulfillment status transitions/updates (§49's transition matrix is
> explicitly not finalized in this document), cancellation, and any
> admin "view all orders" listing beyond the single-resource ADMIN
> bypass.

> Phase 18 added no application code — it added a dedicated e2e proof
> (`test/checkout.e2e-spec.ts`, `Concurrency (Phase 18)`) that §34's
> "Order Creation Transaction" and §35's "Idempotency" requirements
> actually hold under genuinely concurrent requests, not just sequential
> ones: two simultaneous `POST /api/checkout` calls against the same
> active cart are verified, directly against the database, to always
> produce exactly one `MasterOrder`/`VendorOrder`/`OrderItem` and exactly
> one inventory reservation — never two. Confirms the existing Phase 13
> design; nothing about it changed.

> Phase 19 implemented the VendorOrder fulfillment lifecycle
> (`PATCH /api/vendor-orders/:vendorOrderId/status`, ADR-2) and
> MasterOrder status derivation (ADR-3) — see §7 and §31's update notes
> above for the exact implemented transition matrix and derivation
> formula. Vendor-initiated only: ownership enforced by the existing
> `VendorOrderOwnershipGuard` (no new authorization mechanism), ADMIN
> bypass preserved unchanged. Every transition is atomic with its
> `VendorOrderStatusHistory` row and any resulting `MasterOrder`/
> `OrderStatusHistory` write (one `$transaction`, the same pattern
> `CheckoutService` already established) — proven under genuine
> concurrency the same way Phase 18 proved checkout's guard. Does not
> touch `MasterOrder.paymentStatus` (Phase 15's concern), does not touch
> `Inventory` (Phase 13's reservation is untouched), and does not
> implement customer-initiated cancellation, `RETURN_REQUESTED`/
> `RETURNED`, or any `MasterOrderStatus.COMPLETED` trigger — all remain
> out of scope exactly as ADR-2 excludes them.

The Order domain is the authoritative representation of completed
purchases and must preserve sufficient historical information to remain
correct independently of future Catalog, User, Vendor, or Cart changes.

````
