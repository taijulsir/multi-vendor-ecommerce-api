-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "comment" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "is_verified_purchase" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_order_item_id_key" ON "reviews"("order_item_id");

-- CreateIndex
CREATE INDEX "reviews_product_id_status_created_at_idx" ON "reviews"("product_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "reviews_user_id_created_at_idx" ON "reviews"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "reviews_status_created_at_idx" ON "reviews"("status", "created_at");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint (docs/database/review.md §5: rating is 1-5, no fractional values)
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
