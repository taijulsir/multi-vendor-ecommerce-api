# Notification Database Architecture

## Overview

The Notification domain manages system-generated notifications delivered
to users and, where applicable, vendors and administrators.

This domain is responsible for:

- In-app notifications
- Notification recipients
- Read/unread state
- Notification types
- Notification payloads
- Notification delivery state
- Notification timestamps
- Notification preferences
- Bulk/system notifications
- Notification expiration
- Async notification processing

The Notification domain may integrate with:

- User
- Vendor
- Order
- Payment
- Refund
- Wallet
- Promotion
- Review
- Authentication
- Redis
- BullMQ
- Email providers
- Push notification providers
- WebSocket infrastructure

The Notification database remains the authoritative record of
application-level notification state.

---

# 1. High-Level Architecture

The initial architecture is:

```text
Application Event
       │
       ▼
Notification Service
       │
       ├── Create Notification
       │
       ├── Resolve Recipient
       │
       └── Queue Delivery
                │
                ▼
             BullMQ
                │
        ┌───────┼────────┐
        ▼       ▼        ▼
      In-App   Email    Push
````

The database stores the notification record independently from the
delivery mechanism.

---

# 2. Notification

## Purpose

`Notification` represents a notification intended for a specific
recipient.

Examples:

```text
Order shipped
Payment successful
Refund approved
Vendor received an order
Wallet settlement completed
New product review
Promotion available
Account security alert
```

---

# 3. Notification Fields

| Field       | Type     | Required | Default           | Notes                         |
| ----------- | -------- | -------: | ----------------- | ----------------------------- |
| `id`        | UUID     |      Yes | Generated         | Primary key                   |
| `userId`    | UUID     |      Yes | —                 | FK → User                     |
| `type`      | Enum     |      Yes | —                 | Notification type             |
| `title`     | String   |      Yes | —                 | Notification title            |
| `message`   | String   |      Yes | —                 | Notification message          |
| `data`      | JSON     |       No | `{}`              | Structured contextual payload |
| `status`    | Enum     |      Yes | `UNREAD`          | Read state                    |
| `readAt`    | DateTime |       No | `null`            | Timestamp when read           |
| `expiresAt` | DateTime |       No | `null`            | Optional expiration           |
| `createdAt` | DateTime |      Yes | Current timestamp |                               |
| `updatedAt` | DateTime |      Yes | Auto-updated      |                               |

---

# 4. Notification Ownership

Every notification belongs to a recipient.

Initial architecture:

```text
Notification.userId
        ↓
      User
```

The client must never be able to create a notification for an arbitrary
user.

Notifications are created by trusted application services.

---

# 5. Notification Types

Initial notification types:

```text
ORDER_CREATED
ORDER_CONFIRMED
ORDER_SHIPPED
ORDER_DELIVERED
ORDER_CANCELLED

PAYMENT_SUCCESS
PAYMENT_FAILED
PAYMENT_REFUNDED

REFUND_REQUESTED
REFUND_APPROVED
REFUND_REJECTED
REFUND_COMPLETED

WALLET_CREDITED
WALLET_DEBITED
SETTLEMENT_COMPLETED
WITHDRAWAL_COMPLETED
WITHDRAWAL_FAILED

REVIEW_RECEIVED
REVIEW_PUBLISHED
REVIEW_REJECTED

PROMOTION_AVAILABLE

ACCOUNT_SECURITY
SYSTEM
```

The list can be extended as new domains are introduced.

---

# 6. Notification Status

Initial statuses:

```text
UNREAD
READ
```

## UNREAD

Notification has not been marked as read by the recipient.

## READ

Recipient has opened or explicitly marked the notification as read.

---

# 7. Read Timestamp

When a notification changes from:

```text
UNREAD
```

to:

```text
READ
```

the system should set:

```text
readAt = current timestamp
```

Example:

```text
status = READ
readAt = 2026-08-17T12:00:00Z
```

When unread:

```text
status = UNREAD
readAt = null
```

---

# 8. Notification Data

The `data` field stores structured contextual information.

Example:

```json
{
  "orderId": "uuid",
  "orderNumber": "ORD-2026-001",
  "status": "SHIPPED"
}
```

Another example:

```json
{
  "productId": "uuid",
  "reviewId": "uuid"
}
```

The payload should contain identifiers and structured data rather than
duplicating large domain objects.

---

# 9. Why JSON Data

Different notification types require different contextual information.

For example:

```text
ORDER_SHIPPED
→ orderId

REVIEW_RECEIVED
→ reviewId
→ productId

WALLET_CREDITED
→ walletTransactionId
```

A JSON payload avoids adding dozens of nullable columns to the
Notification table.

However, important relational ownership must remain represented through
real foreign-key relationships in the relevant domain tables.

---

# 10. Notification Snapshot

Notification title and message should be treated as snapshots.

Example:

```text
Promotion:
"Summer Sale"
```

Notification created:

```text
title:
"Summer Sale is live"
```

Later, the Promotion may be renamed.

The historical Notification should not automatically change.

---

# 11. Notification Creation

Notifications should be created by domain/application services.

Example:

```text
OrderService
     │
     └── Order shipped
             │
             ▼
      NotificationService
             │
             ▼
       Create Notification
```

Controllers should not contain notification creation logic.

---

# 12. Domain Events

The initial architecture should support domain/application events.

Example:

```text
OrderService
    ↓
OrderShippedEvent
    ↓
Notification Handler
    ↓
NotificationService
```

This keeps notification logic decoupled from core business logic.

---

# 13. Event Example

Conceptually:

```json
{
  "event": "ORDER_SHIPPED",
  "orderId": "uuid",
  "userId": "uuid"
}
```

The event contains enough information for the notification handler to
construct the appropriate notification.

---

# 14. Redis and BullMQ

Redis and BullMQ are supporting infrastructure for asynchronous
notification processing.

Example:

```text
Order Service
     ↓
Create Domain Event
     ↓
BullMQ Queue
     ↓
Notification Worker
     ↓
NotificationService
     ↓
PostgreSQL
```

Redis is not the source of truth for whether a notification exists or
whether it has been read.

PostgreSQL remains authoritative.

---

# 15. Why Queue Notifications

Notification delivery should not unnecessarily block critical business
operations.

Without a queue:

```text
Order API
  ↓
Save Order
  ↓
Send Email
  ↓
Create Notification
  ↓
Response
```

With asynchronous processing:

```text
Order API
  ↓
Save Order
  ↓
Publish Event / Queue Job
  ↓
Response

Worker
  ↓
Process Notification
```

This improves API responsiveness and allows retries.

---

# 16. Notification Delivery

The initial database model focuses on in-app notifications.

Future delivery channels may include:

```text
IN_APP
EMAIL
PUSH
SMS
WEBSOCKET
```

These channels should not be tightly coupled to the core Notification
entity.

---

# 17. Notification Preferences

Users may eventually control which notification channels they receive.

A future `NotificationPreference` entity may contain:

| Field              | Type     |
| ------------------ | -------- |
| `id`               | UUID     |
| `userId`           | UUID     |
| `notificationType` | Enum     |
| `inAppEnabled`     | Boolean  |
| `emailEnabled`     | Boolean  |
| `pushEnabled`      | Boolean  |
| `createdAt`        | DateTime |
| `updatedAt`        | DateTime |

Constraint:

```text
UNIQUE(userId, notificationType)
```

---

# 18. Notification Preference Principle

Preferences control delivery behavior.

They should not prevent critical security or system notifications from
being generated when required.

Example:

```text
Promotion notification
→ user may disable

Account security alert
→ may remain mandatory
```

The exact mandatory notification policy will be defined during
implementation.

---

# 19. In-App Notification

The initial system supports:

```text
Notification
    ↓
User
```

The frontend can retrieve:

```text
GET /notifications
```

and:

```text
GET /notifications/unread-count
```

The exact API design will be finalized during the API phase.

---

# 20. Unread Count

The unread count can initially be calculated using:

```text
status = UNREAD
AND userId = authenticatedUser
```

Example:

```text
User has:
10 total notifications
3 unread

Unread count = 3
```

If performance later requires it, the count can be cached using Redis.

The database remains authoritative.

---

# 21. Mark One Notification as Read

Conceptual flow:

```text
User
 ↓
POST/PATCH notification read
 ↓
Authenticate
 ↓
Find notification by ID
 ↓
Verify notification.userId
 ↓
Set status = READ
 ↓
Set readAt
```

The user must not be able to mark another user's notification as read.

---

# 22. Mark All Notifications as Read

The system may support:

```text
Mark all as read
```

Conceptually:

```text
UPDATE notifications
SET
  status = READ,
  readAt = current_timestamp
WHERE
  userId = authenticatedUser
  AND status = UNREAD;
```

This operation must only affect the authenticated user's notifications.

---

# 23. Notification Expiration

Some notifications may have an expiration time.

Example:

```text
Promotion available
expiresAt = campaign end
```

Expired notifications may remain in the database for historical purposes
but can be excluded from normal active notification queries.

---

# 24. Notification Retention

Notifications should not necessarily be deleted immediately after being
read.

Historical notifications may be useful for:

* Customer support
* User activity history
* Debugging
* Audit investigation

A future retention policy may archive or delete very old notifications.

---

# 25. Notification Priority

The initial architecture may support an optional priority field in a
future extension.

Potential values:

```text
LOW
NORMAL
HIGH
CRITICAL
```

This is intentionally not required in the first schema.

Security and critical account events can later use priority-aware
processing.

---

# 26. Notification Delivery Status

Delivery status is different from read status.

Example:

```text
Notification:
READ
```

does not necessarily mean:

```text
Email:
DELIVERED
```

Therefore external delivery tracking should be modeled separately.

---

# 27. NotificationDelivery

Future conceptual entity:

```text
Notification
      │
      └── NotificationDelivery
             ├── channel
             ├── status
             ├── provider
             ├── providerMessageId
             ├── attemptedAt
             ├── deliveredAt
             └── failedAt
```

Possible channels:

```text
EMAIL
PUSH
SMS
WEBSOCKET
```

This entity is intentionally deferred from the initial implementation.

---

# 28. Delivery Status

Future delivery statuses:

```text
PENDING
PROCESSING
SENT
DELIVERED
FAILED
RETRYING
```

This is separate from:

```text
Notification.status
```

which represents the user's read state.

---

# 29. Notification Retry

External delivery may fail.

Example:

```text
Notification
     ↓
Email Worker
     ↓
Provider Failure
     ↓
BullMQ Retry
     ↓
Email Worker
```

BullMQ handles retry mechanics.

The database may eventually store the delivery attempt state.

---

# 30. Idempotency

Notification processing must be idempotent.

Example:

```text
OrderShippedEvent
      ↓
Queue Job
      ↓
Worker crashes
      ↓
Job retries
```

The retry must not create duplicate notifications.

The implementation should use a deterministic event/reference identity.

---

# 31. Duplicate Notification Prevention

A future event reference may be used:

```text
eventType
eventId
recipientId
```

Example:

```text
ORDER_SHIPPED
eventId = order-shipped-event-uuid
userId = user-uuid
```

A unique constraint can prevent duplicate processing when appropriate.

The exact constraint will be finalized during implementation.

---

# 32. Notification Reference

Notification data may include a source reference.

Example:

```json
{
  "orderId": "uuid"
}
```

or:

```json
{
  "refundId": "uuid"
}
```

This allows the frontend to navigate to the relevant resource.

---

# 33. Notification Security

The system must prevent:

* Cross-user notification access
* Cross-user notification modification
* Client-created system notifications
* Client-controlled notification status for other users
* Unauthorized deletion
* Sensitive information leakage

Every notification query must be scoped to the authenticated recipient.

---

# 34. Notification API Authorization

Conceptually:

```text
Authenticated User
       ↓
Notification.userId
       ↓
Allowed
```

Admin access to another user's notifications should require explicit
administrative permissions.

---

# 35. Notification Content Security

Notification messages must not blindly interpolate untrusted user input.

For example:

```text
User-provided name
Product title
Vendor name
Review content
```

must be safely handled before appearing in notification content.

The frontend must also render notification content safely.

---

# 36. Notification Localization

The initial system may store resolved:

```text
title
message
```

in the user's language.

A future localization architecture may instead store:

```text
notificationKey
templateData
```

and resolve the translated message at delivery time.

This is intentionally deferred.

---

# 37. Notification Type vs Message

The notification type identifies the business event:

```text
ORDER_SHIPPED
```

The title/message represents the human-readable content:

```text
Your order has been shipped.
```

Therefore the type should remain stable even if the wording changes.

---

# 38. Notification and Order

Example:

```text
Order
  ↓
OrderShippedEvent
  ↓
Notification
  ↓
User
```

The Notification does not own the Order.

It references the Order through structured notification data.

---

# 39. Notification and Payment

Example:

```text
PaymentService
      ↓
PaymentSuccessEvent
      ↓
NotificationService
      ↓
Notification
```

The notification may contain:

```json
{
  "paymentId": "uuid",
  "orderId": "uuid"
}
```

---

# 40. Notification and Refund

Example:

```text
RefundService
      ↓
RefundApprovedEvent
      ↓
NotificationService
      ↓
Notification
```

The notification may contain:

```json
{
  "refundId": "uuid",
  "orderId": "uuid"
}
```

---

# 41. Notification and Wallet

Example:

```text
WalletService
      ↓
WalletCreditedEvent
      ↓
NotificationService
      ↓
Notification
```

The notification may contain:

```json
{
  "walletTransactionId": "uuid"
}
```

Financial values should not be trusted from client-side notification data.

---

# 42. Notification and Review

Example:

```text
ReviewService
      ↓
ReviewCreatedEvent
      ↓
NotificationService
      ↓
Vendor Notification
```

The recipient is determined by the product/vendor relationship.

The client must not provide the recipient vendor arbitrarily.

---

# 43. Notification and Promotion

Promotion notifications may be generated when:

```text
Promotion becomes active
```

or:

```text
A targeted promotion is available
```

These can be processed asynchronously using BullMQ.

The Promotion domain remains responsible for determining eligibility.

---

# 44. Bulk Notifications

The system may eventually support system-wide announcements.

Example:

```text
Admin
 ↓
Announcement
 ↓
Many Users
```

For large audiences, the system should not create millions of records
inside a single synchronous request.

Instead:

```text
Admin
 ↓
Create Announcement
 ↓
BullMQ
 ↓
Batch Processing
 ↓
Notification Records
```

A future `Announcement` entity may be introduced.

---

# 45. Announcement

Future conceptual entity:

```text
Announcement
├── id
├── title
├── message
├── targetType
├── targetData
├── status
├── scheduledAt
├── expiresAt
└── createdAt
```

This is intentionally outside the initial schema.

---

# 46. Notification Preferences and Vendors

Vendors are users in the authentication model or are linked to a user
account.

Therefore notification ownership should remain based on the canonical
User identity.

Example:

```text
User
 └── Vendor Profile
       └── Notification
```

The exact Vendor/User relationship is defined by the Identity and Vendor
domains.

---

# 47. Index Strategy

Initial indexes should include:

```text
Notification
├── PRIMARY KEY (id)
├── INDEX (userId, status, createdAt)
├── INDEX (userId, createdAt)
├── INDEX (type, createdAt)
└── INDEX (expiresAt)
```

The most important query pattern is:

```text
userId + status + createdAt
```

because the application will frequently retrieve unread and recent
notifications for the authenticated user.

---

# 48. Referential Integrity

The database must enforce:

```text
Notification → User
```

Future delivery records will enforce:

```text
NotificationDelivery → Notification
```

The application layer determines:

```text
Which user should receive the notification
```

based on the originating business event.

---

# 49. Soft Delete / Historical Preservation

Notifications should not normally be physically deleted when a user
marks them as read.

Read state is represented by:

```text
status = READ
```

Historical records may later be removed according to a retention policy.

---

# 50. Complete Notification Entity Map

```text
                         ┌──────────────┐
                         │     User     │
                         └──────┬───────┘
                                │
                                │ 1:N
                                ▼
                     ┌────────────────────┐
                     │   Notification     │
                     ├────────────────────┤
                     │ type               │
                     │ title              │
                     │ message            │
                     │ data               │
                     │ status             │
                     │ readAt             │
                     └─────────┬──────────┘
                               │
                               │ future 1:N
                               ▼
                    ┌──────────────────────┐
                    │ NotificationDelivery │
                    ├──────────────────────┤
                    │ channel              │
                    │ status               │
                    │ provider             │
                    └──────────────────────┘


Domain Events
     │
     ├── Order
     ├── Payment
     ├── Refund
     ├── Wallet
     ├── Review
     └── Promotion
             │
             ▼
      NotificationService
             │
             ▼
        Notification
```

---

# 51. Design Decisions

| Decision                                          | Reason                              |
| ------------------------------------------------- | ----------------------------------- |
| Notification belongs to User                      | Clear recipient ownership           |
| In-app notification supported initially           | Core marketplace requirement        |
| Read state stored in DB                           | Reliable user state                 |
| `readAt` stored                                   | Auditability                        |
| Structured JSON data                              | Flexible contextual payload         |
| Notification content stored as snapshot           | Historical consistency              |
| Domain events drive notifications                 | Loose coupling                      |
| BullMQ handles async processing                   | Retryable background work           |
| Redis is not authoritative                        | Durable state remains in PostgreSQL |
| Delivery state separated from read state          | Correct channel semantics           |
| Notification preferences separated                | Keeps delivery policy independent   |
| Client cannot create system notifications         | Security                            |
| Client cannot access another user's notifications | Authorization                       |
| Notification type identifies business event       | Stable semantic identifier          |
| Historical notifications retained                 | Support and auditability            |
| Bulk notifications deferred                       | Avoids premature complexity         |

---

# 52. Future Extensions

The following are intentionally outside the initial implementation:

```text
NotificationPreference
NotificationDelivery
NotificationTemplate
NotificationLocalization
NotificationModeration
Announcement
AnnouncementRecipient
PushSubscription
EmailDelivery
SmsDelivery
WebsocketDelivery
NotificationDigest
NotificationPriority
NotificationArchive
NotificationEvent
```

These can be introduced when the corresponding delivery requirements
appear.

---

# 53. Implementation Status

```text
Notification architecture             APPROVED
Notification ownership                APPROVED
Read/unread model                     APPROVED
Notification type model               APPROVED
Event-driven architecture             APPROVED
BullMQ integration strategy           APPROVED
Delivery separation                   APPROVED
Security requirements                 APPROVED

Prisma models                         NOT IMPLEMENTED
Database migration                    NOT CREATED
Notification APIs                    NOT IMPLEMENTED
Notification service                 NOT IMPLEMENTED
BullMQ workers                       NOT IMPLEMENTED
Email delivery                       NOT IMPLEMENTED
Push delivery                        NOT IMPLEMENTED
WebSocket delivery                   NOT IMPLEMENTED
Notification preferences              NOT IMPLEMENTED
Tests                                 NOT IMPLEMENTED
```

> This document defines the initial Notification database architecture.
> Prisma models, migrations, notification services, event handlers,
> BullMQ workers, delivery channels, preferences, APIs, and tests will be
> implemented after the complete database architecture has been finalized.

The Notification domain stores the durable application-level notification
state, while Redis/BullMQ and external providers are responsible for
asynchronous processing and delivery.

````
