import { AuthorizationService } from './authorization.service';

describe('AuthorizationService', () => {
  let service: AuthorizationService;

  const prisma = {
    userRole: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    role: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthorizationService(prisma as any);
  });

  describe('getUserRoles', () => {
    it("resolves the user's role names", async () => {
      prisma.userRole.findMany.mockResolvedValue([
        { role: { name: 'ADMIN' } },
        { role: { name: 'VENDOR' } },
      ]);

      const result = await service.getUserRoles('user-uuid');

      expect(prisma.userRole.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid' },
        select: { role: { select: { name: true } } },
      });
      expect(result).toEqual(['ADMIN', 'VENDOR']);
    });

    it('returns an empty array for a user with no roles (including an unknown user id)', async () => {
      prisma.userRole.findMany.mockResolvedValue([]);

      await expect(service.getUserRoles('unknown-uuid')).resolves.toEqual([]);
    });

    it('propagates database errors', async () => {
      prisma.userRole.findMany.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.getUserRoles('user-uuid')).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('getUserPermissions', () => {
    it("resolves and de-duplicates permissions across the user's roles", async () => {
      prisma.role.findMany.mockResolvedValue([
        {
          permissions: [
            { permission: { resource: 'products', action: 'read' } },
            { permission: { resource: 'products', action: 'update' } },
          ],
        },
        {
          permissions: [
            // Same permission reachable via a second role — must appear
            // only once in the result.
            { permission: { resource: 'products', action: 'read' } },
            { permission: { resource: 'orders', action: 'read' } },
          ],
        },
      ]);

      const result = await service.getUserPermissions('user-uuid');

      expect(prisma.role.findMany).toHaveBeenCalledWith({
        where: { users: { some: { userId: 'user-uuid' } } },
        select: {
          permissions: {
            select: {
              permission: { select: { resource: true, action: true } },
            },
          },
        },
      });
      expect(result).toEqual([
        { resource: 'products', action: 'read' },
        { resource: 'products', action: 'update' },
        { resource: 'orders', action: 'read' },
      ]);
    });

    it('returns an empty array for a user with no roles', async () => {
      prisma.role.findMany.mockResolvedValue([]);

      await expect(service.getUserPermissions('unknown-uuid')).resolves.toEqual(
        [],
      );
    });

    it('propagates database errors', async () => {
      prisma.role.findMany.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.getUserPermissions('user-uuid')).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('hasRole', () => {
    it('returns true when the user has the role', async () => {
      prisma.userRole.count.mockResolvedValue(1);

      await expect(service.hasRole('user-uuid', 'ADMIN')).resolves.toBe(true);
      expect(prisma.userRole.count).toHaveBeenCalledWith({
        where: { userId: 'user-uuid', role: { name: 'ADMIN' } },
      });
    });

    it('returns false when the user does not have the role', async () => {
      prisma.userRole.count.mockResolvedValue(0);

      await expect(service.hasRole('user-uuid', 'ADMIN')).resolves.toBe(false);
    });

    it('returns false (fails closed) for an unknown user id, without throwing', async () => {
      prisma.userRole.count.mockResolvedValue(0);

      await expect(service.hasRole('unknown-uuid', 'ADMIN')).resolves.toBe(
        false,
      );
    });

    it('propagates database errors', async () => {
      prisma.userRole.count.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.hasRole('user-uuid', 'ADMIN')).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('hasPermission', () => {
    it('returns true when the user has the permission through some role', async () => {
      prisma.role.count.mockResolvedValue(1);

      await expect(
        service.hasPermission('user-uuid', 'products', 'read'),
      ).resolves.toBe(true);
      expect(prisma.role.count).toHaveBeenCalledWith({
        where: {
          users: { some: { userId: 'user-uuid' } },
          permissions: {
            some: { permission: { resource: 'products', action: 'read' } },
          },
        },
      });
    });

    it('returns false when the user does not have the permission', async () => {
      prisma.role.count.mockResolvedValue(0);

      await expect(
        service.hasPermission('user-uuid', 'products', 'read'),
      ).resolves.toBe(false);
    });

    it('returns false (fails closed) for an unknown user id, without throwing', async () => {
      prisma.role.count.mockResolvedValue(0);

      await expect(
        service.hasPermission('unknown-uuid', 'products', 'read'),
      ).resolves.toBe(false);
    });

    it('propagates database errors', async () => {
      prisma.role.count.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.hasPermission('user-uuid', 'products', 'read'),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });
});
