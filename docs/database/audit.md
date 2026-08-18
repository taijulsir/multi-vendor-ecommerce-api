# Audit and Activity Database Architecture

## Overview

The Audit and Activity domain records important system and administrative
actions for traceability, security, debugging, compliance, and operational
investigation.

This domain is responsible for recording:

- Administrative actions
- Sensitive state changes
- Authentication/security events
- Financial administrative actions
- Vendor status changes
- Order state changes where auditability is required
- Promotion changes
- Moderation actions
- Permission/role changes
- Important system operations

The Audit domain is separate from:

- Application logs
- Error logs
- Notification records
- Business entities
- Financial transaction ledgers

An audit record explains:

```text
WHO performed an action
WHAT happened
WHEN it happened
WHERE it originated from
WHICH resource was affected
````

---

# 1. Audit vs Application Logs

Application logs and audit records have different purposes.

Application logs are primarily used for:

* Debugging
* Runtime diagnostics
* Errors
* Performance investigation

Audit records are primarily used for:

* Security investigation
* Administrative accountability
* Business state history
* Financial investigation
* Compliance
* User support

Example application log:

```text
ERROR: Failed to update vendor
```

Example audit record:

```text
Admin USER-123
FROZE
Vendor VENDOR-456
Reason: Policy violation
```

---

# 2. High-Level Architecture

```text
User/Admin/System
       │
       ▼
Application Service
       │
       ▼
AuditService
       │
       ▼
AuditLog
       │
       ├── Actor
       ├── Action
       ├── Resource
       ├── Metadata
       └── Timestamp
```

The AuditService should be called from the appropriate application/domain
service after a meaningful action is successfully completed.

---

# 3. AuditLog

## Purpose

`AuditLog` represents an immutable record of an important system action.

Examples:

```text
Vendor frozen
Vendor unfrozen
Admin changed user role
Promotion activated
Promotion cancelled
Review rejected
Wallet manually adjusted
Order manually cancelled
Account suspended
Password changed
Security settings changed
```

---

# 4. AuditLog Fields

| Field          | Type        | Required | Default           | Notes                             |
| -------------- | ----------- | -------: | ----------------- | --------------------------------- |
| `id`           | UUID        |      Yes | Generated         | Primary key                       |
| `actorUserId`  | UUID        |       No | `null`            | User who performed the action     |
| `actorType`    | Enum        |      Yes | —                 | USER / ADMIN / SYSTEM             |
| `action`       | Enum/String |      Yes | —                 | Action performed                  |
| `resourceType` | String      |      Yes | —                 | Affected resource type            |
| `resourceId`   | UUID/String |       No | `null`            | Affected resource ID              |
| `description`  | String      |       No | `null`            | Human-readable description        |
| `metadata`     | JSON        |       No | `{}`              | Additional structured information |
| `ipAddress`    | String      |       No | `null`            | Request IP when available         |
| `userAgent`    | String      |       No | `null`            | Client information when available |
| `createdAt`    | DateTime    |      Yes | Current timestamp | Immutable timestamp               |

---

# 5. Actor Type

Initial actor types:

```text
USER
ADMIN
SYSTEM
```

## USER

Normal authenticated user action.

## ADMIN

Administrative action performed by an authorized administrator.

## SYSTEM

Automated action performed by the backend or background worker.

Example:

```text
BullMQ worker
    ↓
Automatically releases settlement
    ↓
SYSTEM audit record
```

---

# 6. Actor Identity

When an action is performed by an authenticated user:

```text
actorUserId
```

should reference the canonical User.

For system-generated actions:

```text
actorType = SYSTEM
actorUserId = null
```

The audit record must not require a fake system user.

---

# 7. Audit Action

The action identifies what happened.

Initial examples:

```text
CREATE
UPDATE
DELETE
ACTIVATE
DEACTIVATE
FREEZE
UNFREEZE
SUSPEND
RESTORE
APPROVE
REJECT
CANCEL
COMPLETE
LOGIN
LOGOUT
PASSWORD_CHANGE
ROLE_CHANGE
PERMISSION_CHANGE
FINANCIAL_ADJUSTMENT
REFUND_APPROVAL
WITHDRAWAL_APPROVAL
```

The list can be extended as new domains require auditable actions.

---

# 8. Resource Type

`resourceType` identifies the affected domain entity.

Examples:

```text
USER
VENDOR
SHOP
PRODUCT
ORDER
PAYMENT
REFUND
WALLET
WALLET_TRANSACTION
PROMOTION
COUPON
REVIEW
NOTIFICATION
```

The initial implementation may use a string rather than a database enum
to make future domain expansion easier.

---

# 9. Resource ID

`resourceId` identifies the affected entity.

Example:

```text
resourceType = VENDOR
resourceId   = vendor-uuid
```

Another example:

```text
resourceType = REVIEW
resourceId   = review-uuid
```

This creates a generic audit relationship without requiring a separate
foreign key for every possible resource type.

---

# 10. Why Resource ID Is Not a Foreign Key

Audit logs can reference many different entity types.

A polymorphic reference such as:

```text
resourceType
resourceId
```

cannot be represented as a normal relational foreign key to multiple
tables.

Therefore the AuditLog keeps the reference generic.

The application layer is responsible for ensuring that the resource
reference is valid.

---

# 11. Audit Description

`description` provides a human-readable explanation.

Example:

```text
Admin froze vendor due to policy violation.
```

The description should not be the only source of structured information.

Important values should also exist in `metadata`.

---

# 12. Audit Metadata

`metadata` stores structured contextual information.

Example:

```json
{
  "reason": "Policy violation",
  "previousStatus": "ACTIVE",
  "newStatus": "FROZEN"
}
```

Another example:

```json
{
  "amount": "500",
  "currency": "BDT",
  "adjustmentType": "CREDIT"
}
```

Metadata should contain useful investigation context without storing
unnecessary sensitive information.

---

# 13. Sensitive Data

Audit logs must not store sensitive credentials or secrets.

The system must never store:

* Passwords
* Password hashes
* JWT access tokens
* Refresh tokens
* API secrets
* Payment card numbers
* Private encryption keys
* Authentication cookies

Metadata must be explicitly reviewed before sensitive information is
recorded.

---

# 14. IP Address

When available, the audit record may store:

```text
ipAddress
```

This can help investigate:

* Suspicious login activity
* Administrative actions
* Account security incidents
* Fraud investigations

The system must follow applicable privacy and data-retention policies.

---

# 15. User Agent

When available:

```text
userAgent
```

may be stored to provide additional investigation context.

Example:

```text
Mozilla/5.0 ...
```

User-agent data should not be treated as a trusted identity signal.

---

# 16. Audit Immutability

Audit logs are immutable.

The system must not normally:

* Update audit records
* Delete individual audit records
* Rewrite historical audit history

If additional information is required, a new audit event should be
created.

---

# 17. Audit Creation Timing

Audit records should normally be created after the corresponding
business operation succeeds.

Example:

```text
BEGIN TRANSACTION

1. Freeze vendor
2. Commit vendor status change
3. Create audit record

```

Where audit creation is required to be atomic with the business
operation, both should occur inside the same database transaction.

The exact transaction boundary depends on the operation.

---

# 18. Transactional Audit Example

For a critical administrative change:

```text
BEGIN TRANSACTION

1. Read Vendor
2. Validate authorization
3. Change Vendor status
4. Create AuditLog
5. COMMIT
```

If any step fails:

```text
ROLLBACK
```

This prevents the system from recording an action that never actually
occurred.

---

# 19. System-Generated Audit

Background workers may generate audit records.

Example:

```text
BullMQ
  ↓
Settlement Worker
  ↓
Vendor earnings released
  ↓
SYSTEM AuditLog
```

Example:

```text
actorType = SYSTEM
action = COMPLETE
resourceType = SETTLEMENT
resourceId = settlement-uuid
```

---

# 20. Administrative Audit

Administrative actions should be strongly auditable.

Examples:

```text
Admin freezes vendor
Admin unfreezes vendor
Admin rejects review
Admin changes promotion
Admin adjusts wallet
Admin approves refund
Admin changes user role
```

These actions should always include the authenticated admin identity.

---

# 21. Financial Audit

Financial administrative actions require special auditability.

Example:

```text
Admin
 ↓
Wallet adjustment
 ↓
WalletTransaction
 ↓
AuditLog
```

The WalletTransaction remains the authoritative financial ledger.

AuditLog provides the administrative context.

For example:

```text
WalletTransaction:
+500 BDT

AuditLog:
Admin USER-123 created manual adjustment
Reason: Settlement correction
```

---

# 22. Audit vs WalletTransaction

These are not interchangeable.

`WalletTransaction` answers:

```text
What financial movement occurred?
```

`AuditLog` answers:

```text
Who caused or authorized the financial action?
Why?
When?
```

Both may exist for the same financial operation.

---

# 23. Audit vs Order History

Order status history may be a dedicated domain-specific entity.

For example:

```text
OrderStatusHistory
```

answers:

```text
What status did the order move through?
```

AuditLog may additionally record:

```text
Admin manually cancelled the order
```

Therefore domain history and generic audit history can coexist.

---

# 24. Audit vs Notification

A notification tells a user:

```text
Your order has shipped.
```

An audit log records:

```text
Order status changed from PROCESSING to SHIPPED.
```

The notification is user-facing communication.

The audit log is internal traceability.

---

# 25. Authentication Audit Events

Security-sensitive authentication actions should be auditable.

Examples:

```text
LOGIN
LOGOUT
LOGIN_FAILED
PASSWORD_CHANGE
PASSWORD_RESET
ACCOUNT_LOCKED
ACCOUNT_UNLOCKED
MFA_ENABLED
MFA_DISABLED
```

Some of these may eventually be stored in a dedicated security-event
table if security requirements become more advanced.

---

# 26. Failed Authentication Events

Failed authentication attempts can be recorded separately from successful
user actions.

Example:

```text
LOGIN_FAILED
actorType = USER
actorUserId = null
metadata:
{
  "identifier": "masked-email",
  "reason": "invalid_credentials"
}
```

Sensitive credentials must never be stored.

---

# 27. Role and Permission Changes

Changes to authorization configuration should be audited.

Example:

```text
Admin USER-123
changed role of USER-456

Previous:
CUSTOMER

New:
VENDOR
```

Metadata:

```json
{
  "previousRole": "CUSTOMER",
  "newRole": "VENDOR"
}
```

---

# 28. Vendor Status Changes

Vendor lifecycle changes should be auditable.

Examples:

```text
ACTIVE
FROZEN
SUSPENDED
REJECTED
APPROVED
```

Example audit metadata:

```json
{
  "previousStatus": "ACTIVE",
  "newStatus": "FROZEN",
  "reason": "Policy violation"
}
```

---

# 29. Product Administrative Changes

Important product changes may be audited.

Examples:

```text
Product approved
Product rejected
Product hidden
Product unpublished
Product ownership changed
Product pricing changed
```

Not every normal product update must necessarily create a generic audit
record.

The implementation should focus on meaningful administrative or sensitive
actions.

---

# 30. Promotion Audit

Promotion lifecycle changes should be auditable.

Examples:

```text
Promotion created
Promotion activated
Promotion paused
Promotion cancelled
Coupon disabled
```

Example:

```text
Admin USER-123
ACTIVATE
Promotion PROMO-456
```

---

# 31. Review Moderation Audit

Review moderation actions should be auditable.

Example:

```text
Admin
 ↓
Reject Review
 ↓
Review status:
PENDING → REJECTED
 ↓
AuditLog
```

Metadata may include:

```json
{
  "previousStatus": "PENDING",
  "newStatus": "REJECTED",
  "reason": "Inappropriate content"
}
```

---

# 32. Refund Audit

Important refund decisions should be auditable.

Examples:

```text
REFUND_REQUESTED
REFUND_APPROVED
REFUND_REJECTED
REFUND_CANCELLED
```

The Refund entity remains the business source of truth.

AuditLog records the actor and administrative context.

---

# 33. Withdrawal Audit

Administrative withdrawal decisions should be auditable.

Examples:

```text
WITHDRAWAL_APPROVED
WITHDRAWAL_REJECTED
WITHDRAWAL_CANCELLED
```

The Withdrawal domain remains responsible for the actual withdrawal state.

---

# 34. Audit Search

The admin system should eventually support filtering audit records by:

```text
actor
action
resourceType
resourceId
date range
```

Example:

```text
All actions performed by Admin USER-123
```

or:

```text
All actions affecting Vendor VENDOR-456
```

---

# 35. Audit Query Patterns

Common queries:

```text
WHERE actorUserId = ?
ORDER BY createdAt DESC
```

```text
WHERE resourceType = ?
AND resourceId = ?
ORDER BY createdAt DESC
```

```text
WHERE action = ?
ORDER BY createdAt DESC
```

```text
WHERE createdAt BETWEEN ? AND ?
ORDER BY createdAt DESC
```

Indexes should support these access patterns.

---

# 36. Audit Retention

Audit records should have a defined retention policy.

The initial implementation should retain audit records rather than
deleting them during normal application operations.

Future retention policies may archive old records.

---

# 37. Audit Pagination

Audit APIs must use pagination.

The system should not attempt to load the entire audit table into memory.

Cursor-based pagination may be preferred for large datasets.

Example:

```text
createdAt DESC
id DESC
```

can provide stable ordering.

---

# 38. Audit Access Control

Audit logs are sensitive internal information.

Normal customers must not have access to the global audit log.

Access should be limited to authorized administrative roles.

Example:

```text
SUPER_ADMIN
ADMIN_AUDITOR
```

The exact RBAC model will be finalized in the authorization layer.

---

# 39. Audit Data Exposure

Even authorized administrators should only see fields appropriate to
their role.

The system must avoid exposing:

* Password hashes
* Tokens
* API secrets
* Payment credentials
* Private encryption data

Audit metadata must be sanitized before persistence.

---

# 40. Audit Service

Controllers should not directly create AuditLog records.

Instead:

```text
Controller
   ↓
Domain/Application Service
   ↓
Business Operation
   ↓
AuditService
   ↓
AuditLog
```

This ensures that audit creation follows consistent rules.

---

# 41. Audit Service Interface

Conceptually:

```text
AuditService.log({
  actorUserId,
  actorType,
  action,
  resourceType,
  resourceId,
  description,
  metadata,
  ipAddress,
  userAgent
})
```

The exact implementation and DTO structure will be defined during the
service layer phase.

---

# 42. Audit Event Example

Example:

```json
{
  "actorUserId": "admin-uuid",
  "actorType": "ADMIN",
  "action": "FREEZE",
  "resourceType": "VENDOR",
  "resourceId": "vendor-uuid",
  "description": "Vendor account frozen",
  "metadata": {
    "previousStatus": "ACTIVE",
    "newStatus": "FROZEN",
    "reason": "Policy violation"
  }
}
```

---

# 43. Audit and Event-Driven Architecture

Not every audit event needs to be processed asynchronously.

For critical state transitions, the audit record may be created inside
the same database transaction.

For high-volume non-critical events, asynchronous processing may be
appropriate.

Example:

```text
Business Operation
       │
       ├── Critical Audit → PostgreSQL transaction
       │
       └── Secondary Event → BullMQ
```

The implementation should choose the correct consistency level for each
event.

---

# 44. Redis and BullMQ

Redis/BullMQ may support:

* Asynchronous audit processing
* Log aggregation
* Security event processing
* Audit export jobs
* Archive jobs

However:

```text
Redis ≠ Audit source of truth
BullMQ ≠ Audit source of truth
```

PostgreSQL remains authoritative for persisted audit records.

---

# 45. Audit Idempotency

Asynchronous audit events must be idempotent.

A future event identity may contain:

```text
eventId
```

so that a retried job does not create duplicate audit records.

The exact event infrastructure will be finalized during the application
architecture phase.

---

# 46. Audit Event Metadata

Metadata should contain context that helps investigation.

Good examples:

```json
{
  "previousStatus": "ACTIVE",
  "newStatus": "FROZEN",
  "reason": "Policy violation"
}
```

Bad examples:

```json
{
  "password": "secret",
  "accessToken": "jwt..."
}
```

Sensitive values must never be logged.

---

# 47. Audit Index Strategy

Initial indexes should include:

```text
AuditLog
├── PRIMARY KEY (id)
├── INDEX (actorUserId, createdAt)
├── INDEX (resourceType, resourceId, createdAt)
├── INDEX (action, createdAt)
└── INDEX (createdAt)
```

The most important investigation query is:

```text
resourceType + resourceId + createdAt
```

because administrators frequently need to inspect the history of a
specific resource.

---

# 48. Referential Integrity

The database should enforce:

```text
AuditLog.actorUserId → User
```

when `actorUserId` is present.

`resourceId` remains a polymorphic reference and therefore cannot use a
normal foreign key to all possible resources.

---

# 49. Audit Record Immutability

The application must not expose normal APIs that allow:

```text
PATCH /audit-logs/:id
DELETE /audit-logs/:id
```

Audit records are append-only.

Administrative correction of an audit interpretation should result in a
new audit record rather than rewriting history.

---

# 50. Complete Audit Entity Map

```text
                         ┌──────────────┐
                         │     User     │
                         └──────┬───────┘
                                │
                                │ actor
                                ▼
                       ┌────────────────┐
                       │    AuditLog    │
                       ├────────────────┤
                       │ actorType      │
                       │ action         │
                       │ resourceType   │
                       │ resourceId     │
                       │ description    │
                       │ metadata       │
                       │ ipAddress      │
                       │ userAgent      │
                       │ createdAt      │
                       └───────┬────────┘
                               │
                               │ references
                               ▼
                  ┌──────────────────────────┐
                  │ Any Auditable Resource   │
                  ├──────────────────────────┤
                  │ User                     │
                  │ Vendor                   │
                  │ Product                  │
                  │ Order                    │
                  │ Refund                   │
                  │ Wallet                   │
                  │ Promotion                │
                  │ Review                   │
                  │ Withdrawal               │
                  └──────────────────────────┘
```

---

# 51. Design Decisions

| Decision                              | Reason                                                  |
| ------------------------------------- | ------------------------------------------------------- |
| AuditLog is append-only               | Preserves historical accountability                     |
| Actor identity stored                 | Identifies who performed the action                     |
| SYSTEM actor supported                | Supports automated workflows                            |
| Generic resource reference            | Supports many domains without excessive schema coupling |
| Metadata stored as JSON               | Flexible contextual information                         |
| Sensitive data prohibited             | Prevents security leakage                               |
| Audit separated from application logs | Different operational purposes                          |
| Audit separated from financial ledger | Different sources of truth                              |
| Critical audits can be transactional  | Prevents false audit records                            |
| Async processing supported            | Handles high-volume events                              |
| Admin access restricted               | Audit data is sensitive                                 |
| Resource/action indexed               | Supports investigation queries                          |
| Historical records retained           | Supports compliance and debugging                       |
| No normal update/delete APIs          | Protects audit integrity                                |

---

# 52. Future Extensions

The following are intentionally outside the initial implementation:

```text
AuditEvent
SecurityEvent
AuditExport
AuditArchive
AuditRetentionPolicy
AuditDiff
AuditActorSnapshot
AdminActionHistory
LoginAttempt
SecurityAlert
ComplianceEvent
```

These can be introduced if security or compliance requirements expand.

---

# 53. Implementation Status

```text
Audit architecture                  APPROVED
Actor model                         APPROVED
Resource model                      APPROVED
Audit immutability                  APPROVED
Administrative audit model          APPROVED
Financial audit model               APPROVED
Security audit model                APPROVED
Access control requirements         APPROVED
Retention strategy                  APPROVED

Prisma models                       IMPLEMENTED (schema only — no application layer)
Database migration                  CREATED
AuditService                        NOT IMPLEMENTED
Audit APIs                          NOT IMPLEMENTED
Security event processing           NOT IMPLEMENTED
BullMQ integration                  NOT IMPLEMENTED
Audit export                        NOT IMPLEMENTED
Tests                               NOT IMPLEMENTED
```

> This document defines the initial Audit and Activity architecture.
> Prisma models, migrations, AuditService, event integration, security
> event processing, APIs, retention jobs, exports, and tests will be
> implemented after the complete database architecture has been finalized.

The Audit domain is an append-only accountability layer. Business domains
remain the source of truth for their own state, while AuditLog records
important actions and state transitions for traceability.

````
