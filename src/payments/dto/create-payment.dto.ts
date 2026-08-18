import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';

// Matches PaymentMethod in prisma/schema/enums.prisma exactly
// (docs/database/payment-refund.md §7). Declared locally rather than
// imported from the generated Prisma client, matching this codebase's
// established DTO convention (see CreateShopDto/CreateProductDto).
const PAYMENT_METHODS = [
  'CARD',
  'MOBILE_PAYMENT',
  'BANK_TRANSFER',
  'CASH_ON_DELIVERY',
  'OTHER',
] as const;

/**
 * Payment creation input. `masterOrderId` is a resource identifier only
 * — ownership is verified server-side against the authenticated caller
 * (docs/database/order.md §48), never trusted as an ownership claim.
 * `method` is the one genuinely client-controlled field
 * (docs/database/payment-refund.md §7). `provider`, `amount`,
 * `currency`, and `status` are never accepted here — see
 * PaymentsService's doc-comment for why they are always server-derived.
 */
export class CreatePaymentDto {
  @ApiProperty({ description: 'The MasterOrder this payment is for.' })
  @IsUUID()
  masterOrderId: string;

  @ApiProperty({ enum: PAYMENT_METHODS, example: 'CASH_ON_DELIVERY' })
  @IsIn(PAYMENT_METHODS)
  method: (typeof PAYMENT_METHODS)[number];
}
