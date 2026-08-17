-- CreateTable
CREATE TABLE "master_orders" (
    "id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "MasterOrderStatus" NOT NULL DEFAULT 'PENDING',
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shipping_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "service_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payment_status" "OrderPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "shipping_address_snapshot" JSONB NOT NULL,
    "billing_address_snapshot" JSONB NOT NULL,
    "customer_note" TEXT,
    "placed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "master_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_orders" (
    "id" UUID NOT NULL,
    "master_order_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "status" "VendorOrderStatus" NOT NULL DEFAULT 'PENDING',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shipping_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commission_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vendor_net_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tracking_number" TEXT,
    "shipping_provider" TEXT,
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "vendor_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "variant_name" TEXT,
    "sku" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "unit_price" DECIMAL(14,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_histories" (
    "id" UUID NOT NULL,
    "master_order_id" UUID NOT NULL,
    "from_status" "MasterOrderStatus",
    "to_status" "MasterOrderStatus" NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "changed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_order_status_histories" (
    "id" UUID NOT NULL,
    "vendor_order_id" UUID NOT NULL,
    "from_status" "VendorOrderStatus",
    "to_status" "VendorOrderStatus" NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "changed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_order_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_orders_order_number_key" ON "master_orders"("order_number");

-- CreateIndex
CREATE INDEX "master_orders_user_id_idx" ON "master_orders"("user_id");

-- CreateIndex
CREATE INDEX "master_orders_status_idx" ON "master_orders"("status");

-- CreateIndex
CREATE INDEX "master_orders_payment_status_idx" ON "master_orders"("payment_status");

-- CreateIndex
CREATE INDEX "master_orders_created_at_idx" ON "master_orders"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_orders_order_number_key" ON "vendor_orders"("order_number");

-- CreateIndex
CREATE INDEX "vendor_orders_master_order_id_idx" ON "vendor_orders"("master_order_id");

-- CreateIndex
CREATE INDEX "vendor_orders_vendor_id_idx" ON "vendor_orders"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_orders_status_idx" ON "vendor_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_orders_master_order_id_vendor_id_key" ON "vendor_orders"("master_order_id", "vendor_id");

-- CreateIndex
CREATE INDEX "order_items_vendor_order_id_idx" ON "order_items"("vendor_order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE INDEX "order_items_variant_id_idx" ON "order_items"("variant_id");

-- CreateIndex
CREATE INDEX "order_status_histories_master_order_id_created_at_idx" ON "order_status_histories"("master_order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_status_histories_changed_by_idx" ON "order_status_histories"("changed_by");

-- CreateIndex
CREATE INDEX "vendor_order_status_histories_vendor_order_id_created_at_idx" ON "vendor_order_status_histories"("vendor_order_id", "created_at");

-- CreateIndex
CREATE INDEX "vendor_order_status_histories_changed_by_idx" ON "vendor_order_status_histories"("changed_by");

-- AddForeignKey
ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_orders" ADD CONSTRAINT "vendor_orders_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_orders" ADD CONSTRAINT "vendor_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_vendor_order_id_fkey" FOREIGN KEY ("vendor_order_id") REFERENCES "vendor_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_histories" ADD CONSTRAINT "order_status_histories_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_order_status_histories" ADD CONSTRAINT "vendor_order_status_histories_vendor_order_id_fkey" FOREIGN KEY ("vendor_order_id") REFERENCES "vendor_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateSequence (§1.10 of the implementation plan: collision-safe,
-- human-readable order number generation — ORD-{year}-{6-digit sequence})
CREATE SEQUENCE "order_number_seq";
