-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "PromotionType" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "max_discount_amount" DECIMAL(14,2),
    "minimum_order_amount" DECIMAL(14,2),
    "currency" CHAR(3),
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "usage_limit" INTEGER,
    "per_user_usage_limit" INTEGER,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "CouponStatus" NOT NULL DEFAULT 'ACTIVE',
    "usage_limit" INTEGER,
    "per_user_usage_limit" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_vendors" (
    "promotion_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,

    CONSTRAINT "promotion_vendors_pkey" PRIMARY KEY ("promotion_id","vendor_id")
);

-- CreateTable
CREATE TABLE "promotion_products" (
    "promotion_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,

    CONSTRAINT "promotion_products_pkey" PRIMARY KEY ("promotion_id","product_id")
);

-- CreateTable
CREATE TABLE "promotion_categories" (
    "promotion_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "promotion_categories_pkey" PRIMARY KEY ("promotion_id","category_id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "master_order_id" UUID NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotions_status_idx" ON "promotions"("status");

-- CreateIndex
CREATE INDEX "promotions_starts_at_ends_at_idx" ON "promotions"("starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "promotions_created_at_idx" ON "promotions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_promotion_id_idx" ON "coupons"("promotion_id");

-- CreateIndex
CREATE INDEX "coupons_status_idx" ON "coupons"("status");

-- CreateIndex
CREATE INDEX "promotion_vendors_vendor_id_idx" ON "promotion_vendors"("vendor_id");

-- CreateIndex
CREATE INDEX "promotion_products_product_id_idx" ON "promotion_products"("product_id");

-- CreateIndex
CREATE INDEX "promotion_categories_category_id_idx" ON "promotion_categories"("category_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_coupon_id_created_at_idx" ON "coupon_redemptions"("coupon_id", "created_at");

-- CreateIndex
CREATE INDEX "coupon_redemptions_user_id_created_at_idx" ON "coupon_redemptions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "coupon_redemptions_master_order_id_idx" ON "coupon_redemptions"("master_order_id");

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_vendors" ADD CONSTRAINT "promotion_vendors_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_vendors" ADD CONSTRAINT "promotion_vendors_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_categories" ADD CONSTRAINT "promotion_categories_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_categories" ADD CONSTRAINT "promotion_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
