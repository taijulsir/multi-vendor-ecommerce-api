import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { OwnershipService } from '../auth/authorization/ownership.service';
import {
  Prisma,
  type Vendor,
  type VendorVerificationStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorVerificationDto } from './dto/update-vendor-verification.dto';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Deliberately generic — a duplicate vendor profile is reported the same
// way whether it was caught by the pre-check or by the database's own
// unique constraint racing a concurrent request (see `createForUser`).
const DUPLICATE_VENDOR_MESSAGE =
  'A vendor profile already exists for this account';

const VENDOR_NOT_FOUND_MESSAGE = 'Vendor not found';

// Only the transitions docs/database/vendor-shop.md §6 explicitly draws
// (PENDING → UNDER_REVIEW → VERIFIED, PENDING/UNDER_REVIEW → REJECTED)
// are implemented — VERIFIED and REJECTED are treated as terminal (no
// outgoing arrow is documented from either), and no
// re-verification/re-application path is invented. Keyed by *target*
// status; the value lists which *current* statuses may transition into
// it. See Architecture Decision Register ADR-1
// (docs/remaining-architecture-plan.md) — this matrix is this phase's
// own narrow reading of §6, flagged as an assumption in its final report,
// not a literal enumerated table from the source document.
const ALLOWED_VERIFICATION_TRANSITIONS: Record<
  'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED',
  VendorVerificationStatus[]
> = {
  UNDER_REVIEW: ['PENDING'],
  VERIFIED: ['UNDER_REVIEW'],
  REJECTED: ['PENDING', 'UNDER_REVIEW'],
};

const INVALID_VERIFICATION_TRANSITION_MESSAGE =
  "The vendor's current verificationStatus does not allow this transition";

const INVALID_ACTIVATION_MESSAGE =
  'The vendor is not eligible for activation (must be status=PENDING and verificationStatus=VERIFIED)';

/**
 * Vendor onboarding/profile foundation (Phase 10), extended with
 * ADMIN-only verification/activation (Phase 17, ADR-1).
 *
 * `createForUser`/`findForUser` implement what docs/database/
 * vendor-shop.md §6 documents as the "Vendor Creation" flow: `User →
 * Vendor Application → Vendor Created` with `status = PENDING` and
 * `verificationStatus = PENDING` (both already the Prisma schema's
 * defaults — never set explicitly here).
 *
 * `verify`/`activate` implement §6's "Vendor Verification"/"Vendor
 * Activation" flows as two separate ADMIN-only operations (ADR-1) —
 * authorization itself is enforced entirely by the controller's
 * `@Roles('ADMIN')` + `AuthorizationGuard`, not re-checked here.
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

  /**
   * ADMIN-only: transitions a vendor's `verificationStatus` (ADR-1).
   * Never touches `status` — §4 of docs/database/vendor-shop.md is
   * explicit that verification and operational status "must not be
   * combined into a single field"; this method does not invent a
   * cascade between the two (e.g. a REJECTED verification does not set
   * `status = REJECTED`, since no source document states that rule).
   *
   * Uses the same atomic-conditional-update pattern already established
   * by `CheckoutService`'s inventory reservation: read the current state
   * to produce an accurate error, then write with that exact prior state
   * still in the `WHERE` clause so a concurrent request that already
   * changed it loses the race cleanly (0 rows affected) rather than
   * silently overwriting it. A single-row update needs no `$transaction`.
   */
  async verify(
    vendorId: string,
    dto: UpdateVendorVerificationDto,
  ): Promise<Vendor> {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, deletedAt: null },
    });

    if (!vendor) {
      throw new NotFoundException(VENDOR_NOT_FOUND_MESSAGE);
    }

    const allowedFrom =
      ALLOWED_VERIFICATION_TRANSITIONS[dto.verificationStatus];

    if (!allowedFrom.includes(vendor.verificationStatus)) {
      throw new ConflictException(INVALID_VERIFICATION_TRANSITION_MESSAGE);
    }

    const { count } = await this.prisma.vendor.updateMany({
      where: { id: vendorId, verificationStatus: vendor.verificationStatus },
      data: { verificationStatus: dto.verificationStatus },
    });

    if (count === 0) {
      // A concurrent request already changed verificationStatus between
      // the read above and this write.
      throw new ConflictException(INVALID_VERIFICATION_TRANSITION_MESSAGE);
    }

    return this.prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } });
  }

  /**
   * ADMIN-only: activates a vendor (ADR-1). Implements exactly the one
   * transition docs/database/vendor-shop.md §6 documents under "Vendor
   * Activation" — `verificationStatus = VERIFIED` + `status = PENDING`
   * → `status = ACTIVE` — and nothing else. No body/DTO is accepted: the
   * only valid target (`ACTIVE`) is not a client choice, so there is no
   * field for a client to submit (see this phase's final report).
   * Re-activating an already-ACTIVE vendor, or activating a
   * FROZEN/SUSPENDED/REJECTED vendor, is out of this phase's scope
   * (§14/§17 describe FROZEN/SUSPENDED as separate, undocumented
   * administrative actions, not part of "activation") and is rejected as
   * an invalid transition rather than silently invented.
   */
  async activate(vendorId: string): Promise<Vendor> {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, deletedAt: null },
    });

    if (!vendor) {
      throw new NotFoundException(VENDOR_NOT_FOUND_MESSAGE);
    }

    if (
      vendor.status !== 'PENDING' ||
      vendor.verificationStatus !== 'VERIFIED'
    ) {
      throw new ConflictException(INVALID_ACTIVATION_MESSAGE);
    }

    const { count } = await this.prisma.vendor.updateMany({
      where: {
        id: vendorId,
        status: 'PENDING',
        verificationStatus: 'VERIFIED',
      },
      data: { status: 'ACTIVE' },
    });

    if (count === 0) {
      // A concurrent request already changed status/verificationStatus
      // between the read above and this write.
      throw new ConflictException(INVALID_ACTIVATION_MESSAGE);
    }

    return this.prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } });
  }
}
