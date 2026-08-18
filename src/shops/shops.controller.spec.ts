import { ShopsController } from './shops.controller';
import type { CreateShopDto } from './dto/create-shop.dto';
import type { UpdateShopDto } from './dto/update-shop.dto';
import type { SafeUser } from '../auth/utils/safe-user';

describe('ShopsController', () => {
  let controller: ShopsController;

  const shopsService = {
    createForUser: jest.fn(),
    findById: jest.fn(),
    findPublicBySlug: jest.fn(),
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
    controller = new ShopsController(shopsService as any);
  });

  describe('create', () => {
    it("delegates to ShopsService.createForUser with the guard-resolved user's id, never a body-supplied one", async () => {
      const dto: CreateShopDto = {
        name: 'Taijul Electronics',
        slug: 'taijul-electronics',
      };
      shopsService.createForUser.mockResolvedValue({ id: 'shop-uuid' });

      await controller.create(user, dto);

      expect(shopsService.createForUser).toHaveBeenCalledWith(user.id, dto);
    });
  });

  describe('findPublicBySlug', () => {
    it('delegates to ShopsService.findPublicBySlug with the route param, no auth required', async () => {
      const publicShop = { id: 'shop-uuid', slug: 'taijul-electronics' };
      shopsService.findPublicBySlug.mockResolvedValue(publicShop);

      await expect(
        controller.findPublicBySlug('taijul-electronics'),
      ).resolves.toEqual(publicShop);
      expect(shopsService.findPublicBySlug).toHaveBeenCalledWith(
        'taijul-electronics',
      );
    });
  });

  describe('findById', () => {
    it('delegates to ShopsService.findById with the route param (ownership already enforced by the guard chain)', async () => {
      const shop = { id: 'shop-uuid' };
      shopsService.findById.mockResolvedValue(shop);

      await expect(controller.findById('shop-uuid')).resolves.toEqual(shop);
      expect(shopsService.findById).toHaveBeenCalledWith('shop-uuid');
    });
  });

  describe('update', () => {
    it('delegates to ShopsService.update with the route param and dto', async () => {
      const dto: UpdateShopDto = { name: 'New Name' };
      const updated = { id: 'shop-uuid', name: 'New Name' };
      shopsService.update.mockResolvedValue(updated);

      await expect(
        controller.update('shop-uuid', dto),
      ).resolves.toEqual(updated);
      expect(shopsService.update).toHaveBeenCalledWith('shop-uuid', dto);
    });
  });
});
