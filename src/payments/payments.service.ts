import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuthorizationService } from '../auth/authorization/authorization.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateRefundDto } from './dto/create-refund.dto';
import {
  generateIdentifier,
  generateProviderReference,
} from './utils/identifier';
import {
  toPaymentView,
  toRefundView,
  type PaymentView,
  type RefundView,
} from './utils/payment-view';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Deliberately identical in shape/generality to the ownership-denial
// messages used elsewhere in this codebase (OrdersService,
// VendorShopOwnershipGuard, ...) — never states whether the order/payment
// exists or belongs to someone else.
const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';
const PAYMENT_NOT_FOUND_MESSAGE = 'Payment not found';
const ORDER_ALREADY_HAS_PAYMENT_MESSAGE =
  'This order already has a payment. Use the retry endpoint to try again.';
const PAYMENT_NOT_RETRYABLE_MESSAGE =
  'This payment cannot be retried in its current state';
const INVALID_REFUND_AMOUNT_MESSAGE = 'Refund amount must be greater than zero';
const EXCESSIVE_REFUND_MESSAGE =
  "The requested refund amount exceeds this payment's refundable balance";

const PAYMENT_INCLUDE = { attempts: true, refunds: true } as const;

/**
 * Payment / PaymentAttempt / Refund foundation (Phase 15).
 *
 * **No real payment gateway is integrated.** `Payment.provider` is set
 * to a fixed internal placeholder (`'MANUAL'`) for every method,
 * including ones that would normally require a real processor (CARD,
 * MOBILE_PAYMENT, BANK_TRANSFER) — docs/database/payment-refund.md's own
 * Implementation Status explicitly marks "Gateway integration" as NOT
 * IMPLEMENTED, and this task explicitly forbids simulating one.
 * `PaymentAttempt.providerReference` / `Refund.providerReference` are
 * generated internally (`generateProviderReference`) as the value a real
 * gateway call would normally return — this is what
 * `WebhooksService` correlates incoming events against (see its
 * doc-comment).
 *
 * **Payment creation is one-time per order in this phase** (§26's only
 * concretely documented "try again" path is a new `PaymentAttempt` under
 * the *same* Payment — "Attempt 1 → FAILED, Attempt 2 → INITIATED" —
 * not a second Payment row). `createForUser` therefore rejects (409) a
 * second Payment for an order that already has one, regardless of its
 * status; `retry` is the only way to try again, and only from `FAILED`.
 *
 * **Ownership:** `Payment` is reached through `MasterOrder`, which is
 * user-owned (Phase 14's established pattern) — no vendor-ownership
 * machinery involved. `createForUser`/`retry`/`findById` all resolve
 * ownership by comparing `payment.masterOrder.userId` to the
 * authenticated caller, with the ADMIN bypass applied only to *viewing*
 * (`findById`), not to creating/retrying another user's payment — same
 * asymmetry already established for Shop/Product creation vs. viewing.
 *
 * **Refund creation is ADMIN-only** — see `docs/database/
 * payment-refund.md` §31/§54: no customer-facing refund-request
 * endpoint or workflow is documented anywhere; only administrative
 * actor/audit language (`ADMIN_ADJUSTMENT`, `requestedBy`) is. This is
 * the resolved interpretation of a genuine documentation gap, reported
 * in this phase's final report.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async createForUser(
    userId: string,
    dto: CreatePaymentDto,
  ): Promise<PaymentView> {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id: dto.masterOrderId },
      select: { id: true, userId: true, currency: true, totalAmount: true },
    });

    if (!order || order.userId !== userId) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    const existingPayment = await this.prisma.payment.count({
      where: { masterOrderId: order.id },
    });

    if (existingPayment > 0) {
      throw new ConflictException(ORDER_ALREADY_HAS_PAYMENT_MESSAGE);
    }

    const provider = 'MANUAL';
    const paymentNumber = generateIdentifier('PAY');
    const providerReference = generateProviderReference();

    try {
      const payment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.payment.create({
          data: {
            masterOrderId: order.id,
            paymentNumber,
            method: dto.method,
            currency: order.currency,
            amount: order.totalAmount,
            provider,
          },
        });

        await tx.paymentAttempt.create({
          data: {
            paymentId: created.id,
            attemptNumber: 1,
            provider,
            providerReference,
            amount: order.totalAmount,
            currency: order.currency,
          },
        });

        return tx.payment.findUniqueOrThrow({
          where: { id: created.id },
          include: PAYMENT_INCLUDE,
        });
      });

      return toPaymentView(payment);
    } catch (error) {
      throw this.translateWriteError(error, PAYMENT_NOT_FOUND_MESSAGE);
    }
  }

  /**
   * Creates a new `PaymentAttempt` on an existing `FAILED` Payment,
   * exactly matching docs/database/payment-refund.md §26 — previous
   * attempts are never mutated, and the Payment's own `status` returns
   * to `PENDING` (no real processing has started yet; see the class
   * doc-comment on why `PROCESSING` is never used in this foundation).
   */
  async retry(userId: string, paymentId: string): Promise<PaymentView> {
    const payment = await this.findOwnedPayment(userId, paymentId);

    if (payment.status !== 'FAILED') {
      throw new ConflictException(PAYMENT_NOT_RETRYABLE_MESSAGE);
    }

    const provider = 'MANUAL';
    const providerReference = generateProviderReference();

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        // Re-check inside the transaction: a concurrent retry could have
        // already moved this payment out of FAILED.
        const current = await tx.payment.findUniqueOrThrow({
          where: { id: paymentId },
          include: {
            attempts: { orderBy: { attemptNumber: 'desc' }, take: 1 },
          },
        });

        if (current.status !== 'FAILED') {
          throw new ConflictException(PAYMENT_NOT_RETRYABLE_MESSAGE);
        }

        const nextAttemptNumber = (current.attempts[0]?.attemptNumber ?? 0) + 1;

        await tx.paymentAttempt.create({
          data: {
            paymentId,
            attemptNumber: nextAttemptNumber,
            provider,
            providerReference,
            amount: current.amount,
            currency: current.currency,
          },
        });

        await tx.payment.update({
          where: { id: paymentId },
          data: { status: 'PENDING' },
        });

        return tx.payment.findUniqueOrThrow({
          where: { id: paymentId },
          include: PAYMENT_INCLUDE,
        });
      });

      return toPaymentView(updated);
    } catch (error) {
      throw this.translateWriteError(error, PAYMENT_NOT_FOUND_MESSAGE);
    }
  }

  async findById(userId: string, paymentId: string): Promise<PaymentView> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        ...PAYMENT_INCLUDE,
        masterOrder: { select: { userId: true } },
      },
    });

    if (!payment) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    if (payment.masterOrder.userId !== userId) {
      const isAdmin = await this.authorizationService.hasRole(userId, 'ADMIN');

      if (!isAdmin) {
        throw new ForbiddenException(FORBIDDEN_MESSAGE);
      }
    }

    return toPaymentView(payment);
  }

  /**
   * ADMIN-only (enforced by `@Roles('ADMIN')` on the controller route,
   * not by ownership — see the class doc-comment). Amount is validated
   * against the payment's actual refundable balance
   * (`paidAmount - refundedAmount`, docs/database/payment-refund.md
   * §11/§34) — never trusted as-is from the request body.
   */
  async createRefund(
    adminUserId: string,
    paymentId: string,
    dto: CreateRefundDto,
  ): Promise<RefundView> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException(PAYMENT_NOT_FOUND_MESSAGE);
    }

    const requestedAmount = new Prisma.Decimal(dto.amount);

    if (requestedAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException(INVALID_REFUND_AMOUNT_MESSAGE);
    }

    const refundableAmount = payment.paidAmount.minus(payment.refundedAmount);

    if (requestedAmount.greaterThan(refundableAmount)) {
      throw new ConflictException(EXCESSIVE_REFUND_MESSAGE);
    }

    const refundNumber = generateIdentifier('REF');
    const providerReference = generateProviderReference();

    try {
      const refund = await this.prisma.refund.create({
        data: {
          paymentId,
          refundNumber,
          amount: requestedAmount,
          currency: payment.currency,
          reason: dto.reason,
          providerReference,
          requestedBy: adminUserId,
        },
      });

      return toRefundView(refund);
    } catch (error) {
      throw this.translateWriteError(error, PAYMENT_NOT_FOUND_MESSAGE);
    }
  }

  private async findOwnedPayment(userId: string, paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { masterOrder: { select: { userId: true } } },
    });

    if (!payment || payment.masterOrder.userId !== userId) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    return payment;
  }

  private translateWriteError(error: unknown, notFoundMessage: string): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION) {
        return new ConflictException(
          'A duplicate identifier was generated; please retry',
        );
      }

      if (error.code === 'P2025') {
        return new NotFoundException(notFoundMessage);
      }
    }

    if (
      error instanceof ConflictException ||
      error instanceof BadRequestException
    ) {
      return error;
    }

    return error as Error;
  }
}
