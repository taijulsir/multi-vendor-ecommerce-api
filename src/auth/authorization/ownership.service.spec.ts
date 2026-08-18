import { OwnershipService } from './ownership.service';

describe('OwnershipService', () => {
  let service: OwnershipService;

  const prisma = {
    vendor: {
      findUnique: jest.fn(),
    },
    shop: {
      count: jest.fn(),
    },
    product: {
      count: jest.fn(),
    },
    vendorOrder: {
      count: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OwnershipService(prisma as any);
  });

  describe('getVendorIdForUser', () => {
    it("resolves the user's vendor id when the user has a vendor profile", async () => {
      prisma.vendor.findUnique.mockResolvedValue({ id: 'vendor-uuid' });

      await expect(service.getVendorIdForUser('user-uuid')).resolves.toBe(
        'vendor-uuid',
      );
      expect(prisma.vendor.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-uuid', deletedAt: null },
        select: { id: true },
      });
    });

    it('returns null when the user has no vendor profile', async () => {
      prisma.vendor.findUnique.mockResolvedValue(null);

      await expect(service.getVendorIdForUser('user-uuid')).resolves.toBeNull();
    });

    it('returns null (fails closed) for an unknown user id, without throwing', async () => {
      prisma.vendor.findUnique.mockResolvedValue(null);

      await expect(
        service.getVendorIdForUser('unknown-uuid'),
      ).resolves.toBeNull();
    });

    it('propagates database errors', async () => {
      prisma.vendor.findUnique.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.getVendorIdForUser('user-uuid')).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('isShopOwnedByVendor', () => {
    it('returns true when the shop belongs to the vendor', async () => {
      prisma.shop.count.mockResolvedValue(1);

      await expect(
        service.isShopOwnedByVendor('shop-uuid', 'vendor-uuid'),
      ).resolves.toBe(true);
      expect(prisma.shop.count).toHaveBeenCalledWith({
        where: { id: 'shop-uuid', vendorId: 'vendor-uuid' },
      });
    });

    it('returns false when the shop belongs to a different vendor', async () => {
      prisma.shop.count.mockResolvedValue(0);

      await expect(
        service.isShopOwnedByVendor('shop-uuid', 'vendor-uuid'),
      ).resolves.toBe(false);
    });

    it('returns false (fails closed) for an unknown shop id, without throwing', async () => {
      prisma.shop.count.mockResolvedValue(0);

      await expect(
        service.isShopOwnedByVendor('unknown-shop-uuid', 'vendor-uuid'),
      ).resolves.toBe(false);
    });

    it('propagates database errors', async () => {
      prisma.shop.count.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.isShopOwnedByVendor('shop-uuid', 'vendor-uuid'),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });

  describe('isProductOwnedByVendor', () => {
    it('returns true when the product belongs to the vendor', async () => {
      prisma.product.count.mockResolvedValue(1);

      await expect(
        service.isProductOwnedByVendor('product-uuid', 'vendor-uuid'),
      ).resolves.toBe(true);
      expect(prisma.product.count).toHaveBeenCalledWith({
        where: { id: 'product-uuid', vendorId: 'vendor-uuid' },
      });
    });

    it('returns false when the product belongs to a different vendor', async () => {
      prisma.product.count.mockResolvedValue(0);

      await expect(
        service.isProductOwnedByVendor('product-uuid', 'vendor-uuid'),
      ).resolves.toBe(false);
    });

    it('returns false (fails closed) for an unknown product id, without throwing', async () => {
      prisma.product.count.mockResolvedValue(0);

      await expect(
        service.isProductOwnedByVendor('unknown-product-uuid', 'vendor-uuid'),
      ).resolves.toBe(false);
    });

    it('propagates database errors', async () => {
      prisma.product.count.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.isProductOwnedByVendor('product-uuid', 'vendor-uuid'),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });

  describe('isVendorOrderOwnedByVendor', () => {
    it('returns true when the VendorOrder belongs to the vendor', async () => {
      prisma.vendorOrder.count.mockResolvedValue(1);

      await expect(
        service.isVendorOrderOwnedByVendor('vendor-order-uuid', 'vendor-uuid'),
      ).resolves.toBe(true);
      expect(prisma.vendorOrder.count).toHaveBeenCalledWith({
        where: { id: 'vendor-order-uuid', vendorId: 'vendor-uuid' },
      });
    });

    it('returns false when the VendorOrder belongs to a different vendor', async () => {
      prisma.vendorOrder.count.mockResolvedValue(0);

      await expect(
        service.isVendorOrderOwnedByVendor('vendor-order-uuid', 'vendor-uuid'),
      ).resolves.toBe(false);
    });

    it('returns false (fails closed) for an unknown VendorOrder id, without throwing', async () => {
      prisma.vendorOrder.count.mockResolvedValue(0);

      await expect(
        service.isVendorOrderOwnedByVendor('unknown-uuid', 'vendor-uuid'),
      ).resolves.toBe(false);
    });

    it('propagates database errors', async () => {
      prisma.vendorOrder.count.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.isVendorOrderOwnedByVendor('vendor-order-uuid', 'vendor-uuid'),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });
});
