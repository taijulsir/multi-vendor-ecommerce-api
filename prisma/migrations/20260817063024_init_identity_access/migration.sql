-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'FROZEN', 'REJECTED');

-- CreateEnum
CREATE TYPE "VendorVerificationStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('SIMPLE', 'VARIABLE');

-- CreateEnum
CREATE TYPE "ProductVariantStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InventoryTransactionType" AS ENUM ('RESTOCK', 'SALE', 'RESERVATION', 'RELEASE', 'RETURN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'ABANDONED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MasterOrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "VendorOrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'MOBILE_PAYMENT', 'BANK_TRANSFER', 'CASH_ON_DELIVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('INITIATED', 'PENDING', 'AUTHORIZED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('ORDER_CANCELLED', 'CUSTOMER_RETURN', 'DAMAGED_PRODUCT', 'WRONG_PRODUCT', 'PAYMENT_ERROR', 'DUPLICATE_PAYMENT', 'ADMIN_ADJUSTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'FROZEN', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "WalletTransactionDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('SALE_CREDIT', 'SETTLEMENT_CREDIT', 'COMMISSION_DEBIT', 'TRANSACTION_FEE_DEBIT', 'REFUND_DEBIT', 'WITHDRAWAL_DEBIT', 'ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT', 'REVERSAL_CREDIT', 'REVERSAL_DEBIT');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'APPLIED', 'REVERSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CouponStatus" AS ENUM ('ACTIVE', 'DISABLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED', 'REFUND_REQUESTED', 'REFUND_APPROVED', 'REFUND_REJECTED', 'REFUND_COMPLETED', 'WALLET_CREDITED', 'WALLET_DEBITED', 'SETTLEMENT_COMPLETED', 'WITHDRAWAL_COMPLETED', 'WITHDRAWAL_FAILED', 'REVIEW_RECEIVED', 'REVIEW_PUBLISHED', 'REVIEW_REJECTED', 'PROMOTION_AVAILABLE', 'ACCOUNT_SECURITY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "phone" TEXT,
    "avatar_url" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "email_verified_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_resource_action_key" ON "permissions"("resource", "action");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
