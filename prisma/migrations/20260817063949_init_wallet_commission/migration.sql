-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "available_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pending_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "direction" "WalletTransactionDirection" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "balance_before" DECIMAL(14,2) NOT NULL,
    "balance_after" DECIMAL(14,2) NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "description" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" UUID NOT NULL,
    "vendor_order_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "type" "CommissionType" NOT NULL DEFAULT 'PERCENTAGE',
    "rate" DECIMAL(5,2),
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "commission_amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_vendor_id_key" ON "wallets"("vendor_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_wallet_id_created_at_idx" ON "wallet_transactions"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_transactions_type_created_at_idx" ON "wallet_transactions"("type", "created_at");

-- CreateIndex
CREATE INDEX "wallet_transactions_reference_type_reference_id_idx" ON "wallet_transactions"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_vendor_order_id_key" ON "commissions"("vendor_order_id");

-- CreateIndex
CREATE INDEX "commissions_vendor_id_idx" ON "commissions"("vendor_id");

-- CreateIndex
CREATE INDEX "commissions_status_created_at_idx" ON "commissions"("status", "created_at");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_vendor_order_id_fkey" FOREIGN KEY ("vendor_order_id") REFERENCES "vendor_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
