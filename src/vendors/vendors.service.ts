import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { OwnershipService } from '../auth/authorization/ownership.service';
import { Prisma, type Vendor } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVendorDto } from './dto/create-vendor.dto';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Deliberately generic — a duplicate vendor profile is reported the same
// way whether it was caught by the pre-check or by the database's own
// unique constraint racing a concurrent request (see `createForUser`).
const DUPLICATE_VENDOR_MESSAGE =
  'A vendor profile already exists for this account';

/**
 * Vendor onboarding/profile foundation (Phase 10).
 *
 * Implements only what docs/database/vendor-shop.md §6 (Vendor Business
 * Rules) documents as the "Vendor Creation" flow: `User → Vendor
 * Application → Vendor Created` with `status = PENDING` and
 * `verificationStatus = PENDING` (both already the Prisma schema's
 * defaults — never set explicitly here). Verification (PENDING →
 * UNDER_REVIEW → VERIFIED/REJECTED) and activation (→ ACTIVE) are
 * described by the same doc as administrative operations — see
 * docs/database/identity-access.md's `vendor:approve`/`vendor:suspend`/
 * `vendor:freeze` permission examples — and are out of scope for this
 * phase; no verification/activation endpoint is implemented here.
 */
@Injectable()
export class VendorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownershipService: OwnershipService,
  ) {}

  /**
   * Creates the caller's own Vendor profile. `userId` always comes from
   * the authenticated caller — never from the request body — so a vendor
   * profile can never be created on behalf of another user.
   *
   * `Vendor.userId` is unique (docs/database/vendor-shop.md §5: "1 User →
   * maximum 1 Vendor"), so a second application from the same user is a
   * conflict, not a new resource.
   */
  async createForUser(userId: string, dto: CreateVendorDto): Promise<Vendor> {
    const existingVendorId =
      await this.ownershipService.getVendorIdForUser(userId);

    if (existingVendorId) {
      throw new ConflictException(DUPLICATE_VENDOR_MESSAGE);
    }

    try {
      return await this.prisma.vendor.create({
        data: {
          userId,
          businessName: dto.businessName,
          businessEmail: dto.businessEmail,
          businessPhone: dto.businessPhone,
          // `status` and `verificationStatus` are intentionally omitted:
          // both default to PENDING in
          // prisma/schema/vendor-shop.prisma, matching
          // docs/database/vendor-shop.md §6.
        },
      });
    } catch (error) {
      // A concurrent request can pass the pre-check above and still race
      // to insert a second Vendor row for the same user; the database's
      // unique constraint on `userId` is the final authority. Same
      // translation pattern as AuthService.register.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException(DUPLICATE_VENDOR_MESSAGE);
      }

      throw error;
    }
  }

  /**
   * Retrieves the caller's own Vendor profile. A minimal, necessary
   * companion to `createForUser` (onboarding is pointless if the caller
   * can never see the result) — not a general vendor lookup/listing
   * endpoint, which is not documented and is not implemented here.
   */
  async findForUser(userId: string): Promise<Vendor> {
    const vendor = await this.prisma.vendor.findFirst({
      where: { userId, deletedAt: null },
    });

    if (!vendor) {
      throw new NotFoundException('No vendor profile exists for this account');
    }

    return vendor;
  }
}
