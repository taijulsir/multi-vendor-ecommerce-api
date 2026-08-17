অবশ্যই। এবার **পুরো `docs/database/identity-access.md`** একসাথে দিচ্ছি। এটা সরাসরি file-এ copy-paste করবে।

````md
# Identity & Access Database Architecture

## Overview

The Identity & Access domain provides the authentication and authorization
foundation of the multi-vendor e-commerce platform.

This domain is responsible for:

- User identity
- User authentication data
- Role-based access control (RBAC)
- Roles
- Permissions
- User-to-role assignment
- Role-to-permission assignment

### Core Entities

- User
- Role
- Permission
- UserRole
- RolePermission

---

# 1. User

## Purpose

The `User` entity represents the base authenticated identity of the system.

A user can represent:

- Customer
- Vendor account owner
- Administrator
- Other future platform roles

The user identity is separated from business-specific entities such as
`Vendor`, allowing the same authentication system to support different
types of platform users.

---

## Fields

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `id` | UUID | Yes | Generated | Primary key |
| `email` | String | Yes | — | Unique and normalized |
| `passwordHash` | String | Yes | — | Sensitive; never expose |
| `firstName` | String | Yes | — | Primary user name |
| `lastName` | String | No | `null` | Optional surname |
| `phone` | String | No | `null` | Optional phone number |
| `avatarUrl` | String | No | `null` | Profile image URL |
| `status` | Enum | Yes | `ACTIVE` | Account lifecycle status |
| `emailVerifiedAt` | DateTime | No | `null` | Email verification timestamp |
| `lastLoginAt` | DateTime | No | `null` | Most recent successful login |
| `createdAt` | DateTime | Yes | Current timestamp | Creation timestamp |
| `updatedAt` | DateTime | Yes | Auto-updated | Last update timestamp |
| `deletedAt` | DateTime | No | `null` | Soft-delete timestamp |

---

## User Status

The initial user account statuses are:

```text
ACTIVE
SUSPENDED
BLOCKED
````

### ACTIVE

The user can authenticate and use features allowed by their roles.

### SUSPENDED

The account is temporarily restricted.

### BLOCKED

The account is prevented from normal platform access.

---

## Constraints

### Primary Key

```text
id
```

### Unique Constraint

```text
email
```

### Index

```text
status
```

Additional indexes will be added only when justified by actual query
patterns.

---

## Email Normalization

Email addresses will be normalized at the application layer.

Example:

```text
Taijul@Example.com
```

will be normalized to:

```text
taijul@example.com
```

before persistence and authentication comparison.

The database will enforce uniqueness on the normalized value.

---

## Password Security

The database will never store a plain-text password.

Only a password hash will be stored:

```text
password
   ↓
password hashing algorithm
   ↓
passwordHash
   ↓
PostgreSQL
```

The `passwordHash` field must never be included in normal API responses.

Password hashing and verification will be handled by the authentication
layer.

---

## User Name Design

`firstName` is required because every user should have a primary name.

`lastName` is optional because a surname is not universally required.

We will not maintain a separate `name` field.

Example:

```text
firstName = "Taijul"
lastName  = "Islam"
```

Display name:

```text
Taijul Islam
```

If no last name exists:

```text
firstName = "Taijul"
lastName  = null
```

Display name:

```text
Taijul
```

This avoids storing duplicate name information.

---

## Soft Delete

The `User` entity supports soft deletion through:

```text
deletedAt
```

The user record should not normally be physically deleted because
historical business records may reference the user.

Examples:

* Orders
* Payments
* Reviews
* Wallet-related records
* Notifications
* Audit logs

---

# 2. Role

## Purpose

A `Role` represents a logical group of permissions assigned to a user.

Examples:

```text
ADMIN
VENDOR
CUSTOMER
```

Roles provide the high-level authorization structure of the platform.

---

## Fields

| Field         | Type     | Required | Default           | Notes            |
| ------------- | -------- | -------: | ----------------- | ---------------- |
| `id`          | UUID     |      Yes | Generated         | Primary key      |
| `name`        | String   |      Yes | —                 | Unique role name |
| `description` | String   |       No | `null`            | Role description |
| `createdAt`   | DateTime |      Yes | Current timestamp |                  |
| `updatedAt`   | DateTime |      Yes | Auto-updated      |                  |

---

## Constraints

### Primary Key

```text
id
```

### Unique Constraint

```text
name
```

---

## Initial Roles

The initial platform roles are:

```text
ADMIN
VENDOR
CUSTOMER
```

These are initial seed values, not hardcoded database enums.

---

## Why Role Is a Database Table

Roles will be stored as database records rather than a Prisma enum.

Reason:

```text
Role = database entity
```

instead of:

```text
Role = fixed enum
```

This allows the platform to introduce additional roles in the future
without requiring a database schema migration.

For example:

```text
SUPPORT
MODERATOR
FINANCE_MANAGER
WAREHOUSE_MANAGER
```

could be introduced later.

---

# 3. Permission

## Purpose

A `Permission` represents a specific action that can be performed on a
resource.

A permission follows the conceptual structure:

```text
resource + action
```

Examples:

```text
product:create
product:update
product:delete

order:view
order:update

vendor:freeze
vendor:approve
```

---

## Fields

| Field         | Type     | Required | Default           | Notes                      |
| ------------- | -------- | -------: | ----------------- | -------------------------- |
| `id`          | UUID     |      Yes | Generated         | Primary key                |
| `resource`    | String   |      Yes | —                 | Protected resource         |
| `action`      | String   |      Yes | —                 | Allowed operation          |
| `description` | String   |       No | `null`            | Human-readable description |
| `createdAt`   | DateTime |      Yes | Current timestamp |                            |
| `updatedAt`   | DateTime |      Yes | Auto-updated      |                            |

---

## Permission Examples

```text
product:create
product:update
product:delete
product:view

order:view
order:update
order:cancel

vendor:view
vendor:approve
vendor:suspend
vendor:freeze

user:view
user:update
user:block
```

---

## Constraints

### Primary Key

```text
id
```

### Composite Unique Constraint

The combination below must be unique:

```text
(resource, action)
```

This prevents duplicate permissions such as:

```text
product:create
product:create
```

---

# 4. UserRole

## Purpose

`UserRole` is the join entity between `User` and `Role`.

A user can have multiple roles.

Example:

```text
User
 ├── CUSTOMER
 └── VENDOR
```

This allows the authorization system to support multiple roles for the
same user.

---

## Fields

| Field       | Type     | Required | Notes                |
| ----------- | -------- | -------: | -------------------- |
| `userId`    | UUID     |      Yes | Foreign key → User   |
| `roleId`    | UUID     |      Yes | Foreign key → Role   |
| `createdAt` | DateTime |      Yes | Assignment timestamp |

---

## Primary Key

Composite primary key:

```text
(userId, roleId)
```

This prevents the same role from being assigned to the same user more
than once.

---

## Relationships

```text
User
  │
  └── UserRole
        │
        └── Role
```

---

# 5. RolePermission

## Purpose

`RolePermission` is the join entity between `Role` and `Permission`.

A role can contain multiple permissions.

A permission can be reused across multiple roles.

Example:

```text
ADMIN
 ├── product:create
 ├── product:update
 ├── product:delete
 ├── order:view
 └── vendor:freeze
```

---

## Fields

| Field          | Type     | Required | Notes                    |
| -------------- | -------- | -------: | ------------------------ |
| `roleId`       | UUID     |      Yes | Foreign key → Role       |
| `permissionId` | UUID     |      Yes | Foreign key → Permission |
| `createdAt`    | DateTime |      Yes | Assignment timestamp     |

---

## Primary Key

Composite primary key:

```text
(roleId, permissionId)
```

This prevents duplicate permission assignments.

---

## Relationships

```text
Role
  │
  └── RolePermission
        │
        └── Permission
```

---

# 6. Complete RBAC Relationship

The complete authorization structure is:

```text
                    ┌──────────────┐
                    │     User     │
                    └──────┬───────┘
                           │
                       UserRole
                           │
                           ▼
                    ┌──────────────┐
                    │     Role     │
                    └──────┬───────┘
                           │
                    RolePermission
                           │
                           ▼
                    ┌──────────────┐
                    │  Permission  │
                    └──────────────┘
```

Conceptually:

```text
User
  ↓
Role
  ↓
Permission
```

The join tables implement the many-to-many relationships:

```text
User ↔ Role
Role ↔ Permission
```

---

# 7. RBAC Example

Suppose a user has the role:

```text
VENDOR
```

The role may have:

```text
product:create
product:update
product:view

order:view
order:update
```

The authorization flow becomes:

```text
Request
   ↓
Authenticated User
   ↓
UserRole
   ↓
VENDOR Role
   ↓
RolePermission
   ↓
Required Permission
   ↓
Allow / Deny
```

Example:

```text
POST /api/products
```

Required permission:

```text
product:create
```

The authorization layer verifies whether the authenticated user's role
contains that permission.

---

# 8. Business Rules

## User

* Email must be unique.
* Email is normalized before storage.
* `firstName` is required.
* `lastName` is optional.
* Passwords are never stored in plain text.
* `passwordHash` must never be exposed through API responses.
* User accounts support lifecycle statuses.
* User records support soft deletion.

## Role

* Role names must be unique.
* Roles are database records.
* Initial roles are `ADMIN`, `VENDOR`, and `CUSTOMER`.
* Additional roles can be added later.

## Permission

* `(resource, action)` must be unique.
* Permissions should represent atomic actions.
* Permissions can be reused across multiple roles.

## UserRole

* A user can have multiple roles.
* The same role cannot be assigned twice to the same user.

## RolePermission

* A role can have multiple permissions.
* A permission can belong to multiple roles.
* The same permission cannot be assigned twice to the same role.

---

# 9. Delete Behavior

## User

User records should normally use soft deletion.

```text
deletedAt
```

Hard deletion should not be used casually because historical business
records may reference users.

## Role

Roles should generally not be hard-deleted if they are referenced by
existing users.

A future implementation may introduce an `isActive` field if role
deactivation becomes necessary.

## Permission

Permissions should not normally be hard-deleted if referenced by roles.

A future implementation may introduce an `isActive` field if permission
deactivation is required.

## UserRole

Removing a user-role assignment deletes the relationship, not the user
or role.

## RolePermission

Removing a role-permission assignment deletes the relationship, not the
role or permission.

---

# 10. Security Considerations

## Password

Never store:

```text
password
```

Store only:

```text
passwordHash
```

Password hashing will be handled by the authentication layer.

---

## Sensitive Fields

The following field must be treated as sensitive:

```text
passwordHash
```

It must not appear in:

* API responses
* Logs
* Debug output
* Error messages
* Audit metadata

---

## Authorization

Authentication answers:

```text
"Who is this user?"
```

Authorization answers:

```text
"What is this user allowed to do?"
```

The RBAC system is responsible for the second question.

---

# 11. Index Strategy

Initial indexes:

```text
User
 ├── PRIMARY KEY (id)
 ├── UNIQUE (email)
 └── INDEX (status)

Role
 ├── PRIMARY KEY (id)
 └── UNIQUE (name)

Permission
 ├── PRIMARY KEY (id)
 └── UNIQUE (resource, action)

UserRole
 └── PRIMARY KEY (userId, roleId)

RolePermission
 └── PRIMARY KEY (roleId, permissionId)
```

Additional indexes will only be introduced when justified by query
patterns or measured performance requirements.

---

# 12. Future Extensions

The current design intentionally leaves room for future features.

Potential future additions include:

```text
Role.isActive
Permission.isActive

User.twoFactorEnabled
User.twoFactorSecret

UserSession
RefreshToken
LoginAttempt

Role hierarchy
Permission groups
Organization-level permissions
```

These are not part of the initial schema unless required by the final
authentication and authorization architecture.

---

# 13. Design Decisions Summary

| Decision                    | Reason                                                  |
| --------------------------- | ------------------------------------------------------- |
| UUID primary keys           | Suitable for distributed systems and public identifiers |
| `firstName` required        | Every user needs a primary name                         |
| `lastName` optional         | Surname is not universally required                     |
| Email unique                | Prevent duplicate accounts                              |
| Email normalized            | Consistent authentication and uniqueness                |
| Password stored as hash     | Security requirement                                    |
| Role as table               | Allows dynamic future roles                             |
| Permission as table         | Reusable granular authorization                         |
| UserRole join table         | Supports multiple roles per user                        |
| RolePermission join table   | Supports reusable permissions                           |
| Soft-delete users           | Preserve historical business relationships              |
| Composite PKs on joins      | Prevent duplicate relationships                         |
| `(resource, action)` unique | Prevent duplicate permissions                           |

---

# 14. Final Entity Map

```text
┌────────────────────┐
│       User         │
├────────────────────┤
│ id                 │
│ email              │
│ passwordHash       │
│ firstName          │
│ lastName           │
│ phone              │
│ avatarUrl          │
│ status             │
│ emailVerifiedAt    │
│ lastLoginAt        │
│ createdAt          │
│ updatedAt          │
│ deletedAt          │
└─────────┬──────────┘
          │
          │ 1:N
          ▼
┌────────────────────┐
│     UserRole       │
├────────────────────┤
│ userId             │
│ roleId             │
│ createdAt          │
└─────────┬──────────┘
          │
          │ N:1
          ▼
┌────────────────────┐
│       Role         │
├────────────────────┤
│ id                 │
│ name               │
│ description        │
│ createdAt          │
│ updatedAt          │
└─────────┬──────────┘
          │
          │ 1:N
          ▼
┌────────────────────┐
│  RolePermission    │
├────────────────────┤
│ roleId             │
│ permissionId       │
│ createdAt          │
└─────────┬──────────┘
          │
          │ N:1
          ▼
┌────────────────────┐
│    Permission      │
├────────────────────┤
│ id                 │
│ resource           │
│ action             │
│ description        │
│ createdAt          │
│ updatedAt          │
└────────────────────┘
```

---

# 15. Implementation Status

```text
Architecture design       ✅ Approved
Database tables            ⏳ Not created
Prisma models              ⏳ Not created
Migration                  ⏳ Not created
Seed data                  ⏳ Not created
API implementation         ⏳ Not started
Tests                      ⏳ Not started
```

> The database schema will be implemented only after the remaining
> domain specifications are reviewed and approved.

This document represents the approved Identity & Access architecture
for the initial multi-vendor e-commerce implementation.

```
