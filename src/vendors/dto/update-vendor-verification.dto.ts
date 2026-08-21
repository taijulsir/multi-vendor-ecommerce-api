import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

// docs/database/vendor-shop.md §6 draws the verification lifecycle as
// PENDING → UNDER_REVIEW → VERIFIED, with PENDING/UNDER_REVIEW → REJECTED
// as the only other documented path. PENDING is therefore never a valid
// *target* of this endpoint — it is only ever the schema default
// (prisma/schema/vendor-shop.prisma) and is never re-applied by an ADMIN.
const VERIFICATION_TARGETS = ['UNDER_REVIEW', 'VERIFIED', 'REJECTED'] as const;

/**
 * ADMIN input for `PATCH /api/vendors/:vendorId/verification` (ADR-1,
 * docs/remaining-architecture-plan.md). Only `verificationStatus` is
 * accepted — `Vendor.status`, `userId`, `deletedAt`, and timestamps are
 * not part of this DTO and cannot be set through this endpoint.
 * `VendorsService.verify` additionally validates the transition itself
 * (PENDING→UNDER_REVIEW, UNDER_REVIEW→VERIFIED, PENDING/UNDER_REVIEW→
 * REJECTED) against the vendor's *current* verificationStatus — this DTO
 * only restricts which target values are syntactically acceptable.
 */
export class UpdateVendorVerificationDto {
  @ApiProperty({
    enum: VERIFICATION_TARGETS,
    example: 'VERIFIED',
    description:
      'The target verificationStatus. PENDING is never accepted here — ' +
      "it is the schema's own default and is not a documented transition " +
      'target (docs/database/vendor-shop.md §6).',
  })
  @IsIn(VERIFICATION_TARGETS)
  verificationStatus: (typeof VERIFICATION_TARGETS)[number];
}
