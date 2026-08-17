-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "business_name" TEXT NOT NULL,
    "business_email" TEXT,
    "business_phone" TEXT,
    "status" "VendorStatus" NOT NULL DEFAULT 'PENDING',
    "verification_status" "VendorVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logo_url" TEXT,
    "banner_url" TEXT,
    "status" "ShopStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendors_user_id_key" ON "vendors"("user_id");

-- CreateIndex
CREATE INDEX "vendors_status_idx" ON "vendors"("status");

-- CreateIndex
CREATE INDEX "vendors_verification_status_idx" ON "vendors"("verification_status");

-- CreateIndex
CREATE UNIQUE INDEX "shops_vendor_id_key" ON "shops"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "shops_slug_key" ON "shops"("slug");

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shops" ADD CONSTRAINT "shops_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
