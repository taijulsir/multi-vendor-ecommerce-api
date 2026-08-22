import { ProductVariantsController } from './product-variants.controller';
import type { SafeUser } from '../../auth/utils/safe-user';

describe('ProductVariantsController', () => {
  let controller: ProductVariantsController;

  const productVariantsService = {
    createForProduct: jest.fn(),
    findAllForProduct: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  const inventoryService = {
    findForVariant: jest.fn(),
    restock: jest.fn(),
    adjust: jest.fn(),
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
    controller = new ProductVariantsController(
      productVariantsService as any,
      inventoryService as any,
    );
  });

  it('create delegates to ProductVariantsService.createForProduct with the productId route param', async () => {
    const dto = { sku: 'SKU-1', price: '2500.00', currency: 'BDT' };
    productVariantsService.createForProduct.mockResolvedValue({
      id: 'variant-uuid',
    });

    await controller.create('product-uuid', dto);

    expect(productVariantsService.createForProduct).toHaveBeenCalledWith(
      'product-uuid',
      dto,
    );
  });

  it('findAll delegates to ProductVariantsService.findAllForProduct', async () => {
    productVariantsService.findAllForProduct.mockResolvedValue([]);

    await expect(controller.findAll('product-uuid')).resolves.toEqual([]);
    expect(productVariantsService.findAllForProduct).toHaveBeenCalledWith(
      'product-uuid',
    );
  });

  it('findOne delegates to ProductVariantsService.findOne with both route params', async () => {
    const variant = { id: 'variant-uuid' };
    productVariantsService.findOne.mockResolvedValue(variant);

    await expect(
      controller.findOne('product-uuid', 'variant-uuid'),
    ).resolves.toEqual(variant);
    expect(productVariantsService.findOne).toHaveBeenCalledWith(
      'product-uuid',
      'variant-uuid',
    );
  });

  it('update delegates to ProductVariantsService.update with both route params and the dto', async () => {
    const dto = { name: 'New Name' };
    const updated = { id: 'variant-uuid', name: 'New Name' };
    productVariantsService.update.mockResolvedValue(updated);

    await expect(
      controller.update('product-uuid', 'variant-uuid', dto),
    ).resolves.toEqual(updated);
    expect(productVariantsService.update).toHaveBeenCalledWith(
      'product-uuid',
      'variant-uuid',
      dto,
    );
  });

  it('findInventory delegates to InventoryService.findForVariant', async () => {
    const inventory = { id: 'inventory-uuid' };
    inventoryService.findForVariant.mockResolvedValue(inventory);

    await expect(
      controller.findInventory('product-uuid', 'variant-uuid'),
    ).resolves.toEqual(inventory);
    expect(inventoryService.findForVariant).toHaveBeenCalledWith(
      'product-uuid',
      'variant-uuid',
    );
  });

  it("restock delegates to InventoryService.restock with the guard-resolved user's id, never a body-supplied one", async () => {
    const dto = { quantity: 10 };
    inventoryService.restock.mockResolvedValue({ id: 'inventory-uuid' });

    await controller.restock(user, 'product-uuid', 'variant-uuid', dto);

    expect(inventoryService.restock).toHaveBeenCalledWith(
      'product-uuid',
      'variant-uuid',
      dto,
      user.id,
    );
  });

  it("adjust delegates to InventoryService.adjust with the guard-resolved user's id, never a body-supplied one", async () => {
    const dto = { delta: -3 };
    inventoryService.adjust.mockResolvedValue({ id: 'inventory-uuid' });

    await controller.adjust(user, 'product-uuid', 'variant-uuid', dto);

    expect(inventoryService.adjust).toHaveBeenCalledWith(
      'product-uuid',
      'variant-uuid',
      dto,
      user.id,
    );
  });
});
