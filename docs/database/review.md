# Review and Rating Database Architecture

## Overview

The Review and Rating domain manages customer feedback and ratings for
products purchased through the marketplace.

This domain is responsible for:

- Product reviews
- Product ratings
- Verified purchase validation
- Review ownership
- One-review-per-order-item rules
- Review moderation
- Review status
- Vendor/product relationship validation
- Rating aggregation
- Review timestamps
- Optional review media references

The Review domain is separate from:

- Product
- Order
- OrderItem
- User
- Vendor
- Media/Storage

The Order domain proves that a customer purchased a product.

The Review domain stores the customer's feedback about that purchase.

---

# 1. High-Level Architecture

The core relationship is:

```text
User
 │
 └── OrderItem
       │
       └── Review
             │
             └── Product
````

Conceptually:

```text
Customer
   │
   ▼
Completed Order
   │
   ▼
Purchased Product
   │
   ▼
Eligible for Review
   │
   ▼
Review
   │
   ├── Rating
   ├── Comment
   └── Moderation Status
```

---

# 2. Why Review Must Be Connected to OrderItem

A review should represent feedback from an actual purchase.

Therefore a Review should reference the relevant `OrderItem`.

Example:

```text
Order #ORD-001
   │
   └── OrderItem
        Product A × 1
             │
             ▼
          Review
```

This allows the system to verify:

* The user purchased the product
* The order belongs to the user
* The order item belongs to the product
* The purchase reached the required state
* The review has not already been submitted

---

# 3. Review

## Purpose

`Review` represents a customer's submitted feedback for a purchased
product.

---

# 4. Review Fields

| Field                | Type     | Required | Default           | Notes                          |
| -------------------- | -------- | -------: | ----------------- | ------------------------------ |
| `id`                 | UUID     |      Yes | Generated         | Primary key                    |
| `userId`             | UUID     |      Yes | —                 | FK → User                      |
| `productId`          | UUID     |      Yes | —                 | FK → Product                   |
| `orderItemId`        | UUID     |      Yes | —                 | FK → OrderItem                 |
| `rating`             | Integer  |      Yes | —                 | Rating value                   |
| `title`              | String   |       No | `null`            | Review title                   |
| `comment`            | String   |       No | `null`            | Review body                    |
| `status`             | Enum     |      Yes | `PENDING`         | Moderation state               |
| `isVerifiedPurchase` | Boolean  |      Yes | `true`            | Purchase verification snapshot |
| `createdAt`          | DateTime |      Yes | Current timestamp |                                |
| `updatedAt`          | DateTime |      Yes | Auto-updated      |                                |
| `publishedAt`        | DateTime |       No | `null`            | Publication timestamp          |

---

# 5. Rating

The initial rating scale is:

```text
1
2
3
4
5
```

Therefore:

```text
rating >= 1
rating <= 5
```

must be enforced by application-level validation and, where practical,
database constraints.

Fractional ratings are not supported initially.

Example:

```text
5 → valid
4 → valid
1 → valid

4.5 → invalid
0 → invalid
6 → invalid
```

---

# 6. Review Status

Initial statuses:

```text
PENDING
PUBLISHED
REJECTED
HIDDEN
```

## PENDING

Review has been submitted but is awaiting moderation or automated
processing.

## PUBLISHED

Review is publicly visible.

## REJECTED

Review was rejected during moderation.

## HIDDEN

Review was previously published or accepted but is currently hidden.

---

# 7. Verified Purchase

A Review should normally be created only from a valid OrderItem.

The service layer must verify:

```text
Review.userId
      ↓
OrderItem
      ↓
VendorOrder
      ↓
MasterOrder
      ↓
User
```

and:

```text
Review.productId
      ↓
OrderItem.productId
```

The product relationship must match.

---

# 8. Review Eligibility

The user should generally be eligible to review only after the relevant
purchase reaches the required fulfillment state.

Initial rule:

```text
VendorOrder.status = DELIVERED
```

or the equivalent final delivery state defined by the Order domain.

The exact eligibility timing can later be changed to:

```text
COMPLETED
```

if business rules require it.

---

# 9. One Review Per Order Item

The initial architecture allows one review per purchased OrderItem.

Constraint:

```text
UNIQUE(orderItemId)
```

This prevents:

```text
OrderItem A
   ├── Review 1
   ├── Review 2
   └── Review 3
```

from being created.

Instead:

```text
OrderItem A
   └── Review 1
```

is the initial model.

---

# 10. Why OrderItem Instead of Only Product

A user may purchase the same product multiple times.

Example:

```text
Order A
└── Product X

Order B
└── Product X
```

The customer may legitimately review each purchase depending on business
rules.

Therefore tying the Review directly to only:

```text
userId + productId
```

would unnecessarily prevent multiple legitimate purchase experiences.

The OrderItem provides the purchase-level identity.

---

# 11. Review Ownership

A user may only create, update, or delete their own review according to
the configured review policy.

Authorization chain:

```text
Authenticated User
       ↓
Review.userId
       ↓
Owned Review
```

The client must not be able to modify another user's review by submitting
a different `userId`.

---

# 12. Review Product Integrity

The Review must satisfy:

```text
Review.productId
=
OrderItem.productId
```

The server must validate this relationship before creating the review.

This prevents a user from purchasing Product A and attempting to review
Product B using the same OrderItem.

---

# 13. Review Vendor Relationship

The product belongs to a vendor.

Therefore:

```text
Review
  ↓
Product
  ↓
Vendor
```

The vendor must not be inferred from arbitrary client input.

Vendor ownership should always be resolved through the Product/catalog
relationship.

---

# 14. Review Title

The review title is optional.

Example:

```text
"Excellent quality"
```

The service layer should enforce a reasonable maximum length.

The exact maximum will be finalized during DTO validation.

---

# 15. Review Comment

The review comment is optional in the initial architecture.

A rating-only review may be allowed:

```text
Rating:
5
```

without:

```text
Comment:
...
```

If the product requires written feedback, that business rule can be
introduced later.

The application layer should enforce reasonable length limits.

---

# 16. Review Moderation

Reviews should not automatically become public unless the platform
explicitly chooses auto-publishing.

Initial flow:

```text
User
 ↓
Submit Review
 ↓
PENDING
 ↓
Moderation
 ├── PUBLISHED
 └── REJECTED
```

Administrators may later hide a published review:

```text
PUBLISHED
    ↓
HIDDEN
```

---

# 17. Review Moderation Authority

Admin users may:

* Approve reviews
* Reject reviews
* Hide reviews
* Review reported content

Customers may:

* Create their own reviews
* Edit their own reviews according to policy
* View published reviews

Customers must not be able to change:

```text
status
isVerifiedPurchase
publishedAt
```

directly.

---

# 18. Verified Purchase Snapshot

The Review stores:

```text
isVerifiedPurchase
```

as a historical snapshot.

Normally this should be:

```text
true
```

because the Review was created from a verified OrderItem.

The client must never be allowed to submit:

```text
isVerifiedPurchase = true
```

as proof of purchase.

The server determines this value.

---

# 19. Product Rating Aggregation

Product pages will commonly require:

```text
Average rating
Total reviews
Rating distribution
```

Example:

```text
5 stars → 120
4 stars → 45
3 stars → 10
2 stars → 3
1 star  → 2

Average = 4.61
Total   = 180
```

These values can initially be calculated from published reviews.

---

# 20. Rating Aggregation Strategy

Initial implementation:

```text
Published Reviews
       ↓
Aggregate
       ↓
Average Rating
Total Review Count
Rating Distribution
```

The initial architecture does not require denormalized counters.

If performance later requires cached aggregates, Product may store:

```text
averageRating
reviewCount
```

with transactional or asynchronous update mechanisms.

---

# 21. Published Reviews Only

Only:

```text
status = PUBLISHED
```

reviews should contribute to public rating calculations.

The following should not contribute:

```text
PENDING
REJECTED
HIDDEN
```

---

# 22. Rating Calculation Precision

The database stores the raw integer rating:

```text
1-5
```

Average rating is calculated from those values.

Example:

```text
5 + 4 + 5 + 3
----------------
       4
=
4.25
```

The presentation layer can decide how many decimal places to display.

---

# 23. Review Editing

The initial architecture may allow users to edit their own reviews.

Possible flow:

```text
PUBLISHED
   ↓
User edits
   ↓
PENDING
   ↓
Moderation
   ↓
PUBLISHED
```

This ensures that edited content can be reviewed again.

The exact editing policy will be finalized during implementation.

---

# 24. Review Deletion

Reviews should not normally be physically deleted.

Instead, the system should use:

```text
HIDDEN
```

or:

```text
REJECTED
```

depending on the reason.

This preserves moderation and audit history.

---

# 25. Review Media

The initial Review entity may support optional media references.

Examples:

```text
Images
Videos
```

However, the Review domain should not directly manage file storage.

A future relationship may be:

```text
Review
  │
  └── ReviewMedia
         │
         └── Media/Storage
```

The exact media architecture will be defined separately.

---

# 26. ReviewMedia

Future conceptual structure:

| Field       | Type     | Required |
| ----------- | -------- | -------: |
| `id`        | UUID     |      Yes |
| `reviewId`  | UUID     |      Yes |
| `mediaId`   | UUID     |      Yes |
| `sortOrder` | Integer  |      Yes |
| `createdAt` | DateTime |      Yes |

This is intentionally not required for the first implementation.

---

# 27. Review Reporting

Future users may report inappropriate reviews.

Potential future model:

```text
Review
   │
   └── ReviewReport
```

Possible report reasons:

```text
SPAM
ABUSE
OFF_TOPIC
FAKE_REVIEW
INAPPROPRIATE_CONTENT
OTHER
```

This is outside the initial schema.

---

# 28. Review and Vendor Ratings

The initial architecture treats Product rating as the primary review
target.

Vendor ratings can later be introduced separately.

If vendor ratings are added, they should not simply reuse Product Review
records without explicit business rules.

Future architecture:

```text
ProductReview
VendorReview
```

with separate eligibility rules.

---

# 29. Review and Order Cancellation

A cancelled order must not create review eligibility.

Example:

```text
VendorOrder
    ↓
CANCELLED
```

Review creation:

```text
REJECTED
```

unless a future business rule explicitly allows reviews for partial
cancellation scenarios.

---

# 30. Review and Returns

If an order is delivered and later returned, review eligibility may need
to be reconsidered.

Initial architecture:

```text
Returned item
   ↓
Review eligibility depends on final business rule
```

The review service must avoid hard-coding assumptions that cannot be
changed later.

The final return/review policy will be finalized after the Return domain
is designed.

---

# 31. Review and Refund

A refund does not automatically mean that an existing review should be
deleted.

Review eligibility and refund state are separate business concepts.

The exact policy may depend on:

* Return reason
* Fraud rules
* Product ownership
* Review moderation

This remains a business-rule decision.

---

# 32. Review Creation Flow

Conceptual flow:

```text
User
 ↓
POST /reviews
 ↓
Validate DTO
 ↓
Authenticate User
 ↓
Load OrderItem
 ↓
Verify Order ownership
 ↓
Verify Product relationship
 ↓
Verify delivery eligibility
 ↓
Check existing Review
 ↓
Create Review
 ↓
PENDING
```

---

# 33. Review Update Flow

Conceptual flow:

```text
User
 ↓
Update Review
 ↓
Verify ownership
 ↓
Validate content
 ↓
Update review
 ↓
Reset moderation state if required
 ↓
PENDING
```

The exact moderation behavior will be finalized during implementation.

---

# 34. Review Publication Flow

Conceptual flow:

```text
Admin
 ↓
Review moderation
 ↓
Validate moderation permission
 ↓
PUBLISHED
 ↓
publishedAt = current timestamp
```

Only published reviews contribute to public rating aggregation.

---

# 35. Review Security

The system must prevent:

* Fake reviews
* Cross-user review modification
* Cross-product review creation
* Duplicate reviews
* Client-controlled verification flags
* Unauthorized moderation
* Unauthorized deletion

The OrderItem relationship is the primary anti-fraud mechanism.

---

# 36. Review Rate Limiting

Review creation endpoints may be rate-limited to reduce:

* Spam
* Automated abuse
* Excessive requests

Rate limiting may use Redis.

Redis is supporting infrastructure and is not the source of truth for
review ownership or eligibility.

---

# 37. Redis and BullMQ

Redis/BullMQ may later support:

```text
Review moderation jobs
Review notification jobs
Rating aggregation jobs
Spam detection
Media processing
```

The Review database remains authoritative.

---

# 38. Review Notifications

Potential future notifications:

```text
Review published
Review rejected
Review hidden
Vendor receives new product review
```

Notification processing belongs to the Notification domain.

The Review domain should emit domain/application events rather than
embedding notification delivery logic inside Review services.

---

# 39. Review Auditability

Moderation actions should eventually be auditable.

A future:

```text
ReviewModerationHistory
```

may record:

```text
reviewId
fromStatus
toStatus
changedBy
reason
createdAt
```

This is outside the minimum initial schema but recommended for production
admin systems.

---

# 40. Index Strategy

Initial indexes should include:

```text
Review
├── PRIMARY KEY (id)
├── UNIQUE (orderItemId)
├── INDEX (productId, status, createdAt)
├── INDEX (userId, createdAt)
└── INDEX (status, createdAt)
```

The unique `orderItemId` constraint prevents duplicate reviews for the
same purchase item.

---

# 41. Referential Integrity

The database must enforce:

```text
Review → User
Review → Product
Review → OrderItem
```

The application layer must enforce:

```text
Review.userId = OrderItem.owner
Review.productId = OrderItem.productId
OrderItem belongs to eligible order
OrderItem has not already been reviewed
```

---

# 42. Soft Delete / Historical Preservation

Reviews should not normally be physically deleted.

Moderation should use:

```text
REJECTED
HIDDEN
```

where applicable.

Historical moderation data should remain available.

---

# 43. Complete Review Entity Map

```text
                         ┌──────────────┐
                         │     User     │
                         └──────┬───────┘
                                │
                                │
                                ▼
                         ┌──────────────┐
                         │   Review     │
                         ├──────────────┤
                         │ rating       │
                         │ title        │
                         │ comment      │
                         │ status       │
                         │ verified     │
                         └──────┬───────┘
                                │
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
                Product                 OrderItem
                    │                       │
                    │                       │
                    └───────────┬───────────┘
                                │
                                ▼
                           MasterOrder
```

---

# 44. Design Decisions

| Decision                                            | Reason                                            |
| --------------------------------------------------- | ------------------------------------------------- |
| Review references OrderItem                         | Ensures verified purchase                         |
| One review per OrderItem                            | Prevents duplicate purchase reviews               |
| Product remains review target                       | Keeps initial marketplace scope focused           |
| Rating is integer 1–5                               | Simple and predictable rating model               |
| Review moderation supported                         | Protects marketplace content quality              |
| Only published reviews affect rating                | Prevents unapproved content affecting ratings     |
| Verified purchase is server-controlled              | Prevents fake verification                        |
| Historical reviews are preserved                    | Maintains auditability                            |
| Product and OrderItem relationships validated       | Prevents cross-product review abuse               |
| Redis only supports rate limiting/async work        | Database remains authoritative                    |
| Vendor ratings deferred                             | Avoids mixing product and vendor review semantics |
| Review media deferred                               | Keeps initial schema focused                      |
| Review reporting deferred                           | Can be added without redesigning core Review      |
| Rating aggregates initially calculated from reviews | Avoids premature denormalization                  |

---

# 45. Future Extensions

The following are intentionally outside the initial implementation:

```text
ReviewMedia
ReviewReport
ReviewModerationHistory
VendorReview
ReviewReaction
ReviewHelpfulVote
ReviewReply
SellerResponse
RatingAggregate
ReviewSpamScore
ReviewVerification
ReviewReward
LoyaltyReward
```

These can be introduced as separate capabilities when required.

---

# 46. Implementation Status

```text
Review architecture                 APPROVED
Rating architecture                 APPROVED
Verified purchase model             APPROVED
Review moderation model             APPROVED
Duplicate review prevention         APPROVED
Rating aggregation strategy         APPROVED
Security requirements               APPROVED

Prisma models                       NOT IMPLEMENTED
Database migration                  NOT CREATED
Review APIs                         NOT IMPLEMENTED
Moderation APIs                     NOT IMPLEMENTED
Rating aggregation                 NOT IMPLEMENTED
Redis integration                   NOT IMPLEMENTED
BullMQ integration                  NOT IMPLEMENTED
Tests                               NOT IMPLEMENTED
```

> This document defines the initial Review and Rating architecture.
> Prisma models, migrations, review services, moderation workflows,
> rating aggregation, media support, Redis/BullMQ workflows, APIs, and
> tests will be implemented after the complete database architecture has
> been finalized.

The Review domain uses OrderItem as the purchase proof and preserves
customer feedback independently from future Product catalog changes.

````