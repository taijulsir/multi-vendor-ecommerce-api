import { ProductsController } from './products.controller';
import type { CreateProductDto } from './dto/create-product.dto';
import type { UpdateProductDto } from './dto/update-product.dto';
import type { SafeUser } from '../../auth/utils/safe-user';

describe('ProductsController', () => {
  let controller: ProductsController;

  const productsService = {
    createForUser: jest.fn(),
    findById: jest.fn(),
    findPublicBySlug: jest.fn(),
    findPublicList: jest.fn(),
    update: jest.fn(),
  };

  const user: SafeUser = {
    id: 'user-uuid',
    email: 'jane.doe@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: null,
    avatarUrl: null,
    status: 'ACTIVE',
    emailVerifiedAt: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ProductsController(productsService as any);
  });

  describe('create', () => {
    it("delegates to ProductsService.createForUser with the guard-resolved user's id, never a body-supplied one", async () => {
      const dto: CreateProductDto = {
        name: 'iPhone',
        slug: 'iphone',
        categoryId: 'category-uuid',
      };
      productsService.createForUser.mockResolvedValue({ id: 'product-uuid' });

      await controller.create(user, dto);

      expect(productsService.createForUser).toHaveBeenCalledWith(user.id, dto);
    });
  });

  describe('findPublicList', () => {
    it('delegates to ProductsService.findPublicList with the query params, no auth required', async () => {
      const page = {
        data: [{ id: 'product-uuid' }],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      };
      productsService.findPublicList.mockResolvedValue(page);

      await expect(controller.findPublicList({})).resolves.toEqual(page);
      expect(productsService.findPublicList).toHaveBeenCalledWith({});
    });
  });

  describe('findPublicBySlug', () => {
    it('delegates to ProductsService.findPublicBySlug with the route param, no auth required', async () => {
      const publicProduct = { id: 'product-uuid', slug: 'iphone' };
      productsService.findPublicBySlug.mockResolvedValue(publicProduct);

      await expect(controller.findPublicBySlug('iphone')).resolves.toEqual(
        publicProduct,
      );
      expect(productsService.findPublicBySlug).toHaveBeenCalledWith('iphone');
    });
  });

  describe('findById', () => {
    it('delegates to ProductsService.findById with the route param (ownership already enforced by the guard chain)', async () => {
      const product = { id: 'product-uuid' };
      productsService.findById.mockResolvedValue(product);

      await expect(controller.findById('product-uuid')).resolves.toEqual(
        product,
      );
      expect(productsService.findById).toHaveBeenCalledWith('product-uuid');
    });
  });

  describe('update', () => {
    it('delegates to ProductsService.update with the route param and dto', async () => {
      const dto: UpdateProductDto = { name: 'New Name' };
      const updated = { id: 'product-uuid', name: 'New Name' };
      productsService.update.mockResolvedValue(updated);

      await expect(controller.update('product-uuid', dto)).resolves.toEqual(
        updated,
      );
      expect(productsService.update).toHaveBeenCalledWith('product-uuid', dto);
    });
  });
});
