import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

import { AddressDto } from './address.dto';

/**
 * Checkout input. Operates on the authenticated caller's own active
 * cart — there is no `cartId` field, matching how every other Cart
 * operation (Phase 12) already treats "the active cart" as an identity-
 * derived singleton rather than a client-chosen resource.
 *
 * No `userId`, `vendorId`, price, subtotal, total, commission, payment
 * status, order status, or inventory quantity field exists here — all
 * of that is server-resolved (docs/database/order.md §48).
 *
 * `billingAddress` is optional: `MasterOrder.billingAddressSnapshot` is
 * a required, non-null column, but the doc never states the client must
 * always submit a distinct billing address. If omitted, CheckoutService
 * uses `shippingAddress` for both — a minimal, documented-elsewhere-
 * as-common assumption, not a business rule about pricing/inventory;
 * flagged in this phase's final report.
 *
 * No payment method, shipping method, or coupon code field exists: see
 * this phase's final report for why (Payment/Promotion domains are
 * explicitly unimplemented per their own docs' Implementation Status).
 */
export class CheckoutDto {
  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  shippingAddress: AddressDto;

  @ApiPropertyOptional({
    type: AddressDto,
    description: 'Defaults to shippingAddress if omitted.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  billingAddress?: AddressDto;

  @ApiPropertyOptional({ example: 'Please call before delivery.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNote?: string;
}
