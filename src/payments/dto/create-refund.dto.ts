import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumberString } from 'class-validator';

// Matches RefundReason in prisma/schema/enums.prisma exactly
// (docs/database/payment-refund.md §31).
const REFUND_REASONS = [
  'ORDER_CANCELLED',
  'CUSTOMER_RETURN',
  'DAMAGED_PRODUCT',
  'WRONG_PRODUCT',
  'PAYMENT_ERROR',
  'DUPLICATE_PAYMENT',
  'ADMIN_ADJUSTMENT',
  'OTHER',
] as const;

/**
 * Refund creation input (ADMIN-only — see PaymentsService's doc-comment
 * for why refund creation is administrative rather than customer
 * self-service in this phase). `amount` is the one genuinely
 * admin-controlled field: unlike Payment's amount (always server-derived
 * from the order total), the refund amount is inherently a decision the
 * refunding party makes — docs/database/payment-refund.md never states
 * an authoritative formula for it — but it is validated server-side
 * against the payment's actual refundable balance
 * (`paidAmount - refundedAmount`, §11/§34) and can never exceed it.
 * `currency` is never accepted — it always comes from the Payment being
 * refunded (§45: "A Refund must use the same currency as its Payment").
 * `requestedBy` is never accepted — always the authenticated admin's id.
 */
export class CreateRefundDto {
  @ApiProperty({
    example: '500.00',
    description:
      'The requested refund amount, as a decimal string. Validated ' +
      "against the payment's actual refundable balance server-side.",
  })
  @IsNumberString()
  amount: string;

  @ApiProperty({ enum: REFUND_REASONS, example: 'CUSTOMER_RETURN' })
  @IsIn(REFUND_REASONS)
  reason: (typeof REFUND_REASONS)[number];
}
