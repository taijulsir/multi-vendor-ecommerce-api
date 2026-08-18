import type {
  Payment,
  PaymentAttempt,
  Refund,
} from '../../generated/prisma/client';

/**
 * `PaymentAttempt.metadata` (provider-specific JSON) is deliberately
 * excluded — docs/database/payment-refund.md §17 warns it must never
 * contain raw credentials, but as a defensive margin this foundation
 * never echoes arbitrary provider metadata back through the API either.
 */
export interface PaymentAttemptView {
  id: string;
  attemptNumber: number;
  status: string;
  provider: string;
  providerReference: string | null;
  amount: string;
  currency: string;
  failureCode: string | null;
  failureMessage: string | null;
  initiatedAt: Date;
  completedAt: Date | null;
}

export interface RefundView {
  id: string;
  refundNumber: string;
  status: string;
  amount: string;
  currency: string;
  reason: string;
  providerReference: string | null;
  processedAt: Date | null;
  createdAt: Date;
}

export interface PaymentView {
  id: string;
  masterOrderId: string;
  paymentNumber: string;
  status: string;
  method: string;
  provider: string;
  currency: string;
  amount: string;
  paidAmount: string;
  refundedAmount: string;
  providerReference: string | null;
  paidAt: Date | null;
  createdAt: Date;
  attempts: PaymentAttemptView[];
  refunds: RefundView[];
}

export function toPaymentAttemptView(
  attempt: PaymentAttempt,
): PaymentAttemptView {
  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    provider: attempt.provider,
    providerReference: attempt.providerReference,
    amount: attempt.amount.toFixed(2),
    currency: attempt.currency,
    failureCode: attempt.failureCode,
    failureMessage: attempt.failureMessage,
    initiatedAt: attempt.initiatedAt,
    completedAt: attempt.completedAt,
  };
}

export function toRefundView(refund: Refund): RefundView {
  return {
    id: refund.id,
    refundNumber: refund.refundNumber,
    status: refund.status,
    amount: refund.amount.toFixed(2),
    currency: refund.currency,
    reason: refund.reason,
    providerReference: refund.providerReference,
    processedAt: refund.processedAt,
    createdAt: refund.createdAt,
  };
}

export function toPaymentView(
  payment: Payment & { attempts: PaymentAttempt[]; refunds: Refund[] },
): PaymentView {
  return {
    id: payment.id,
    masterOrderId: payment.masterOrderId,
    paymentNumber: payment.paymentNumber,
    status: payment.status,
    method: payment.method,
    provider: payment.provider,
    currency: payment.currency,
    amount: payment.amount.toFixed(2),
    paidAmount: payment.paidAmount.toFixed(2),
    refundedAmount: payment.refundedAmount.toFixed(2),
    providerReference: payment.providerReference,
    paidAt: payment.paidAt,
    createdAt: payment.createdAt,
    attempts: payment.attempts.map(toPaymentAttemptView),
    refunds: payment.refunds.map(toRefundView),
  };
}
