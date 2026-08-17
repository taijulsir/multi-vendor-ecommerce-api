# Payment and Refund Database Architecture

## Overview

The Payment and Refund domain is responsible for managing the financial
payment lifecycle associated with orders.

This domain is responsible for:

- Payment records
- Payment attempts
- Payment gateway references
- Payment lifecycle
- Gateway callback/webhook processing
- Idempotency
- Payment failure handling
- Successful payment confirmation
- Refund records
- Partial refunds
- Full refunds
- Refund lifecycle
- Gateway transaction references
- Financial reconciliation boundaries

The Payment domain is separate from the Order domain.

The Order represents the purchase.

The Payment represents how that purchase was financially processed.

The Refund represents money returned against a completed or eligible
payment.

---

# 1. High-Level Relationship

The core relationship is:

```text
User
 │
 └── MasterOrder
       │
       └── Payment
             │
             ├── PaymentAttempt
             │
             └── Refund
````

A payment may contain multiple attempts.

A successful payment may have zero or more refunds.

---

# 2. Why Payment and Order Are Separate

Order lifecycle and payment lifecycle are different concerns.

Example:

```text
Order:
CONFIRMED

Payment:
PENDING
```

Or:

```text
Order:
CONFIRMED

Payment:
PAID
```

Or:

```text
Order:
PROCESSING

Payment:
PARTIALLY_REFUNDED
```

Therefore payment status must not simply be treated as the same thing as
order status.

---

# 3. Payment

## Purpose

`Payment` represents the financial payment lifecycle for a MasterOrder.

The Payment record provides the platform-level financial state.

Detailed gateway attempts are stored separately in `PaymentAttempt`.

---

# 4. Payment Fields

| Field               | Type     | Required | Default           | Notes                             |
| ------------------- | -------- | -------: | ----------------- | --------------------------------- |
| `id`                | UUID     |      Yes | Generated         | Primary key                       |
| `masterOrderId`     | UUID     |      Yes | —                 | FK → MasterOrder                  |
| `paymentNumber`     | String   |      Yes | Generated         | Human-readable payment identifier |
| `status`            | Enum     |      Yes | `PENDING`         | Payment lifecycle                 |
| `method`            | Enum     |      Yes | —                 | Payment method                    |
| `currency`          | String   |      Yes | —                 | Payment currency                  |
| `amount`            | Decimal  |      Yes | —                 | Amount expected to be paid        |
| `paidAmount`        | Decimal  |      Yes | `0`               | Amount successfully paid          |
| `refundedAmount`    | Decimal  |      Yes | `0`               | Total amount refunded             |
| `provider`          | String   |      Yes | —                 | Payment provider/gateway          |
| `providerReference` | String   |       No | `null`            | Provider-level reference          |
| `paidAt`            | DateTime |       No | `null`            | Successful payment timestamp      |
| `createdAt`         | DateTime |      Yes | Current timestamp |                                   |
| `updatedAt`         | DateTime |      Yes | Auto-updated      |                                   |

---

# 5. Payment Number

The internal database identifier is a UUID.

A separate human-readable payment identifier is used for support,
debugging, reconciliation, and administrative operations.

Example:

```text
PAY-2026-000001
PAY-2026-000002
```

The payment number must be unique.

```text
paymentNumber → UNIQUE
```

---

# 6. Payment Status

The initial payment lifecycle is:

```text
PENDING
PROCESSING
AUTHORIZED
PAID
FAILED
CANCELLED
PARTIALLY_REFUNDED
REFUNDED
```

## PENDING

Payment has been created but payment processing has not completed.

## PROCESSING

Payment processing is currently in progress.

## AUTHORIZED

The payment provider has authorized the payment but final capture may
still be pending depending on the payment method.

## PAID

Payment has been successfully captured/confirmed.

## FAILED

Payment processing failed.

## CANCELLED

The payment was cancelled before successful completion.

## PARTIALLY_REFUNDED

Some but not all of the paid amount has been refunded.

## REFUNDED

The entire eligible paid amount has been refunded.

---

# 7. Payment Method

The initial payment methods may include:

```text
CARD
MOBILE_PAYMENT
BANK_TRANSFER
CASH_ON_DELIVERY
OTHER
```

The exact available methods depend on the supported business and gateway
integrations.

Gateway-specific details must not be encoded directly into the enum.

For example:

```text
method = CARD
provider = STRIPE
```

or:

```text
method = MOBILE_PAYMENT
provider = BKASH
```

---

# 8. Payment Provider

The provider identifies the external payment processor.

Examples:

```text
STRIPE
SSL_COMMERZ
BKASH
OTHER
```

The provider value should represent the integration rather than the
payment method itself.

Example:

```text
method   = CARD
provider = STRIPE
```

---

# 9. Payment Amount

The Payment amount represents the amount expected to be collected for the
MasterOrder.

Example:

```text
Order total:
5000 BDT

Payment:
amount = 5000 BDT
```

The payment amount must be stored as an exact Decimal/Numeric value.

JavaScript floating-point arithmetic must not be used as the
authoritative financial representation.

---

# 10. Paid Amount

`paidAmount` represents the amount that has actually been confirmed as
successfully paid.

Example:

```text
amount     = 5000
paidAmount = 5000
```

For a failed payment:

```text
amount     = 5000
paidAmount = 0
```

The service layer must ensure that:

```text
paidAmount >= 0
paidAmount <= amount
```

for the normal single-payment model.

---

# 11. Refunded Amount

`refundedAmount` represents the cumulative amount refunded against the
payment.

Example:

```text
paidAmount     = 5000
refundedAmount = 1000
```

Remaining refundable amount:

```text
5000 - 1000 = 4000
```

The exact refundable amount must be calculated from the payment/refund
records rather than trusting arbitrary client input.

---

# 12. PaymentAttempt

## Purpose

`PaymentAttempt` represents one attempt to process a Payment through an
external payment provider.

A single Payment may have multiple attempts.

Example:

```text
Payment
├── Attempt 1 → FAILED
├── Attempt 2 → FAILED
└── Attempt 3 → PAID
```

This is important because users may retry failed payments.

---

# 13. PaymentAttempt Fields

| Field               | Type     | Required | Default           | Notes                             |
| ------------------- | -------- | -------: | ----------------- | --------------------------------- |
| `id`                | UUID     |      Yes | Generated         | Primary key                       |
| `paymentId`         | UUID     |      Yes | —                 | FK → Payment                      |
| `attemptNumber`     | Integer  |      Yes | —                 | Sequential attempt number         |
| `status`            | Enum     |      Yes | `INITIATED`       | Attempt lifecycle                 |
| `provider`          | String   |      Yes | —                 | Gateway/provider                  |
| `providerReference` | String   |       No | `null`            | Gateway transaction/reference     |
| `amount`            | Decimal  |      Yes | —                 | Attempt amount                    |
| `currency`          | String   |      Yes | —                 | Currency                          |
| `failureCode`       | String   |       No | `null`            | Provider/application failure code |
| `failureMessage`    | String   |       No | `null`            | Safe failure description          |
| `metadata`          | JSON     |       No | `{}`              | Provider metadata                 |
| `initiatedAt`       | DateTime |      Yes | Current timestamp |                                   |
| `completedAt`       | DateTime |       No | `null`            | Completion timestamp              |
| `createdAt`         | DateTime |      Yes | Current timestamp |                                   |

---

# 14. PaymentAttempt Status

Initial attempt statuses:

```text
INITIATED
PENDING
AUTHORIZED
SUCCEEDED
FAILED
CANCELLED
EXPIRED
```

An attempt represents a single processing attempt and should not be
reused for unrelated payment attempts.

---

# 15. Why PaymentAttempt Is Required

Without PaymentAttempt, retry behavior becomes difficult to audit.

Example:

```text
Payment #PAY-001

Attempt 1:
Stripe reference = pi_001
FAILED

Attempt 2:
Stripe reference = pi_002
SUCCEEDED
```

The Payment represents the final financial state.

The PaymentAttempt records the processing history.

---

# 16. Provider Reference

External gateways typically provide transaction identifiers.

Examples:

```text
providerReference = provider-specific transaction ID
```

This value must be stored for:

* Reconciliation
* Refund requests
* Customer support
* Webhook correlation
* Gateway debugging

The exact reference format is provider-specific.

---

# 17. Payment Gateway Data

Provider-specific metadata may be stored in:

```text
metadata JSON
```

Example:

```json
{
  "sessionId": "provider-session-id",
  "checkoutReference": "provider-checkout-reference"
}
```

Sensitive payment credentials must never be stored in this field.

The system must not store raw:

* Card numbers
* CVV
* Private payment credentials
* Authentication secrets

unless a provider explicitly requires a secure tokenized reference and
the storage design has been reviewed.

---

# 18. Payment Webhook

Payment gateways commonly notify the application asynchronously.

Conceptual flow:

```text
Gateway
   ↓
Webhook
   ↓
Verify Signature
   ↓
Identify PaymentAttempt
   ↓
Check Idempotency
   ↓
Process Event
   ↓
Update Payment
   ↓
Update Order Payment Status
```

Webhook processing must be treated as an independent application
workflow.

---

# 19. PaymentWebhookEvent

The initial architecture should persist webhook/event processing records
for idempotency and auditing.

Fields:

| Field               | Type     | Required | Default           | Notes                                    |
| ------------------- | -------- | -------: | ----------------- | ---------------------------------------- |
| `id`                | UUID     |      Yes | Generated         | Primary key                              |
| `provider`          | String   |      Yes | —                 | Gateway provider                         |
| `eventId`           | String   |      Yes | —                 | Provider event identifier                |
| `eventType`         | String   |      Yes | —                 | Provider event type                      |
| `providerReference` | String   |       No | `null`            | Related provider reference               |
| `payload`           | JSON     |      Yes | —                 | Stored webhook payload where appropriate |
| `status`            | Enum     |      Yes | `RECEIVED`        | Processing status                        |
| `processedAt`       | DateTime |       No | `null`            | Processing timestamp                     |
| `errorMessage`      | String   |       No | `null`            | Processing error                         |
| `createdAt`         | DateTime |      Yes | Current timestamp |                                          |

---

# 20. Webhook Event Status

Initial statuses:

```text
RECEIVED
PROCESSING
PROCESSED
FAILED
IGNORED
```

---

# 21. Webhook Idempotency

Webhook providers may send the same event multiple times.

Example:

```text
Webhook Event:
evt_123

Request 1 → received
Request 2 → retry
Request 3 → retry
```

The system must process the financial effect only once.

The provider's event ID should be uniquely constrained per provider.

Conceptually:

```text
UNIQUE(provider, eventId)
```

Duplicate webhook delivery must not:

* Double-credit payment
* Create duplicate orders
* Double-refund customers
* Duplicate wallet transactions

---

# 22. Webhook Signature Verification

Before processing a webhook:

```text
Receive request
     ↓
Verify provider signature
     ↓
Validate payload
     ↓
Check event idempotency
     ↓
Process event
```

Invalid webhook signatures must be rejected.

The exact signature mechanism depends on the provider.

---

# 23. Payment State Transition

Payment state must follow an explicit transition model.

Example:

```text
PENDING
   │
   └── PROCESSING
          │
          ├── AUTHORIZED
          │      │
          │      └── PAID
          │
          └── FAILED
```

After payment:

```text
PAID
 │
 ├── PARTIALLY_REFUNDED
 │        │
 │        └── REFUNDED
 │
 └── REFUNDED
```

The service layer must reject invalid state transitions.

---

# 24. Payment and Order Synchronization

The Payment domain must update the summarized payment state on
MasterOrder.

Example:

```text
Payment:
PAID

MasterOrder:
paymentStatus = PAID
```

However, the MasterOrder does not become the source of truth for
gateway-level payment details.

The Payment record remains authoritative for payment processing.

---

# 25. External Gateway Calls

Payment gateway API calls are external network operations.

They must not be treated as PostgreSQL transactions.

Example:

```text
PostgreSQL transaction
        ↓
Cannot atomically include
        ↓
External gateway request
```

Therefore the system must be designed with:

* Idempotency
* Retry safety
* Webhook reconciliation
* Explicit payment states
* Failure recovery

---

# 26. Payment Retry

A failed PaymentAttempt should not normally mutate the existing attempt
into a new unrelated attempt.

Instead:

```text
Payment
├── Attempt 1 → FAILED
└── Attempt 2 → INITIATED
```

This preserves the complete attempt history.

---

# 27. Refund

## Purpose

`Refund` represents money returned against a successful payment.

A Payment may have multiple Refund records.

Example:

```text
Payment = 5000 BDT

Refund 1 = 1000 BDT
Refund 2 = 500 BDT
Refund 3 = 3500 BDT
```

Total refunded:

```text
5000 BDT
```

---

# 28. Refund Fields

| Field               | Type     | Required | Default           | Notes                            |
| ------------------- | -------- | -------: | ----------------- | -------------------------------- |
| `id`                | UUID     |      Yes | Generated         | Primary key                      |
| `paymentId`         | UUID     |      Yes | —                 | FK → Payment                     |
| `refundNumber`      | String   |      Yes | Generated         | Human-readable refund identifier |
| `status`            | Enum     |      Yes | `PENDING`         | Refund lifecycle                 |
| `amount`            | Decimal  |      Yes | —                 | Requested refund amount          |
| `currency`          | String   |      Yes | —                 | Refund currency                  |
| `reason`            | Enum     |      Yes | —                 | Refund reason                    |
| `providerReference` | String   |       No | `null`            | Gateway refund reference         |
| `requestedBy`       | UUID     |       No | `null`            | Actor requesting refund          |
| `processedAt`       | DateTime |       No | `null`            | Successful processing timestamp  |
| `createdAt`         | DateTime |      Yes | Current timestamp |                                  |
| `updatedAt`         | DateTime |      Yes | Auto-updated      |                                  |

---

# 29. Refund Status

Initial refund statuses:

```text
PENDING
PROCESSING
SUCCEEDED
FAILED
CANCELLED
```

A refund becomes financially effective only after the gateway/provider
confirms successful processing according to the supported integration.

---

# 30. Refund Number

Refunds use a separate human-readable identifier.

Example:

```text
REF-2026-000001
REF-2026-000002
```

The refund number must be unique.

---

# 31. Refund Reasons

Initial refund reasons:

```text
ORDER_CANCELLED
CUSTOMER_RETURN
DAMAGED_PRODUCT
WRONG_PRODUCT
PAYMENT_ERROR
DUPLICATE_PAYMENT
ADMIN_ADJUSTMENT
OTHER
```

The final list may be extended as business requirements evolve.

---

# 32. Full Refund

A full refund returns the complete refundable amount.

Example:

```text
Paid:
5000

Refund:
5000
```

Payment state:

```text
REFUNDED
```

---

# 33. Partial Refund

A partial refund returns only part of the paid amount.

Example:

```text
Paid:
5000

Refund:
1500
```

Remaining refundable amount:

```text
3500
```

Payment state:

```text
PARTIALLY_REFUNDED
```

---

# 34. Refund Invariant

The cumulative successful refund amount must never exceed the
successfully paid amount.

Conceptually:

```text
sum(successful refunds) <= paidAmount
```

The application must enforce this using transaction-safe logic.

A client must never be able to submit:

```text
paidAmount = 5000
refundAmount = 7000
```

and have it accepted.

---

# 35. Refund Retry

If a refund attempt fails, the system must preserve the failed state and
support safe retry behavior.

A retry must not create duplicate financial refunds.

Conceptually:

```text
Refund
   │
   ├── Attempt 1 → FAILED
   └── Retry → PROCESSING
```

If gateway-specific refund attempts become sufficiently complex, a
dedicated `RefundAttempt` entity may be introduced.

The initial architecture keeps this extension open.

---

# 36. Refund and Order

A refund may be triggered by:

* Order cancellation
* Vendor cancellation
* Customer return
* Administrative action
* Payment error
* Duplicate payment

The Refund domain owns the financial refund state.

The Order domain owns the purchase/fulfillment state.

Example:

```text
Order:
CANCELLED

Payment:
PARTIALLY_REFUNDED

Refund:
SUCCEEDED
```

These are related states but are not identical.

---

# 37. Refund and VendorOrder

A multi-vendor order may require partial refunds.

Example:

```text
MasterOrder
├── VendorOrder A → cancelled
└── VendorOrder B → delivered
```

Only VendorOrder A's applicable amount may be refunded.

Therefore refund calculation must be capable of supporting partial
financial effects.

Detailed refund allocation will be finalized with the Wallet/Commission
architecture.

---

# 38. Refund and Wallet/Commission Boundary

The Payment domain records customer-facing payment and refund state.

The Wallet/Commission domain handles vendor/platform financial
consequences.

Example:

```text
Customer Payment
       ↓
Payment
       ↓
Refund
       ↓
Wallet/Commission Adjustment
```

The Payment domain must not contain all vendor wallet logic.

---

# 39. Payment Idempotency

Payment operations must be idempotent.

This includes:

* Payment creation
* Payment confirmation
* Webhook processing
* Refund creation
* Refund processing

Repeated requests must not produce duplicate financial effects.

---

# 40. API Idempotency Key

For client-triggered operations, an idempotency key may be accepted.

Example:

```text
Idempotency-Key: checkout-unique-key
```

The server must associate the key with the relevant operation and
prevent duplicate execution.

The exact persistence model will be finalized during implementation.

---

# 41. Database-Level Uniqueness

Important uniqueness constraints include:

```text
Payment
├── UNIQUE(paymentNumber)

PaymentAttempt
└── UNIQUE(paymentId, attemptNumber)

PaymentWebhookEvent
└── UNIQUE(provider, eventId)

Refund
└── UNIQUE(refundNumber)
```

Provider references may also require provider-specific unique
constraints where appropriate.

---

# 42. Index Strategy

Initial indexes should include:

```text
Payment
├── PRIMARY KEY (id)
├── UNIQUE (paymentNumber)
├── INDEX (masterOrderId)
├── INDEX (status)
├── INDEX (provider, providerReference)
└── INDEX (createdAt)

PaymentAttempt
├── PRIMARY KEY (id)
├── INDEX (paymentId)
├── INDEX (provider, providerReference)
└── UNIQUE (paymentId, attemptNumber)

PaymentWebhookEvent
├── PRIMARY KEY (id)
├── UNIQUE (provider, eventId)
├── INDEX (providerReference)
└── INDEX (status, createdAt)

Refund
├── PRIMARY KEY (id)
├── UNIQUE (refundNumber)
├── INDEX (paymentId)
├── INDEX (status)
└── INDEX (providerReference)
```

Additional indexes should be introduced only when justified by query
patterns.

---

# 43. Referential Integrity

The database must enforce:

```text
Payment → MasterOrder
PaymentAttempt → Payment
Refund → Payment
```

The application layer must additionally enforce:

* Payment ownership
* Order/payment consistency
* Currency consistency
* Refund limits
* Valid status transitions
* Gateway authorization
* Idempotency

---

# 44. Financial Precision

All payment/refund monetary values use exact Decimal/Numeric types.

Examples:

```text
amount
paidAmount
refundedAmount
refund.amount
PaymentAttempt.amount
```

Never use JavaScript floating-point values as the authoritative source for
financial calculations.

---

# 45. Currency Consistency

A Payment must use the same currency as the associated MasterOrder in the
initial architecture.

A Refund must use the same currency as its Payment.

Example:

```text
MasterOrder:
BDT

Payment:
BDT

Refund:
BDT
```

Cross-currency refunds are outside the initial scope.

---

# 46. Security

Payment-related APIs are sensitive.

The application must:

* Authenticate users
* Authorize access to the user's own payments
* Restrict vendor access
* Restrict refund creation
* Validate gateway callbacks
* Verify webhook signatures
* Never expose sensitive payment credentials
* Never trust client-provided payment success state

The client must never be allowed to declare:

```text
paymentStatus = PAID
```

The server must confirm payment through the gateway and/or verified
webhook flow.

---

# 47. Webhook as Financial Evidence

A client redirect is not sufficient evidence of successful payment.

Example:

```text
Customer Browser
      ↓
Payment Gateway
      ↓
Redirect
```

The redirect may be interrupted.

The authoritative confirmation should come from a verified gateway
response/webhook or an explicitly verified provider API query.

Therefore:

```text
Browser redirect ≠ trusted payment confirmation
```

---

# 48. Reconciliation

The system should eventually support payment reconciliation.

Conceptual process:

```text
Internal Payment State
        ↓
Gateway State
        ↓
Compare
        ↓
Detect mismatch
        ↓
Reconcile
```

Examples:

```text
Internal:
PENDING

Gateway:
PAID
```

or:

```text
Internal:
PAID

Gateway:
REFUNDED
```

Reconciliation jobs may be handled asynchronously using BullMQ.

---

# 49. Redis and BullMQ

Redis and BullMQ may support:

* Webhook processing queues
* Payment retry jobs
* Refund retry jobs
* Reconciliation jobs
* Payment timeout handling
* Notification jobs

PostgreSQL remains the source of truth.

A queue message must never be treated as the permanent financial record.

---

# 50. Transactional Principle

Financial state changes must be protected by database transactions.

Example:

```text
Receive verified payment success
        ↓
BEGIN TRANSACTION
        ↓
Check idempotency
        ↓
Update PaymentAttempt
        ↓
Update Payment
        ↓
Update MasterOrder payment summary
        ↓
Create required financial event/reference
        ↓
COMMIT
```

External gateway calls happen outside the PostgreSQL transaction.

---

# 51. Failed Payment Recovery

A failed payment must not automatically mean that the order record is
deleted.

Example:

```text
MasterOrder:
PENDING / CONFIRMED

Payment:
FAILED
```

The customer may retry through another PaymentAttempt.

The Order remains available according to the checkout/payment policy.

---

# 52. Payment Timeout

A Payment may remain pending for longer than the allowed period.

A future background job may:

```text
Payment PENDING
      ↓
Timeout threshold reached
      ↓
Mark payment as EXPIRED/CANCELLED
      ↓
Release applicable inventory reservation
```

The exact timeout and resulting Order status will be finalized with the
Checkout and Inventory architecture.

---

# 53. No Hard Deletion

Payment and Refund records are financial records.

They should not normally be physically deleted.

Failed attempts, failed refunds, webhook events, and successful
transactions should remain available according to retention policies.

Corrections should use new records/events rather than destructive
updates.

---

# 54. Complete Payment Entity Map

```text
                         ┌──────────────┐
                         │ MasterOrder  │
                         └──────┬───────┘
                                │
                                │ 1:N
                                ▼
                         ┌──────────────┐
                         │   Payment    │
                         ├──────────────┤
                         │ amount       │
                         │ paidAmount   │
                         │ status       │
                         │ provider     │
                         └──────┬───────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
                    ▼                       ▼
             PaymentAttempt              Refund
                    │                       │
                    │                       │
                    ▼                       ▼
          Gateway transaction       Refund transaction


Gateway
   │
   └── Webhook
         ↓
PaymentWebhookEvent
         ↓
Payment / PaymentAttempt
```

---

# 55. Design Decisions

| Decision                                | Reason                                            |
| --------------------------------------- | ------------------------------------------------- |
| Payment separate from Order             | Payment and fulfillment have different lifecycles |
| PaymentAttempt separate                 | Supports retries and complete gateway history     |
| Webhook events persisted                | Provides idempotency and auditability             |
| `(provider, eventId)` unique            | Prevents duplicate webhook processing             |
| Refund separate from Payment            | Supports multiple and partial refunds             |
| Refund cumulative amount bounded        | Prevents over-refunding                           |
| Payment uses Decimal/Numeric            | Financial precision                               |
| Refund uses same currency               | Prevents initial cross-currency complexity        |
| Gateway reference stored                | Required for reconciliation and support           |
| Client cannot confirm payment           | Prevents payment fraud/state manipulation         |
| Webhook signature verification required | Protects payment state                            |
| Browser redirect not authoritative      | Redirects can be interrupted/spoofed              |
| PostgreSQL is financial source of truth | Durable transactional state                       |
| Redis is supporting infrastructure      | Cache/queue must not become authoritative         |
| BullMQ handles async work               | Suitable for retries and reconciliation           |
| Payment records are retained            | Financial auditability                            |
| Order payment status is summarized      | Keeps domain boundaries clear                     |

---

# 56. Future Extensions

The following are intentionally outside the initial schema:

```text
PaymentMethod
PaymentProviderConfig
PaymentAttemptEvent
RefundAttempt
RefundAllocation
OrderPaymentAllocation
VendorPaymentAllocation
GatewaySettlement
PaymentReconciliation
Dispute
Chargeback
FraudCheck
TaxPayment
Invoice
CreditNote
WalletTransaction
CommissionTransaction
```

These can be introduced as separate domains when required.

---

# 57. Implementation Status

```text
Payment architecture                 APPROVED
PaymentAttempt architecture          APPROVED
Webhook architecture                 APPROVED
Webhook idempotency                  APPROVED
Refund architecture                  APPROVED
Partial refund model                 APPROVED
Financial precision strategy         APPROVED
Gateway boundary                     APPROVED
Security requirements                APPROVED
Reconciliation boundary              APPROVED

Prisma models                        NOT IMPLEMENTED
Database migration                   NOT CREATED
Payment APIs                         NOT IMPLEMENTED
Gateway integration                  NOT IMPLEMENTED
Webhook handlers                     NOT IMPLEMENTED
Refund APIs                           NOT IMPLEMENTED
Redis integration                    NOT IMPLEMENTED
BullMQ integration                   NOT IMPLEMENTED
Tests                                 NOT IMPLEMENTED
```

> This document defines the initial Payment and Refund architecture.
> Prisma models, migrations, payment gateway integrations, webhook
> handlers, refund workflows, Redis/BullMQ processing, reconciliation,
> services, APIs, and tests will be implemented after the database
> architecture has been finalized.

The Payment domain is the authoritative application-level representation
of payment processing, while external payment gateways remain the
external financial processing systems.

````
