-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "master_order_id" UUID NOT NULL,
    "payment_number" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL,
    "provider_reference" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'INITIATED',
    "provider" TEXT NOT NULL,
    "provider_reference" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "provider_reference" TEXT,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "processed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "refund_number" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" "RefundReason" NOT NULL,
    "provider_reference" TEXT,
    "requested_by" UUID,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_payment_number_key" ON "payments"("payment_number");

-- CreateIndex
CREATE INDEX "payments_master_order_id_idx" ON "payments"("master_order_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_provider_provider_reference_idx" ON "payments"("provider", "provider_reference");

-- CreateIndex
CREATE INDEX "payments_created_at_idx" ON "payments"("created_at");

-- CreateIndex
CREATE INDEX "payment_attempts_payment_id_idx" ON "payment_attempts"("payment_id");

-- CreateIndex
CREATE INDEX "payment_attempts_provider_provider_reference_idx" ON "payment_attempts"("provider", "provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_payment_id_attempt_number_key" ON "payment_attempts"("payment_id", "attempt_number");

-- CreateIndex
CREATE INDEX "payment_webhook_events_provider_reference_idx" ON "payment_webhook_events"("provider_reference");

-- CreateIndex
CREATE INDEX "payment_webhook_events_status_created_at_idx" ON "payment_webhook_events"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_id_key" ON "payment_webhook_events"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_refund_number_key" ON "refunds"("refund_number");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

-- CreateIndex
CREATE INDEX "refunds_provider_reference_idx" ON "refunds"("provider_reference");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_master_order_id_fkey" FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateSequence (§1.10 of the implementation plan: collision-safe,
-- human-readable payment/refund number generation)
CREATE SEQUENCE "payment_number_seq";
CREATE SEQUENCE "refund_number_seq";
