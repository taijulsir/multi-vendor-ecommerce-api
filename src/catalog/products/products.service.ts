import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { OwnershipService } from '../../auth/authorization/ownership.service';
import { Prisma, type Product } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  toPublicProduct,
  type PaginatedPublicProducts,
  type PublicProduct,
} from './utils/public-product';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const PRISMA_FOREIGN_KEY_VIOLATION = 'P2003';

// Deliberately generic — matches the same non-disclosure message used by
// VendorShopOwnershipGuard/ShopsService for "no vendor profile".
const NO_VENDOR_PROFILE_MESSAGE =
  'You do not have permission to perform this action.';

const PRODUCT_NOT_FOUND_MESSAGE = 'Product not found';
const DUPLICATE_SLUG_MESSAGE = 'This slug is already in use';
const INVALID_CATEGORY_MESSAGE =
  'categoryId does not reference an existing category';

/**
 * Product creation/retrieval/update (Phase 11).
 *
 * Ownership for *existing* products (GET/PATCH /products/:productId) is
 * enforced by `ProductOwnershipGuard` before any of these methods run —
 * this service does not re-check ownership for those calls. Product
 * *creation* has no existing product to check ownership of, so this
 * service resolves the caller's own vendor profile via
 * `OwnershipService` (reused, not duplicated) — same pattern as
 * `ShopsService.createForUser`.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownershipService: OwnershipService,
  ) {}

  async createForUser(userId: string, dto: CreateProductDto): Promise<Product> {
    const vendorId = await this.ownershipService.getVendorIdForUser(userId);

    if (!vendorId) {
      throw new ForbiddenException(NO_VENDOR_PROFILE_MESSAGE);
    }

    await this.assertCategoryExists(dto.categoryId);

    try {
      return await this.prisma.product.create({
        data: {
          vendorId,
          categoryId: dto.categoryId,
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          productType: dto.productType,
          // `status` intentionally omitted: defaults to DRAFT per
          // prisma/schema/catalog.prisma, matching §3/§4.
        },
      });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  /**
   * Fetches a product by id for authenticated vendor-management access.
   * Ownership (or the ADMIN bypass) has already been enforced by
   * `ProductOwnershipGuard` — the only remaining concern here is
   * existence, which the guard does not check for an ADMIN caller (its
   * admin bypass returns before any ownership/existence query).
   */
  async findById(productId: string): Promise<Product> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
    });

    if (!product) {
      throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
    }

    return product;
  }

  /**
   * Public storefront lookup by slug — no authentication, no ownership
   * check. Only ACTIVE, non-deleted products are returned: §4 describes
   * ACTIVE as "published and available for normal storefront
   * operations", while DRAFT is explicitly "not published to customers"
   * and INACTIVE/ARCHIVED are explicitly not normal-sale states. Any
   * other case is reported identically as "not found".
   */
  async findPublicBySlug(slug: string): Promise<PublicProduct> {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE', deletedAt: null },
    });

    if (!product) {
      throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
    }

    return toPublicProduct(product);
  }

  /**
   * Public storefront product list (Phase 20) — same visibility rule as
   * `findPublicBySlug`: only `ACTIVE`, non-deleted products. No
   * category/vendor/search filter exists here because none is documented
   * anywhere in docs/database/catalog.md (see this phase's final report)
   * — pagination (docs/architecture.md §16's envelope) is the only
   * capability this phase adds. Ordered newest-first, matching the
   * default ordering convention already used by every other list method
   * in this codebase (e.g. `VendorOrdersService.findMyVendorOrders`).
   */
  async findPublicList(
    query: ListProductsQueryDto,
  ): Promise<PaginatedPublicProducts> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { status: 'ACTIVE' as const, deletedAt: null };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: products.map(toPublicProduct),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Updates a product by id. Ownership (or the ADMIN bypass) has already
   * been enforced by `ProductOwnershipGuard`. Only the fields present on
   * `UpdateProductDto` can ever reach here.
   */
  async update(productId: string, dto: UpdateProductDto): Promise<Product> {
    if (dto.categoryId) {
      await this.assertCategoryExists(dto.categoryId);
    }

    try {
      return await this.prisma.product.update({
        where: { id: productId, deletedAt: null },
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          categoryId: dto.categoryId,
          status: dto.status,
        },
      });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { id: true },
    });

    if (!category) {
      throw new BadRequestException(INVALID_CATEGORY_MESSAGE);
    }
  }

  private translateWriteError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION) {
        return new ConflictException(DUPLICATE_SLUG_MESSAGE);
      }

      if (error.code === PRISMA_FOREIGN_KEY_VIOLATION) {
        return new BadRequestException(INVALID_CATEGORY_MESSAGE);
      }

      if (error.code === 'P2025') {
        return new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
      }
    }

    return error as Error;
  }
}
