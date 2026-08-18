import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { OwnershipService } from '../auth/authorization/ownership.service';
import { Prisma, type Shop } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { toPublicShop, type PublicShop } from './utils/public-shop';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Deliberately generic — a caller with no vendor profile at all gets the
// same message as any other authorization failure elsewhere in this
// codebase (see AuthorizationGuard/VendorShopOwnershipGuard's
// FORBIDDEN_MESSAGE), never revealing which specific condition applied.
const NO_VENDOR_PROFILE_MESSAGE =
  'You do not have permission to perform this action.';

const DUPLICATE_SHOP_MESSAGE = 'This vendor already has a shop';
const DUPLICATE_SLUG_MESSAGE = 'This slug is already in use';
const SHOP_NOT_FOUND_MESSAGE = 'Shop not found';

/**
 * Shop creation/retrieval/update (Phase 10).
 *
 * Ownership for *existing* shops (GET/PATCH /shops/:shopId) is enforced
 * entirely by `VendorShopOwnershipGuard` before any of these methods run
 * — this service does not re-check ownership for those calls. Shop
 * *creation* has no existing shop to check ownership of, so this service
 * itself resolves the caller's own vendor profile via `OwnershipService`
 * (reused, not duplicated — see docs/database/vendor-shop.md §19:
 * "Client-provided vendor or shop identifiers must never be trusted
 * without authorization checks").
 */
@Injectable()
export class ShopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownershipService: OwnershipService,
  ) {}

  /**
   * Creates the shop for the authenticated user's own vendor profile.
   * `vendorId` is never accepted from the client — it is always resolved
   * from the caller's identity.
   *
   * `Shop.vendorId` is unique (docs/database/vendor-shop.md §12: "1
   * Vendor → 1 Shop"), so a second shop from the same vendor is a
   * conflict. `Shop.slug` is globally unique (§11/§12) independently of
   * vendor.
   */
  async createForUser(userId: string, dto: CreateShopDto): Promise<Shop> {
    const vendorId = await this.ownershipService.getVendorIdForUser(userId);

    if (!vendorId) {
      throw new ForbiddenException(NO_VENDOR_PROFILE_MESSAGE);
    }

    const existingShop = await this.prisma.shop.findUnique({
      where: { vendorId },
      select: { id: true },
    });

    if (existingShop) {
      throw new ConflictException(DUPLICATE_SHOP_MESSAGE);
    }

    try {
      return await this.prisma.shop.create({
        data: {
          vendorId,
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          logoUrl: dto.logoUrl,
          bannerUrl: dto.bannerUrl,
          // `status` intentionally omitted: defaults to ACTIVE per
          // prisma/schema/vendor-shop.prisma, matching §9/§10.
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION
      ) {
        // Either `vendorId` (a concurrent second request from the same
        // vendor) or `slug` (taken by any vendor) can be the violated
        // constraint; either way this is a conflict, not a server error.
        const target = (error.meta as { target?: string[] } | undefined)
          ?.target;
        const isSlugConflict = target?.includes('slug') ?? false;

        throw new ConflictException(
          isSlugConflict ? DUPLICATE_SLUG_MESSAGE : DUPLICATE_SHOP_MESSAGE,
        );
      }

      throw error;
    }
  }

  /**
   * Fetches a shop by id for authenticated vendor-management access.
   * Ownership (or the ADMIN bypass) has already been enforced by
   * `VendorShopOwnershipGuard` before this runs — the only remaining
   * concern here is existence, which the guard does not check for an
   * ADMIN caller (its admin bypass returns before any ownership/existence
   * query).
   */
  async findById(shopId: string): Promise<Shop> {
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null },
    });

    if (!shop) {
      throw new NotFoundException(SHOP_NOT_FOUND_MESSAGE);
    }

    return shop;
  }

  /**
   * Public storefront lookup by slug — no authentication, no ownership
   * check. Only ACTIVE, non-deleted shops are returned: §10 describes
   * ACTIVE as the state in which "the shop is operational and can be
   * displayed normally", implying INACTIVE/SUSPENDED shops are not
   * normally displayed. Any other case (shop does not exist, is not
   * ACTIVE, or is soft-deleted) is reported identically as "not found",
   * so a suspended/inactive shop's existence is not disclosed to the
   * public.
   */
  async findPublicBySlug(slug: string): Promise<PublicShop> {
    const shop = await this.prisma.shop.findFirst({
      where: { slug, status: 'ACTIVE', deletedAt: null },
    });

    if (!shop) {
      throw new NotFoundException(SHOP_NOT_FOUND_MESSAGE);
    }

    return toPublicShop(shop);
  }

  /**
   * Updates a shop by id. Ownership (or the ADMIN bypass) has already
   * been enforced by `VendorShopOwnershipGuard`. Only the fields present
   * on `UpdateShopDto` can ever reach here — `vendorId`, `id`, and the
   * timestamps are structurally impossible to set through this method
   * because they are not part of that DTO.
   */
  async update(shopId: string, dto: UpdateShopDto): Promise<Shop> {
    try {
      return await this.prisma.shop.update({
        where: { id: shopId, deletedAt: null },
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          logoUrl: dto.logoUrl,
          bannerUrl: dto.bannerUrl,
          status: dto.status,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION) {
          throw new ConflictException(DUPLICATE_SLUG_MESSAGE);
        }

        // P2025: the guard confirmed ownership at the start of the
        // request, but the row was deleted before this update executed
        // (a genuine, if rare, race).
        if (error.code === 'P2025') {
          throw new NotFoundException(SHOP_NOT_FOUND_MESSAGE);
        }
      }

      throw error;
    }
  }
}
