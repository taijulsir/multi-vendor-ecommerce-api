# Wallet and Commission Database Architecture

## Overview

The Wallet and Commission domain manages the internal financial ledger
between the marketplace platform and vendors.

This domain is responsible for:

- Vendor wallet accounts
- Wallet balances
- Credit transactions
- Debit transactions
- Platform commission
- Transaction fees
- Vendor earnings
- Pending earnings
- Available earnings
- Refund-related financial adjustments
- Settlement tracking
- Financial ledger history
- Balance consistency
- Vendor-level financial reporting

The Wallet and Commission domain is separate from:

- Order
- Payment
- Refund
- Vendor
- Product
- Inventory

These domains communicate through well-defined financial events and
transaction boundaries.

---

# 1. High-Level Architecture

The core relationship is:

```text
Vendor
  │
  └── Wallet
        │
        └── WalletTransaction

Order
  │
  └── VendorOrder
        │
        ├── Commission
        │
        └── Vendor Earnings
````

Conceptually:

```text
Customer Payment
       │
       ▼
   MasterOrder
       │
       ▼
   VendorOrder
       │
       ├── Gross Amount
       ├── Platform Commission
       ├── Transaction Fee
       └── Vendor Net Earnings
                    │
                    ▼
              Vendor Wallet
                    │
                    ▼
          Wallet Transaction Ledger
```

---

# 2. Financial Ledger Principle

The wallet system follows a double-entry-inspired ledger principle.

The current wallet balance is useful for fast access, but the transaction
ledger remains the historical financial record.

Conceptually:

```text
Wallet
  │
  ├── Current Balance
  │
  └── Immutable Transactions
```

The system must be able to answer:

```text
Why is this vendor's balance 25,000 BDT?
```

by examining the wallet transaction history.

---

# 3. Wallet

## Purpose

`Wallet` represents the internal financial account belonging to a vendor.

A vendor has one primary wallet in the initial architecture.

---

# 4. Wallet Fields

| Field              | Type     | Required | Default           | Notes                       |
| ------------------ | -------- | -------: | ----------------- | --------------------------- |
| `id`               | UUID     |      Yes | Generated         | Primary key                 |
| `vendorId`         | UUID     |      Yes | —                 | FK → Vendor                 |
| `currency`         | String   |      Yes | —                 | Wallet currency             |
| `balance`          | Decimal  |      Yes | `0`               | Current total balance       |
| `availableBalance` | Decimal  |      Yes | `0`               | Balance currently available |
| `pendingBalance`   | Decimal  |      Yes | `0`               | Earnings not yet released   |
| `status`           | Enum     |      Yes | `ACTIVE`          | Wallet lifecycle            |
| `createdAt`        | DateTime |      Yes | Current timestamp |                             |
| `updatedAt`        | DateTime |      Yes | Auto-updated      |                             |

---

# 5. Wallet Ownership

The ownership chain is:

```text
Authenticated User
       ↓
Vendor
       ↓
Wallet
```

A vendor must only be able to access their own wallet.

Wallet access must never be authorized solely from a client-provided
`vendorId`.

The server must resolve vendor identity from authenticated context.

---

# 6. One Wallet Per Vendor

The initial architecture supports one primary wallet per vendor.

Constraint:

```text
UNIQUE(vendorId)
```

This keeps the initial financial architecture simple.

If multi-currency wallets are introduced later, the constraint can be
extended to:

```text
UNIQUE(vendorId, currency)
```

---

# 7. Wallet Status

Initial wallet statuses:

```text
ACTIVE
FROZEN
SUSPENDED
CLOSED
```

## ACTIVE

Normal wallet operations are allowed.

## FROZEN

Wallet operations are temporarily restricted.

## SUSPENDED

Wallet operations are blocked due to an administrative or financial
restriction.

## CLOSED

The wallet is permanently closed for new financial activity.

Historical transactions remain available.

---

# 8. Balance Types

The wallet maintains three conceptual balances:

```text
balance
availableBalance
pendingBalance
```

The intended relationship is:

```text
balance = availableBalance + pendingBalance
```

Example:

```text
balance          = 10000
availableBalance = 7000
pendingBalance   = 3000
```

Therefore:

```text
10000 = 7000 + 3000
```

These values must remain internally consistent.

---

# 9. Available Balance

`availableBalance` represents funds that the vendor is currently allowed
to use or withdraw according to platform rules.

Example:

```text
availableBalance = 7000
```

The vendor may be able to request a withdrawal of up to the available
amount, subject to withdrawal policies.

---

# 10. Pending Balance

`pendingBalance` represents earnings that have been recognized but are
not yet available for withdrawal.

Examples:

* Recently delivered orders awaiting settlement period
* Payment funds awaiting confirmation
* Orders within a refund/cancellation window
* Platform-defined holding period

Example:

```text
Vendor Earnings
       │
       ▼
Pending Balance
       │
       ▼
Settlement
       │
       ▼
Available Balance
```

The exact release rules are business-policy decisions.

---

# 11. WalletTransaction

## Purpose

`WalletTransaction` represents an immutable financial movement in a
vendor wallet.

Examples:

```text
SALE_CREDIT
COMMISSION_DEBIT
REFUND_DEBIT
ADJUSTMENT_CREDIT
ADJUSTMENT_DEBIT
WITHDRAWAL_DEBIT
SETTLEMENT_CREDIT
```

The transaction ledger is the historical financial record.

---

# 12. WalletTransaction Fields

| Field           | Type        | Required | Default           | Notes                             |
| --------------- | ----------- | -------: | ----------------- | --------------------------------- |
| `id`            | UUID        |      Yes | Generated         | Primary key                       |
| `walletId`      | UUID        |      Yes | —                 | FK → Wallet                       |
| `type`          | Enum        |      Yes | —                 | Transaction type                  |
| `direction`     | Enum        |      Yes | —                 | CREDIT or DEBIT                   |
| `amount`        | Decimal     |      Yes | —                 | Transaction amount                |
| `currency`      | String      |      Yes | —                 | Currency                          |
| `balanceBefore` | Decimal     |      Yes | —                 | Balance before transaction        |
| `balanceAfter`  | Decimal     |      Yes | —                 | Balance after transaction         |
| `referenceType` | String      |       No | `null`            | Related domain/entity type        |
| `referenceId`   | UUID/String |       No | `null`            | Related entity identifier         |
| `description`   | String      |       No | `null`            | Human-readable explanation        |
| `metadata`      | JSON        |       No | `{}`              | Additional non-sensitive metadata |
| `createdAt`     | DateTime    |      Yes | Current timestamp | Immutable timestamp               |

---

# 13. Transaction Direction

Initial directions:

```text
CREDIT
DEBIT
```

## CREDIT

Adds funds to the wallet.

Example:

```text
Vendor earnings:
+5000 BDT
```

## DEBIT

Removes funds from the wallet.

Example:

```text
Refund adjustment:
-1000 BDT
```

---

# 14. Wallet Transaction Types

Initial transaction types:

```text
SALE_CREDIT
SETTLEMENT_CREDIT
COMMISSION_DEBIT
TRANSACTION_FEE_DEBIT
REFUND_DEBIT
WITHDRAWAL_DEBIT
ADJUSTMENT_CREDIT
ADJUSTMENT_DEBIT
REVERSAL_CREDIT
REVERSAL_DEBIT
```

The list can be extended as new financial workflows are introduced.

---

# 15. SALE_CREDIT

Represents vendor earnings generated by a successful sale.

Example:

```text
Vendor Order:
5000 BDT

Commission:
500 BDT

Transaction fee:
100 BDT

Vendor net:
4400 BDT
```

The applicable vendor earning may eventually result in:

```text
SALE_CREDIT
+4400
```

The exact timing of credit depends on the settlement policy.

---

# 16. COMMISSION_DEBIT

Represents platform commission deducted from vendor earnings.

Example:

```text
Gross:
5000

Commission:
500

Vendor:
-500 commission
```

The commission amount must be linked to the appropriate business
reference.

---

# 17. TRANSACTION_FEE_DEBIT

Represents a transaction/payment-related fee charged to the vendor.

Example:

```text
Transaction fee:
100 BDT
```

This should be separate from platform commission because they have
different business meanings.

---

# 18. REFUND_DEBIT

Represents a financial deduction from vendor earnings resulting from an
eligible refund.

Example:

```text
Original vendor earning:
4400

Refund allocation:
1000

Wallet adjustment:
-1000
```

The exact refund allocation rules will be defined based on the refund and
commission policy.

---

# 19. WITHDRAWAL_DEBIT

Represents a vendor withdrawal from the platform.

Example:

```text
Available balance:
10000

Withdrawal:
3000

New available balance:
7000
```

The withdrawal domain will be responsible for detailed withdrawal
processing.

---

# 20. ADJUSTMENT

Administrative corrections use explicit adjustment transactions.

Examples:

```text
ADJUSTMENT_CREDIT
ADJUSTMENT_DEBIT
```

Every manual adjustment should include:

```text
reference
description
actor
reason
```

where appropriate.

Financial adjustments must never silently modify a wallet balance without
creating a ledger record.

---

# 21. Reversal

If a previous financial transaction must be corrected, the system should
prefer a compensating transaction rather than modifying or deleting the
original transaction.

Example:

```text
Original:
ADJUSTMENT_DEBIT
-500

Correction:
REVERSAL_CREDIT
+500
```

This preserves the historical ledger.

---

# 22. Immutable Ledger

Wallet transactions are immutable.

The system must not normally:

* Update historical transaction amounts
* Delete historical transactions
* Rewrite financial history

If a correction is required:

```text
Existing transaction
        ↓
New compensating transaction
```

This provides an auditable financial trail.

---

# 23. Balance Snapshot

Every WalletTransaction stores:

```text
balanceBefore
balanceAfter
```

Example:

```text
Transaction:
SALE_CREDIT +5000

balanceBefore = 10000
balanceAfter  = 15000
```

This makes transaction history easier to audit and debug.

The values must be written atomically with the wallet update.

---

# 24. Atomic Wallet Update

Wallet balance updates must be transaction-safe.

Conceptually:

```text
BEGIN TRANSACTION

1. Lock wallet row
2. Read current balance
3. Validate financial operation
4. Calculate new balance
5. Update wallet
6. Insert WalletTransaction
7. Commit

```

The wallet update and transaction insertion must succeed or fail together.

---

# 25. Concurrency

Wallet operations are highly concurrency-sensitive.

Example:

```text
Current balance = 10000

Request A → debit 6000
Request B → debit 5000
```

Both must not successfully withdraw against the same balance.

Therefore wallet mutations must use:

* Database transactions
* Appropriate row-level locking
* Atomic balance validation
* Idempotency

Redis should not be the authoritative mechanism for wallet balance
consistency.

---

# 26. Wallet Balance Invariants

The initial system must maintain:

```text
balance >= 0
availableBalance >= 0
pendingBalance >= 0
```

and:

```text
balance = availableBalance + pendingBalance
```

unless a future financial model explicitly introduces additional balance
states.

---

# 27. Negative Balance

The initial wallet architecture does not allow negative vendor balances.

Therefore:

```text
availableBalance >= 0
```

must be enforced.

If future business rules require vendor debt or negative balances, the
financial model must explicitly introduce that capability.

It must not happen accidentally because of refund or commission logic.

---

# 28. Commission

## Purpose

`Commission` records the platform fee charged against a VendorOrder.

Commission is separate from the wallet transaction ledger.

This allows the system to distinguish:

```text
Business calculation
```

from:

```text
Financial movement
```

---

# 29. Commission Fields

| Field              | Type     | Required | Default           | Notes                       |
| ------------------ | -------- | -------: | ----------------- | --------------------------- |
| `id`               | UUID     |      Yes | Generated         | Primary key                 |
| `vendorOrderId`    | UUID     |      Yes | —                 | FK → VendorOrder            |
| `vendorId`         | UUID     |      Yes | —                 | FK → Vendor                 |
| `type`             | Enum     |      Yes | `PERCENTAGE`      | Commission calculation type |
| `rate`             | Decimal  |       No | `null`            | Commission rate             |
| `grossAmount`      | Decimal  |      Yes | —                 | Base amount                 |
| `commissionAmount` | Decimal  |      Yes | —                 | Calculated commission       |
| `currency`         | String   |      Yes | —                 | Currency                    |
| `status`           | Enum     |      Yes | `PENDING`         | Commission lifecycle        |
| `createdAt`        | DateTime |      Yes | Current timestamp |                             |
| `updatedAt`        | DateTime |      Yes | Auto-updated      |                             |

---

# 30. Commission Type

Initial types:

```text
PERCENTAGE
FIXED
```

## PERCENTAGE

Example:

```text
Gross amount = 10000
Commission rate = 10%

Commission = 1000
```

## FIXED

Example:

```text
Commission = 100 BDT
```

The system may later support hybrid or tiered commission models.

---

# 31. Commission Status

Initial statuses:

```text
PENDING
APPLIED
REVERSED
CANCELLED
```

## PENDING

Commission calculation exists but has not yet been finalized.

## APPLIED

Commission has been applied to the vendor financial calculation.

## REVERSED

The commission was reversed due to a refund, cancellation, or financial
correction.

## CANCELLED

Commission was invalidated before becoming financially effective.

---

# 32. Commission Calculation

Example:

```text
Vendor Order Gross:
10000 BDT

Commission:
10%

Commission Amount:
1000 BDT

Vendor Gross After Commission:
9000 BDT
```

The exact calculation base must be explicitly defined.

Possible bases include:

```text
Item subtotal
Item subtotal after discount
Vendor order total
Product-specific amount
```

The initial implementation should select one canonical calculation base
and document it in the Pricing/Commission service.

---

# 33. Commission Snapshot Principle

Once a VendorOrder is finalized, the applied commission values should be
treated as historical snapshots.

Later changes to the vendor's commission configuration must not rewrite
historical orders.

Example:

```text
Order 1:
Commission = 10%

Later vendor configuration:
Commission = 12%

Order 1 remains:
Commission = 10%
```

---

# 34. Vendor Net Earnings

Conceptually:

```text
Vendor Net
=
Gross Amount
- Commission
- Applicable Transaction Fees
- Other Applicable Deductions
```

Example:

```text
Gross                 = 10000
Commission            = 1000
Transaction Fee       = 100
Vendor Net            = 8900
```

The exact deduction order will be finalized with the Pricing/Payment
architecture.

---

# 35. Pending Earnings

Vendor earnings may initially enter:

```text
pendingBalance
```

rather than immediately becoming available.

Example:

```text
Order delivered:
Vendor net = 5000

Wallet:
pendingBalance += 5000
```

After the settlement period:

```text
pendingBalance -= 5000
availableBalance += 5000
```

This protects the platform against immediate withdrawal before the
applicable return/refund period ends.

---

# 36. Settlement

Settlement is the process of moving eligible pending earnings into the
available balance.

Conceptually:

```text
Vendor Order
      ↓
Eligible for settlement
      ↓
Pending Earnings
      ↓
Settlement
      ↓
Available Balance
```

The exact settlement eligibility rules are business configuration.

---

# 37. Settlement Record

A future `Settlement` entity may be introduced.

Initial conceptual fields:

```text
Settlement
├── id
├── vendorId
├── walletId
├── amount
├── currency
├── status
├── eligibleAt
├── settledAt
└── createdAt
```

The exact schema will be finalized when withdrawal and settlement
architecture is designed.

---

# 38. Wallet and Order Relationship

The wallet does not directly own OrderItems.

The financial relationship is:

```text
VendorOrder
     │
     ├── Commission
     │
     └── Vendor Earnings
              │
              ▼
           Wallet
              │
              ▼
      WalletTransaction
```

This keeps order, commission, and wallet responsibilities separate.

---

# 39. Wallet and Payment Relationship

Payment confirms that customer funds were successfully collected.

Wallet represents vendor/platform internal financial allocation.

Conceptually:

```text
Customer
   ↓
Payment
   ↓
MasterOrder
   ↓
VendorOrder
   ↓
Commission Calculation
   ↓
Vendor Earnings
   ↓
Wallet
```

A successful customer payment does not necessarily mean the vendor
immediately receives available wallet funds.

Settlement rules determine when vendor funds become available.

---

# 40. Refund Relationship

Refunds can affect vendor earnings.

Conceptually:

```text
Payment
   ↓
Refund
   ↓
Refund Allocation
   ↓
Vendor Financial Adjustment
   ↓
WalletTransaction
```

The exact refund allocation model must ensure that:

* Customer receives the correct refund
* Vendor earnings are adjusted correctly
* Platform commission is reversed where applicable
* Transaction fees are handled according to policy

---

# 41. Refund Allocation

A future `RefundAllocation` entity may be required.

Conceptually:

```text
Refund
  │
  ├── Vendor A allocation
  ├── Vendor B allocation
  └── Platform allocation
```

This becomes important for multi-vendor partial refunds.

The initial Wallet domain should not guess refund allocations without an
explicit business rule.

---

# 42. Financial Event Principle

Financial actions should be represented as explicit events/transactions.

Examples:

```text
Order Delivered
       ↓
Vendor Earnings Created

Settlement Eligible
       ↓
Pending → Available

Refund Approved
       ↓
Vendor Earnings Adjustment

Withdrawal Completed
       ↓
Available Balance → Debit
```

Each financially meaningful operation must have a corresponding ledger
record.

---

# 43. Idempotency

Wallet operations must be idempotent.

Example:

```text
Order Delivered Event
        ↓
Queue retry
        ↓
Same event processed again
```

The vendor must not receive duplicate earnings.

Therefore financial transaction references should be uniquely correlated
with the originating business event.

Possible reference:

```text
referenceType = VENDOR_ORDER
referenceId   = vendorOrderId
```

Additional event IDs may be introduced when needed.

---

# 44. Duplicate Credit Protection

A successful VendorOrder must not create multiple identical earning
credits because of:

* API retries
* Queue retries
* Worker crashes
* Duplicate webhook processing
* Duplicate event delivery

The database must provide uniqueness constraints or idempotency keys for
financial operations where appropriate.

---

# 45. Financial Transaction Reference

Every WalletTransaction should preferably have a business reference.

Examples:

```text
referenceType = VENDOR_ORDER
referenceId   = vendorOrderId
```

or:

```text
referenceType = REFUND
referenceId   = refundId
```

or:

```text
referenceType = WITHDRAWAL
referenceId   = withdrawalId
```

This allows the ledger to be traced back to its source.

---

# 46. Wallet Transaction Reconciliation

The system should eventually support reconciliation between:

```text
Wallet balance
```

and:

```text
Wallet transaction ledger
```

Conceptually:

```text
Opening Balance
+
Credits
-
Debits
=
Current Balance
```

A reconciliation job can detect inconsistencies.

BullMQ may be used for scheduled reconciliation.

---

# 47. Redis and BullMQ

Redis and BullMQ may support:

* Settlement jobs
* Earnings release jobs
* Reconciliation jobs
* Financial event processing
* Notification jobs
* Retry mechanisms

However:

```text
Redis ≠ financial ledger
BullMQ ≠ financial ledger
```

PostgreSQL remains authoritative.

---

# 48. Financial Transaction Boundary

Wallet updates must use database transactions.

Example:

```text
BEGIN TRANSACTION

1. Lock wallet
2. Validate balance
3. Calculate new balance
4. Update wallet
5. Insert WalletTransaction
6. Commit

```

If any operation fails:

```text
ROLLBACK
```

No partial wallet update is allowed.

---

# 49. Commission and Wallet Ordering

The financial workflow should conceptually follow:

```text
VendorOrder
    ↓
Calculate Gross
    ↓
Calculate Commission
    ↓
Calculate Fees
    ↓
Calculate Vendor Net
    ↓
Create Financial Records
    ↓
Credit Pending Balance
```

The exact timing depends on payment and fulfillment state.

---

# 50. Vendor Earnings Example

Example:

```text
VendorOrder subtotal       = 10000
Discount allocated         = 500
Tax                         = 0
Shipping                    = 200

Commission rate             = 10%
Commission base             = 9500

Commission                  = 950
Transaction fee             = 100

Vendor net                  = 8950
```

The final calculation must be deterministic and stored as a historical
snapshot.

---

# 51. Financial Precision

All financial fields use exact Decimal/Numeric representation.

Examples:

```text
Wallet.balance
Wallet.availableBalance
Wallet.pendingBalance

WalletTransaction.amount
WalletTransaction.balanceBefore
WalletTransaction.balanceAfter

Commission.rate
Commission.grossAmount
Commission.commissionAmount
```

Floating-point arithmetic must not be the authoritative financial
calculation mechanism.

---

# 52. Currency

Wallet currency must match the financial currency of the associated
earnings.

The initial architecture uses one wallet currency per vendor.

Cross-currency settlement is outside the initial scope.

Future multi-currency support may introduce:

```text
Wallet
UNIQUE(vendorId, currency)
```

---

# 53. Security

Wallet and financial APIs are highly sensitive.

Vendor users may:

* View their own wallet
* View their own wallet transactions
* View eligible earnings

Vendor users must not:

* Modify wallet balances directly
* Create arbitrary credit transactions
* Create arbitrary debit transactions
* Modify historical transactions

Administrative financial adjustments must require elevated permissions.

---

# 54. Administrative Adjustments

Admin financial adjustments must record:

```text
actor
reason
amount
direction
reference
timestamp
```

Example:

```text
Admin:
userId = ADMIN-123

Action:
ADJUSTMENT_CREDIT

Amount:
500

Reason:
Manual settlement correction
```

The original financial history must remain intact.

---

# 55. No Direct Balance Mutation From Controllers

Controllers must never directly perform:

```text
wallet.balance += amount
```

Financial mutations belong in a dedicated service/domain layer.

Conceptually:

```text
Controller
   ↓
WalletService
   ↓
Database Transaction
   ├── Update Wallet
   └── Create WalletTransaction
```

This centralizes financial consistency rules.

---

# 56. No Hard Deletion

Wallets and WalletTransactions must not normally be physically deleted.

Historical financial records must remain available for:

* Audit
* Support
* Reconciliation
* Reporting
* Settlement verification

If a wallet is no longer active, its status changes rather than deleting
its financial history.

---

# 57. Index Strategy

Initial indexes should include:

```text
Wallet
├── PRIMARY KEY (id)
└── UNIQUE (vendorId)

WalletTransaction
├── PRIMARY KEY (id)
├── INDEX (walletId, createdAt)
├── INDEX (type, createdAt)
└── INDEX (referenceType, referenceId)

Commission
├── PRIMARY KEY (id)
├── INDEX (vendorId)
├── INDEX (vendorOrderId)
└── INDEX (status, createdAt)
```

Future settlement and withdrawal tables will define their own indexes.

---

# 58. Referential Integrity

The database must enforce relationships:

```text
Wallet → Vendor
WalletTransaction → Wallet
Commission → Vendor
Commission → VendorOrder
```

Future financial entities may reference:

```text
Refund
Settlement
Withdrawal
```

The application layer must enforce financial business rules and
authorization.

---

# 59. Financial Auditability

The system must support tracing:

```text
Customer Payment
      ↓
MasterOrder
      ↓
VendorOrder
      ↓
Commission
      ↓
Vendor Earnings
      ↓
WalletTransaction
      ↓
Wallet Balance
```

For refunds:

```text
Refund
   ↓
Refund Allocation
   ↓
Wallet Adjustment
   ↓
WalletTransaction
```

For withdrawals:

```text
Withdrawal
   ↓
WalletTransaction
   ↓
Wallet Balance
```

This traceability is a core production requirement.

---

# 60. Complete Wallet and Commission Entity Map

```text
                         ┌───────────────┐
                         │    Vendor     │
                         └───────┬───────┘
                                 │
                                 │ 1:1
                                 ▼
                         ┌───────────────┐
                         │    Wallet     │
                         ├───────────────┤
                         │ balance       │
                         │ available     │
                         │ pending       │
                         └───────┬───────┘
                                 │
                                 │ 1:N
                                 ▼
                    ┌────────────────────────┐
                    │   WalletTransaction    │
                    ├────────────────────────┤
                    │ CREDIT / DEBIT         │
                    │ amount                 │
                    │ balanceBefore         │
                    │ balanceAfter          │
                    └────────────────────────┘


MasterOrder
    │
    ▼
VendorOrder
    │
    ├───────────────┐
    ▼               ▼
Commission     Vendor Earnings
                    │
                    ▼
                  Wallet
```

---

# 61. Design Decisions

| Decision                                    | Reason                                  |
| ------------------------------------------- | --------------------------------------- |
| One primary wallet per vendor               | Simple initial marketplace model        |
| Wallet balance stored                       | Fast balance reads                      |
| Ledger remains authoritative history        | Auditability                            |
| Wallet transactions immutable               | Prevents financial history manipulation |
| Balance before/after stored                 | Easier reconciliation and auditing      |
| Credit/debit explicit                       | Clear financial direction               |
| Commission separate from wallet transaction | Separates calculation from movement     |
| Vendor earnings can be pending              | Supports settlement/return windows      |
| Available and pending balances separated    | Prevents premature withdrawal           |
| Financial updates transactional             | Prevents inconsistent balances          |
| Wallet operations require idempotency       | Prevents duplicate credits/debits       |
| Refunds can create wallet adjustments       | Handles multi-vendor refunds            |
| Admin adjustments require audit data        | Protects financial integrity            |
| Redis is not authoritative                  | Financial state must remain durable     |
| BullMQ handles async financial jobs         | Suitable for settlement/reconciliation  |
| No direct controller balance mutation       | Centralizes financial business rules    |
| No hard deletion                            | Preserves financial history             |
| Decimal/Numeric for money                   | Prevents floating-point errors          |

---

# 62. Future Extensions

The following entities are intentionally outside the initial Wallet and
Commission implementation:

```text
Settlement
SettlementItem
Withdrawal
WithdrawalAttempt
RefundAllocation
CommissionRule
CommissionTier
VendorPayout
FinancialAdjustment
TaxAllocation
PlatformWallet
PlatformTransaction
VendorDebt
ChargebackAllocation
ReconciliationRecord
FinancialEvent
```

These should be introduced only when the corresponding business workflow
is required.

---

# 63. Implementation Status

```text
Wallet architecture                  APPROVED
WalletTransaction architecture       APPROVED
Commission architecture              APPROVED
Vendor earnings model                APPROVED
Pending/available balance model      APPROVED
Financial ledger principle           APPROVED
Concurrency requirements             APPROVED
Idempotency requirements             APPROVED
Refund financial boundary            APPROVED
Security requirements                APPROVED

Prisma models                        NOT IMPLEMENTED
Database migration                   NOT CREATED
Wallet APIs                          NOT IMPLEMENTED
Commission service                   NOT IMPLEMENTED
Settlement service                   NOT IMPLEMENTED
Withdrawal service                   NOT IMPLEMENTED
Redis integration                    NOT IMPLEMENTED
BullMQ integration                   NOT IMPLEMENTED
Tests                                NOT IMPLEMENTED
```

> This document defines the initial Wallet and Commission architecture.
> Prisma models, migrations, wallet services, commission calculation,
> settlement, withdrawal, refund allocation, Redis/BullMQ workflows, APIs,
> and tests will be implemented after the complete database architecture
> has been finalized.

The Wallet domain is the authoritative internal financial ledger for
vendor balances. External payment gateways remain responsible for
customer payment processing, while the Wallet and Commission domain is
responsible for vendor-side financial allocation and settlement.

````
