import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { CategoriesService } from './categories.service';

describe('CategoriesService', () => {
  let service: CategoriesService;

  const prisma = {
    category: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CategoriesService(prisma as any);
  });

  describe('findAll', () => {
    it('returns non-deleted categories ordered by sortOrder then name', async () => {
      const categories = [{ id: 'cat-1' }, { id: 'cat-2' }];
      prisma.category.findMany.mockResolvedValue(categories);

      await expect(service.findAll()).resolves.toEqual(categories);
      expect(prisma.category.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
    });
  });

  describe('findById', () => {
    it('returns the category', async () => {
      const category = { id: 'cat-1' };
      prisma.category.findFirst.mockResolvedValue(category);

      await expect(service.findById('cat-1')).resolves.toEqual(category);
    });

    it('throws NotFoundException for a nonexistent category', async () => {
      prisma.category.findFirst.mockResolvedValue(null);

      await expect(service.findById('unknown')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    const dto = { name: 'Electronics', slug: 'electronics' };

    it('creates a root category (no parentId)', async () => {
      const created = { id: 'cat-1', ...dto, parentId: null };
      prisma.category.create.mockResolvedValue(created);

      await expect(service.create(dto)).resolves.toEqual(created);
      expect(prisma.category.findFirst).not.toHaveBeenCalled();
    });

    it('creates a child category when parentId exists', async () => {
      prisma.category.findFirst.mockResolvedValue({ id: 'parent-uuid' });
      prisma.category.create.mockResolvedValue({ id: 'cat-2' });

      await service.create({ ...dto, parentId: 'parent-uuid' });

      expect(prisma.category.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ parentId: 'parent-uuid' }),
      });
    });

    it('rejects (400) a parentId that does not reference an existing category', async () => {
      prisma.category.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ ...dto, parentId: 'nonexistent' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.category.create).not.toHaveBeenCalled();
    });

    it('rejects (409) a duplicate slug', async () => {
      prisma.category.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.create(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('propagates unrelated database errors', async () => {
      prisma.category.create.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.create(dto)).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('update', () => {
    it('updates documented fields', async () => {
      prisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });
      const updated = { id: 'cat-1', name: 'New Name' };
      prisma.category.update.mockResolvedValue(updated);

      await expect(
        service.update('cat-1', { name: 'New Name' }),
      ).resolves.toEqual(updated);
    });

    it('throws NotFoundException when the category does not exist', async () => {
      prisma.category.findFirst.mockResolvedValue(null);

      await expect(
        service.update('unknown', { name: 'New Name' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('rejects (400) reparenting to a nonexistent category', async () => {
      prisma.category.findFirst
        .mockResolvedValueOnce({ id: 'cat-1' }) // existence check
        .mockResolvedValueOnce(null); // parent existence check

      await expect(
        service.update('cat-1', { parentId: 'nonexistent' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects (400) a parentId that would create a direct self-cycle', async () => {
      prisma.category.findFirst
        .mockResolvedValueOnce({ id: 'cat-1' }) // existence check
        .mockResolvedValueOnce({ id: 'cat-1' }); // parent existence check (itself)

      await expect(
        service.update('cat-1', { parentId: 'cat-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('rejects (400) a parentId that would create an indirect cycle (A → B → A)', async () => {
      // cat-A is being updated to have cat-B as its parent, but cat-B's
      // parent is already cat-A.
      prisma.category.findFirst
        .mockResolvedValueOnce({ id: 'cat-A' }) // existence check
        .mockResolvedValueOnce({ id: 'cat-B' }); // parent existence check
      prisma.category.findUnique.mockResolvedValueOnce({ parentId: 'cat-A' }); // walking up from cat-B

      await expect(
        service.update('cat-A', { parentId: 'cat-B' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('rejects (409) a duplicate slug on update', async () => {
      prisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });
      prisma.category.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.update('cat-1', { slug: 'taken' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('propagates unrelated database errors', async () => {
      prisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });
      prisma.category.update.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.update('cat-1', { name: 'New Name' }),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });
});
