# Architecture Diagrams

This document contains the visual companion to [`docs/architecture.md`](architecture.md) (the full design-decision record). All diagrams below reflect the *actually implemented* system as of the current state — nothing here depicts a deferred domain or a capability that doesn't exist in `src/`.

---

## 1. System Architecture

```mermaid
flowchart TD
    Client["Client\n(Postman / Swagger UI / future frontend)"]

    subgraph API["NestJS API — global prefix /api"]
        AuthZ["Authentication / Authorization\nJwtAuthGuard · AuthorizationGuard (RBAC) · Ownership guards"]

        subgraph Modules["Domain Modules"]
            Auth["Auth\n(register/login/refresh/logout, RBAC demo)"]
            Vendors["Vendors\n(onboarding, verification, activation)"]
            Shops["Shops"]
            Catalog["Catalog\n(Categories, Products, Variants, Inventory, Images)"]
            Cart["Cart"]
            Orders["Orders\n(Checkout, MasterOrder, VendorOrder)"]
            Payments["Payments\n(Payment, Attempt, Webhook, Refund)"]
            Health["Health"]
        end

        Storage["StorageModule\nLocalFileStorageService"]
    end

    PG[("PostgreSQL 17\nvia PrismaService (@prisma/adapter-pg)")]
    Redis[("Redis 7\nhealth-checked; BullMQ connection configured,\nno queues/processors implemented yet")]
    Disk[("Local filesystem\nFILE_STORAGE_DIR")]

    Client --> API
    API --> AuthZ
    AuthZ --> Modules
    Auth --> PG
    Vendors --> PG
    Shops --> PG
    Catalog --> PG
    Cart --> PG
    Orders --> PG
    Payments --> PG
    Catalog --> Storage
    Storage --> Disk
    Health -.ping.-> PG
    Health -.ping.-> Redis
```

**Notes, so this diagram cannot be misread:**

- Every module funnels through the *same* authentication/authorization primitives — there is exactly one JWT guard, one RBAC guard, and one ownership-resolution service in the codebase, composed per-route rather than reimplemented per domain.
- **Redis is real infrastructure** (`RedisModule` is global, `RedisService` pings on startup/shutdown, `docker-compose.yml` and CI both run a Redis service container) — but its *only* current consumer is the `/api/health` endpoint and the `BullModule.forRootAsync` connection registration in `app.module.ts`. No queue, processor, or cache read/write exists anywhere in `src/`. This diagram does not draw Redis as a caching or queueing layer because it isn't one yet.
- **Local file storage is isolated behind `LocalFileStorageService`** — no controller or service touches the filesystem directly; uploads are validated by content (magic-byte sniffing via `file-type`), stored under a randomized filename, and streamed back through a dedicated route rather than served as static files.
- **No external payment gateway box is drawn.** `PaymentsModule` talks only to PostgreSQL — `Payment.provider` is the internal placeholder `MANUAL`, and the webhook endpoint ingests events with no real processor on the other end. A future gateway would sit outside this diagram entirely until one is actually integrated.

---

## 2. Commerce Flow (Customer)

```mermaid
sequenceDiagram
    participant C as Customer
    participant Cart as Cart
    participant Checkout as Checkout
    participant MO as MasterOrder
    participant VO as VendorOrder(s)
    participant Pay as Payment

    C->>Cart: POST /cart/items (variantId, quantity)
    Cart-->>C: CartItem (price/currency snapshot)
    C->>Checkout: POST /checkout (shippingAddress)
    Note over Checkout: One Prisma transaction:\ncart ACTIVE→CONVERTED guard,\natomic conditional-UPDATE inventory reservation,\nMasterOrder + one VendorOrder per vendor + OrderItems
    Checkout->>MO: create (status PENDING, paymentStatus PENDING)
    Checkout->>VO: create (one per distinct vendor in the cart)
    Checkout-->>C: MasterOrder + VendorOrder(s)
    C->>Pay: POST /payments (masterOrderId, method)
    Pay-->>C: Payment + first PaymentAttempt
    Note over Pay: POST /payments/webhook (unauthenticated,\nidempotent) updates Attempt/Payment/\nMasterOrder.paymentStatus
```

Fulfillment (shipping/delivery) is tracked at the `VendorOrder` level (`PATCH /vendor-orders/:id/status`), independently of `MasterOrder.paymentStatus` — the two lifecycles are a deliberate domain separation, not an oversight.

---

## 3. Vendor Flow

```mermaid
sequenceDiagram
    participant V as Vendor (User)
    participant Adm as ADMIN
    participant Vend as Vendor record
    participant Shop as Shop
    participant Prod as Product
    participant Var as ProductVariant
    participant Inv as Inventory
    participant Img as ProductImage

    V->>Vend: POST /vendors (onboarding, status PENDING)
    Adm->>Vend: PATCH /vendors/:id/verification (UNDER_REVIEW → VERIFIED)
    Adm->>Vend: PATCH /vendors/:id/activation (ACTIVE)
    V->>Shop: POST /shops (one shop per vendor)
    V->>Prod: POST /products (category-assigned, DRAFT)
    V->>Var: POST /products/:id/variants (price, sku, currency)
    Var->>Inv: Inventory row created alongside the variant
    V->>Inv: POST /products/:id/variants/:variantId/inventory/restock
    V->>Img: POST /products/:id/images (multipart, content-sniffed)
```

**A cart-add (`POST /cart/items`) only succeeds once the Product, its parent Vendor, *and* the specific ProductVariant are all `ACTIVE`** — a vendor that is onboarded but not yet verified/activated cannot have its products added to any customer's cart, by design.

---

## 4. Future / Not Implemented

The following are **explicitly not part of the current runtime** and are never drawn as active components above:

| Item | Status |
|---|---|
| Real payment gateway (Stripe/SSLCommerz/bKash/...) | Not integrated — `Payment.provider` is always `MANUAL` |
| Webhook signature verification | Not implemented — no real provider chosen yet |
| BullMQ queues/processors | Connection configured only; zero queues defined |
| Wallet / Commission, Promotion / Coupon, Review, Notification, Audit | Prisma models exist; no service or controller |
| CDN / object storage (S3, Spaces, MinIO) for images | Local filesystem only |
