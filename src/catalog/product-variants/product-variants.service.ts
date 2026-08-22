import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma, type ProductVariant } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const PRODUCT_NOT_FOUND_MESSAGE = 'Product not found';
const VARIANT_NOT_FOUND_MESSAGE = 'Variant not found';
const DUPLICATE_SKU_MESSAGE = 'This SKU is already in use';

/**
 * ProductVariant management (Phase 21). Ownership for every route here
 * is enforced entirely by `ProductOwnershipGuard` against the `:productId`
 * route param — every method below still re-scopes its own Prisma query
 * to that same `productId` (never trusting the guard alone for the
 * variant/product relationship specifically), so a `variantId` that
 * exists but belongs to a *different* product a caller might also own is
 * reported identically to "does not exist," never silently operated on.
 *
 * **`isDefault` is never client-settable, at creation or update.**
 * docs/database/catalog.md §20/§22 states the invariant ("a product must
 * have a default sellable variant," "one Product → maximum one active
 * default Variant") but explicitly leaves the *enforcement mechanism*
 * undefined (DB partial-unique-index vs. application-transaction check —
 * see docs/remaining-architecture-plan.md Section 22, "still genuinely
 * open"). Rather than inventing one, this phase sidesteps the question
 * entirely: a product's *first* variant is deterministically made the
 * default (satisfying "must have a default"), and no mechanism exists
 * anywhere in this phase to reassign it (satisfying "at most one" by
 * construction — there is only ever one assignment, ever). Reassigning
 * the default to a different, later-created variant remains genuinely
 * unresolved and is reported, not implemented — see this phase's final
 * report.
 */
@Injectable()
export class ProductVariantsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a variant and its 1:1 `Inventory` row (defaulting
   * `onHand: 0`) atomically, per docs/remaining-architecture-plan.md
   * Section 10 ("creating a ProductVariant should create its Inventory
   * row... in the same transaction"). `productId` always comes from the
   * route, never the request body.
   */
  async createForProduct(
    productId: string,
    dto: CreateVariantDto,
  ): Promise<ProductVariant> {
    await this.assertProductExists(productId);

    const isFirstVariant =
      (await this.prisma.productVariant.count({ where: { productId } })) === 0;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.create({
          data: {
            productId,
            sku: dto.sku,
            name: dto.name,
            price: dto.price,
            compareAtPrice: dto.compareAtPrice,
            costPrice: dto.costPrice,
            currency: dto.currency,
            attributes: (dto.attributes ?? {}) as Prisma.InputJsonValue,
            // The one and only place `isDefault` is ever set — see this
            // class's doc-comment.
            isDefault: isFirstVariant,
          },
        });

        await tx.inventory.create({
          data: { variantId: variant.id, onHand: 0, reserved: 0 },
        });

        return variant;
      });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  /**
   * Lists every variant of a product, any status — this is the vendor's
   * own management view (docs/database/catalog.md has no documented
   * public variant-browsing endpoint; see this phase's final report for
   * why none was added here).
   */
  async findAllForProduct(productId: string): Promise<ProductVariant[]> {
    await this.assertProductExists(productId);

    return this.prisma.productVariant.findMany({
      where: { productId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(productId: string, variantId: string): Promise<ProductVariant> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, deletedAt: null },
    });

    if (!variant) {
      throw new NotFoundException(VARIANT_NOT_FOUND_MESSAGE);
    }

    return variant;
  }

  async update(
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
  ): Promise<ProductVariant> {
    // Existence (scoped to this productId) confirmed up front so a
    // variant belonging to a different product can never be updated
    // merely because the caller owns *some* product.
    await this.findOne(productId, variantId);

    try {
      return await this.prisma.productVariant.update({
        where: { id: variantId, deletedAt: null },
        data: {
          sku: dto.sku,
          name: dto.name,
          price: dto.price,
          compareAtPrice: dto.compareAtPrice,
          costPrice: dto.costPrice,
          currency: dto.currency,
          attributes: dto.attributes as Prisma.InputJsonValue | undefined,
          status: dto.status,
        },
      });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  private async assertProductExists(productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
    }
  }

  private translateWriteError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION) {
        return new ConflictException(DUPLICATE_SKU_MESSAGE);
      }

      if (error.code === 'P2025') {
        return new NotFoundException(VARIANT_NOT_FOUND_MESSAGE);
      }
    }

    return error as Error;
  }
}
