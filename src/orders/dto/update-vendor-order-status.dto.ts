import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

// docs/database/order.md §10 draws the VendorOrder lifecycle as
// PENDING → CONFIRMED → PROCESSING → READY_TO_SHIP → SHIPPED → DELIVERED.
// PENDING is therefore never a valid *target* here — it is only ever the
// schema default (prisma/schema/order.prisma). CANCELLED is included
// because docs/database/order.md §31 unconditionally documents
// PENDING/CONFIRMED → CANCELLED (ADR-2,
// docs/remaining-architecture-plan.md's Architecture Decision Register).
// RETURN_REQUESTED/RETURNED are explicitly excluded — ADR-2 marks them
// DEFERRED, out of this phase's scope.
const VENDOR_ORDER_STATUS_TARGETS = [
  'CONFIRMED',
  'PROCESSING',
  'READY_TO_SHIP',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const;

/**
 * Vendor input for `PATCH /api/vendor-orders/:vendorOrderId/status`
 * (Phase 19, ADR-2). Only `status` is accepted — `VendorOrder.vendorId`,
 * `masterOrderId`, amounts, and timestamps are never part of this DTO.
 * `VendorOrdersService.updateStatus` additionally validates the
 * transition itself against the vendor order's *current* status; this
 * DTO only restricts which target values are syntactically acceptable.
 */
export class UpdateVendorOrderStatusDto {
  @ApiProperty({
    enum: VENDOR_ORDER_STATUS_TARGETS,
    example: 'CONFIRMED',
    description:
      'The target status. PENDING is never accepted here — it is the ' +
      "schema's own default and is not a documented transition target. " +
      'Only the transitions docs/database/order.md §10/§31 document are ' +
      'ever actually applied server-side (see the service layer): ' +
      'PENDING→CONFIRMED, CONFIRMED→PROCESSING, PROCESSING→READY_TO_SHIP, ' +
      'READY_TO_SHIP→SHIPPED, SHIPPED→DELIVERED, and PENDING/CONFIRMED→' +
      'CANCELLED.',
  })
  @IsIn(VENDOR_ORDER_STATUS_TARGETS)
  status: (typeof VENDOR_ORDER_STATUS_TARGETS)[number];
}
