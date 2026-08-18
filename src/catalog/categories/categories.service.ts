import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Category, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const CATEGORY_NOT_FOUND_MESSAGE = 'Category not found';
const DUPLICATE_SLUG_MESSAGE = 'This slug is already in use';
const INVALID_PARENT_MESSAGE =
  'parentId does not reference an existing category';
const CIRCULAR_PARENT_MESSAGE =
  'parentId would create a circular category relationship';

/**
 * Category management (Phase 11). `Category` has no ownership field at
 * all (no `vendorId`/`userId` in docs/database/catalog.md §2 or
 * prisma/schema/catalog.prisma) — it is a shared, platform-wide product
 * taxonomy, not a vendor-owned resource. Mutating endpoints are
 * therefore gated by RBAC (`@Roles('ADMIN')` in CategoriesController),
 * not by `OwnershipService`/an ownership guard — there is no owner to
 * check ownership against. See this phase's final report for why ADMIN
 * specifically (an inference, not an explicit doc statement).
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findById(categoryId: string): Promise<Category> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
    });

    if (!category) {
      throw new NotFoundException(CATEGORY_NOT_FOUND_MESSAGE);
    }

    return category;
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    if (dto.parentId) {
      await this.assertParentExists(dto.parentId);
    }

    try {
      return await this.prisma.category.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          imageUrl: dto.imageUrl,
          parentId: dto.parentId,
          sortOrder: dto.sortOrder,
          // `status` intentionally omitted: defaults to ACTIVE per
          // prisma/schema/catalog.prisma, matching §2.
        },
      });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  async update(categoryId: string, dto: UpdateCategoryDto): Promise<Category> {
    // Existence check up front so cycle-detection and the parent-exists
    // check below operate against a category we know is real.
    await this.findById(categoryId);

    if (dto.parentId) {
      await this.assertParentExists(dto.parentId);
      await this.assertNoCycle(categoryId, dto.parentId);
    }

    try {
      return await this.prisma.category.update({
        where: { id: categoryId, deletedAt: null },
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          imageUrl: dto.imageUrl,
          parentId: dto.parentId,
          sortOrder: dto.sortOrder,
          status: dto.status,
        },
      });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  private async assertParentExists(parentId: string): Promise<void> {
    const parent = await this.prisma.category.findFirst({
      where: { id: parentId, deletedAt: null },
      select: { id: true },
    });

    if (!parent) {
      throw new BadRequestException(INVALID_PARENT_MESSAGE);
    }
  }

  /**
   * Prevents the cycle docs/database/catalog.md §2 warns about
   * (`A → B → A`) by walking up the proposed parent's ancestor chain and
   * rejecting if the category being updated appears anywhere in it
   * (including the trivial case of a category being set as its own
   * parent).
   */
  private async assertNoCycle(
    categoryId: string,
    proposedParentId: string,
  ): Promise<void> {
    let currentId: string | null = proposedParentId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === categoryId) {
        throw new BadRequestException(CIRCULAR_PARENT_MESSAGE);
      }

      // Defensive: only reachable if the existing data already contains a
      // cycle, which this method's own enforcement is meant to prevent.
      if (visited.has(currentId)) {
        break;
      }
      visited.add(currentId);

      const parent: { parentId: string | null } | null =
        await this.prisma.category.findUnique({
          where: { id: currentId },
          select: { parentId: true },
        });

      currentId = parent?.parentId ?? null;
    }
  }

  private translateWriteError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION) {
        return new ConflictException(DUPLICATE_SLUG_MESSAGE);
      }

      if (error.code === 'P2025') {
        return new NotFoundException(CATEGORY_NOT_FOUND_MESSAGE);
      }
    }

    return error as Error;
  }
}
