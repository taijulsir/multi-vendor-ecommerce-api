import { Injectable, Logger } from '@nestjs/common';

import { Prisma, type PaymentWebhookEvent } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookEventDto } from './dto/webhook-event.dto';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** This foundation's own recognized event vocabulary — see the class doc-comment. */
const PAYMENT_SUCCEEDED = 'payment.succeeded';
const PAYMENT_FAILED = 'payment.failed';
const REFUND_SUCCEEDED = 'refund.succeeded';
const REFUND_FAILED = 'refund.failed';

export type WebhookProcessingOutcome =
  'duplicate' | 'ignored' | 'unmatched' | 'processed';

/**
 * Payment webhook foundation (Phase 15).
 *
 * **No real gateway is integrated and no signature verification is
 * implemented.** docs/database/payment-refund.md §22 requires
 * verification in principle but ties the exact mechanism to "the
 * provider" — undefined here, since no provider is chosen (this task
 * explicitly forbids inventing one). This is a genuine, intentional gap
 * in this foundation, not an oversight — see this phase's final report.
 * Consequently this endpoint is unauthenticated (`WebhooksController`
 * has no `JwtAuthGuard`), matching how a real external-provider webhook
 * would be reached, but with no way yet to verify the caller is
 * genuinely the payment provider.
 *
 * **Idempotency** uses `PaymentWebhookEvent`'s own
 * `UNIQUE(provider, eventId)` constraint directly — no separate
 * idempotency table. The event row is inserted *first*; a unique-
 * constraint violation on that insert means this exact event was
 * already received, and processing is skipped entirely (no state
 * changes are re-applied) — see docs/database/payment-refund.md §21.
 *
 * **Second, independent idempotency layer (Phase 16 hardening):** the
 * `(provider, eventId)` constraint only catches the *same* event
 * delivered twice. `handlePaymentOutcome`/`handleRefundOutcome`
 * additionally check the target `PaymentAttempt`/`Refund`'s own current
 * status before applying any financial effect — an already-resolved
 * attempt/refund is treated as a duplicate (event marked `IGNORED`,
 * `{ status: 'duplicate' }` returned) rather than reapplied, so even a
 * (non-conforming) provider that reports the same underlying outcome
 * under two different event ids cannot double-credit `paidAmount` or
 * `refundedAmount`.
 *
 * **Recognized event types** (`payment.succeeded`, `payment.failed`,
 * `refund.succeeded`, `refund.failed`) are this foundation's own chosen
 * vocabulary, not a real gateway's — `eventType` is a free string in
 * the schema specifically because different real gateways use different
 * naming (e.g. Stripe's `payment_intent.succeeded`). Anything else is
 * recorded with `status = IGNORED` and never rejected — a real gateway
 * can send event types this foundation doesn't act on yet.
 *
 * **Correlation** happens via `providerReference` — the value
 * `PaymentsService` generates at attempt/refund-creation time in place
 * of a real gateway's own returned reference (see its doc-comment). An
 * event whose `providerReference` matches no known attempt/refund is
 * recorded with `status = FAILED` and an `errorMessage`, not rejected at
 * the HTTP layer — this endpoint always returns 200 for a
 * well-formed request, per standard webhook convention (a non-2xx
 * response would just cause a real gateway to keep retrying).
 *
 * **Order-status boundary:** only `MasterOrder.paymentStatus` is ever
 * updated here — `docs/database/payment-refund.md` §24 explicitly scopes
 * the Payment→Order sync to the summarized payment state, and
 * `MasterOrder.status` (fulfillment lifecycle) is never touched, per
 * this task's own explicit instruction not to invent that relationship.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async processEvent(
    dto: WebhookEventDto,
  ): Promise<{ status: WebhookProcessingOutcome }> {
    let event: PaymentWebhookEvent;

    try {
      event = await this.prisma.paymentWebhookEvent.create({
        data: {
          provider: dto.provider,
          eventId: dto.eventId,
          eventType: dto.eventType,
          providerReference: dto.providerReference,
          payload: (dto.payload ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION
      ) {
        // Replayed event — the same (provider, eventId) was already
        // recorded. Never re-applies the associated state change.
        return { status: 'duplicate' };
      }

      throw error;
    }

    switch (dto.eventType) {
      case PAYMENT_SUCCEEDED:
        return this.handlePaymentOutcome(event.id, dto.providerReference, true);
      case PAYMENT_FAILED:
        return this.handlePaymentOutcome(
          event.id,
          dto.providerReference,
          false,
        );
      case REFUND_SUCCEEDED:
        return this.handleRefundOutcome(event.id, dto.providerReference, true);
      case REFUND_FAILED:
        return this.handleRefundOutcome(event.id, dto.providerReference, false);
      default:
        await this.prisma.paymentWebhookEvent.update({
          where: { id: event.id },
          data: { status: 'IGNORED', processedAt: new Date() },
        });

        return { status: 'ignored' };
    }
  }

  private async handlePaymentOutcome(
    webhookEventId: string,
    providerReference: string | undefined,
    succeeded: boolean,
  ): Promise<{ status: WebhookProcessingOutcome }> {
    if (!providerReference) {
      return this.markUnmatched(
        webhookEventId,
        'providerReference is required',
      );
    }

    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: { providerReference },
      include: { payment: true },
    });

    if (!attempt) {
      return this.markUnmatched(webhookEventId, 'No matching payment attempt');
    }

    // Idempotency by *value*, not just by (provider, eventId): this
    // attempt was already resolved by a prior event — possibly under a
    // different eventId than this one, which the unique-constraint
    // check alone cannot catch. Never re-apply the financial effect
    // (docs/database/payment-refund.md §21: "the system must process
    // the financial effect only once").
    if (attempt.status !== 'INITIATED') {
      await this.prisma.paymentWebhookEvent.update({
        where: { id: webhookEventId },
        data: {
          status: 'IGNORED',
          processedAt: new Date(),
          errorMessage:
            'Attempt already resolved; financial effect not reapplied',
        },
      });

      return { status: 'duplicate' };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: succeeded ? 'SUCCEEDED' : 'FAILED',
          completedAt: new Date(),
        },
      });

      if (succeeded) {
        await tx.payment.update({
          where: { id: attempt.paymentId },
          data: {
            status: 'PAID',
            paidAmount: attempt.payment.amount,
            paidAt: new Date(),
            providerReference: attempt.providerReference,
          },
        });
      } else {
        await tx.payment.update({
          where: { id: attempt.paymentId },
          data: { status: 'FAILED' },
        });
      }

      await tx.masterOrder.update({
        where: { id: attempt.payment.masterOrderId },
        data: { paymentStatus: succeeded ? 'PAID' : 'FAILED' },
      });

      await tx.paymentWebhookEvent.update({
        where: { id: webhookEventId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
    });

    return { status: 'processed' };
  }

  private async handleRefundOutcome(
    webhookEventId: string,
    providerReference: string | undefined,
    succeeded: boolean,
  ): Promise<{ status: WebhookProcessingOutcome }> {
    if (!providerReference) {
      return this.markUnmatched(
        webhookEventId,
        'providerReference is required',
      );
    }

    const refund = await this.prisma.refund.findFirst({
      where: { providerReference },
      include: { payment: { select: { masterOrderId: true } } },
    });

    if (!refund) {
      return this.markUnmatched(webhookEventId, 'No matching refund');
    }

    // Fast-path idempotency-by-value check — not, by itself, what makes
    // this concurrency-safe (see below); it just avoids opening a
    // transaction for the common case of a genuine duplicate delivered
    // well after settlement.
    if (refund.status !== 'PENDING') {
      return this.markDuplicateRefund(webhookEventId);
    }

    // docs/final-system-audit.md M-1 fix. The previous implementation
    // read `refund.payment.refundedAmount` once, computed
    // `refundedAmount + refund.amount` in JavaScript, and wrote that
    // absolute value back — safe for a single refund settling once, but
    // if two *different* refunds for the same Payment settle
    // concurrently, both transactions could read the same pre-update
    // `refundedAmount` and the later commit would silently overwrite
    // (lose) the earlier one's contribution.
    //
    // Fixed the same way this codebase already solves every other
    // concurrent-accumulation problem (`checkout.service.ts`'s inventory
    // reservation, `vendor-orders.service.ts`'s status transition):
    // an atomic conditional `UPDATE`, never a read-then-absolute-set.
    // `refunded_amount = refunded_amount + $amount` is computed by
    // Postgres from the row's *current* value at write time — under
    // concurrent execution the two updates serialize at the row level
    // and both contributions are reflected, regardless of commit order
    // (verified directly against real Postgres under genuine concurrent
    // load — see `webhooks.service.spec.ts`/the new concurrent e2e test).
    const outcome = await this.prisma.$transaction(async (tx) => {
      // Atomic conditional transition of the refund itself — the
      // authoritative concurrency guard for "this exact refund already
      // settled," closing the same race the fast-path check above only
      // catches when the two attempts aren't truly concurrent.
      const refundTransition = await tx.refund.updateMany({
        where: { id: refund.id, status: 'PENDING' },
        data: {
          status: succeeded ? 'SUCCEEDED' : 'FAILED',
          processedAt: new Date(),
        },
      });

      if (refundTransition.count === 0) {
        return 'duplicate' as const;
      }

      if (succeeded) {
        const [updatedPayment] = await tx.$queryRaw<
          { id: string; status: string }[]
        >`
          UPDATE payments
          SET refunded_amount = refunded_amount + ${refund.amount}::numeric,
              status = CASE
                WHEN refunded_amount + ${refund.amount}::numeric >= paid_amount THEN 'REFUNDED'::"PaymentStatus"
                ELSE 'PARTIALLY_REFUNDED'::"PaymentStatus"
              END,
              updated_at = now()
          WHERE id = ${refund.paymentId}::uuid
          RETURNING id, status
        `;

        await tx.masterOrder.update({
          where: { id: refund.payment.masterOrderId },
          data: {
            paymentStatus: updatedPayment.status as
              'PARTIALLY_REFUNDED' | 'REFUNDED',
          },
        });
      }

      await tx.paymentWebhookEvent.update({
        where: { id: webhookEventId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });

      return 'processed' as const;
    });

    if (outcome === 'duplicate') {
      return this.markDuplicateRefund(webhookEventId);
    }

    return { status: outcome };
  }

  /**
   * Same idempotency-by-value guard as `handlePaymentOutcome` — never
   * re-applies a refund's financial effect once it has already resolved
   * (`refundedAmount` is an accumulation, unlike the absolute-set fields
   * `handlePaymentOutcome` writes, so re-applying it would silently
   * double-credit the refund).
   */
  private async markDuplicateRefund(
    webhookEventId: string,
  ): Promise<{ status: WebhookProcessingOutcome }> {
    await this.prisma.paymentWebhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status: 'IGNORED',
        processedAt: new Date(),
        errorMessage: 'Refund already resolved; financial effect not reapplied',
      },
    });

    return { status: 'duplicate' };
  }

  private async markUnmatched(
    webhookEventId: string,
    reason: string,
  ): Promise<{ status: WebhookProcessingOutcome }> {
    await this.prisma.paymentWebhookEvent.update({
      where: { id: webhookEventId },
      data: { status: 'FAILED', errorMessage: reason, processedAt: new Date() },
    });

    this.logger.warn(`Webhook event ${webhookEventId} unmatched: ${reason}`);

    return { status: 'unmatched' };
  }
}
