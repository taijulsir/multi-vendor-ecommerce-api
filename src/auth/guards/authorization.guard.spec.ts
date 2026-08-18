import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthorizationGuard } from './authorization.guard';
import type { SafeUser } from '../utils/safe-user';

describe('AuthorizationGuard', () => {
  let guard: AuthorizationGuard;

  const reflector = {
    getAllAndOverride: jest.fn(),
  };

  const authorizationService = {
    hasRole: jest.fn(),
    hasPermission: jest.fn(),
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

  const buildContext = (requestUser: SafeUser | undefined): ExecutionContext =>
    ({
      getHandler: () => function handler() {},
      getClass: () => class TestController {},
      switchToHttp: () => ({
        getRequest: () => ({ user: requestUser }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new AuthorizationGuard(
      reflector as any,
      authorizationService as any,
    );
  });

  it('allows the request through when no @Roles()/@Permissions() metadata is present', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(buildContext(user))).resolves.toBe(true);

    expect(authorizationService.hasRole).not.toHaveBeenCalled();
    expect(authorizationService.hasPermission).not.toHaveBeenCalled();
  });

  it('allows the request through when metadata is present but declares an empty list', async () => {
    reflector.getAllAndOverride.mockReturnValue([]);

    await expect(guard.canActivate(buildContext(user))).resolves.toBe(true);
  });

  describe('role requirement', () => {
    it('allows when the user has the required role', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) =>
        key === 'rbac:roles' ? ['ADMIN'] : undefined,
      );
      authorizationService.hasRole.mockResolvedValue(true);

      await expect(guard.canActivate(buildContext(user))).resolves.toBe(true);
      expect(authorizationService.hasRole).toHaveBeenCalledWith(
        user.id,
        'ADMIN',
      );
    });

    it('forbids (403) when the user lacks the required role', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) =>
        key === 'rbac:roles' ? ['ADMIN'] : undefined,
      );
      authorizationService.hasRole.mockResolvedValue(false);

      await expect(
        guard.canActivate(buildContext(user)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows with multiple roles when the user has at least one (OR semantics)', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) =>
        key === 'rbac:roles' ? ['ADMIN', 'VENDOR'] : undefined,
      );
      authorizationService.hasRole.mockImplementation(
        async (_userId: string, role: string) => role === 'VENDOR',
      );

      await expect(guard.canActivate(buildContext(user))).resolves.toBe(true);
      expect(authorizationService.hasRole).toHaveBeenCalledWith(
        user.id,
        'ADMIN',
      );
      expect(authorizationService.hasRole).toHaveBeenCalledWith(
        user.id,
        'VENDOR',
      );
    });

    it('forbids with multiple roles when the user has none of them', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) =>
        key === 'rbac:roles' ? ['ADMIN', 'VENDOR'] : undefined,
      );
      authorizationService.hasRole.mockResolvedValue(false);

      await expect(
        guard.canActivate(buildContext(user)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('permission requirement', () => {
    it('allows when the user has the required permission', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) =>
        key === 'rbac:permissions'
          ? [{ resource: 'products', action: 'read' }]
          : undefined,
      );
      authorizationService.hasPermission.mockResolvedValue(true);

      await expect(guard.canActivate(buildContext(user))).resolves.toBe(true);
      expect(authorizationService.hasPermission).toHaveBeenCalledWith(
        user.id,
        'products',
        'read',
      );
    });

    it('forbids (403) when the user lacks the required permission', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) =>
        key === 'rbac:permissions'
          ? [{ resource: 'products', action: 'read' }]
          : undefined,
      );
      authorizationService.hasPermission.mockResolvedValue(false);

      await expect(
        guard.canActivate(buildContext(user)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires every permission when multiple are declared (AND semantics)', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) =>
        key === 'rbac:permissions'
          ? [
              { resource: 'products', action: 'read' },
              { resource: 'inventory', action: 'adjust' },
            ]
          : undefined,
      );
      authorizationService.hasPermission.mockImplementation(
        async (_userId: string, resource: string) => resource === 'products',
      );

      await expect(
        guard.canActivate(buildContext(user)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows when the user has every declared permission', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) =>
        key === 'rbac:permissions'
          ? [
              { resource: 'products', action: 'read' },
              { resource: 'inventory', action: 'adjust' },
            ]
          : undefined,
      );
      authorizationService.hasPermission.mockResolvedValue(true);

      await expect(guard.canActivate(buildContext(user))).resolves.toBe(true);
    });
  });

  describe('role + permission combination', () => {
    it('requires both when both are declared (AND) — role satisfied, permission not', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === 'rbac:roles') return ['ADMIN'];
        if (key === 'rbac:permissions') {
          return [{ resource: 'products', action: 'read' }];
        }
        return undefined;
      });
      authorizationService.hasRole.mockResolvedValue(true);
      authorizationService.hasPermission.mockResolvedValue(false);

      await expect(
        guard.canActivate(buildContext(user)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires both when both are declared (AND) — permission satisfied, role not', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === 'rbac:roles') return ['ADMIN'];
        if (key === 'rbac:permissions') {
          return [{ resource: 'products', action: 'read' }];
        }
        return undefined;
      });
      authorizationService.hasRole.mockResolvedValue(false);
      authorizationService.hasPermission.mockResolvedValue(true);

      await expect(
        guard.canActivate(buildContext(user)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows only when both the role and the permission are satisfied', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === 'rbac:roles') return ['ADMIN'];
        if (key === 'rbac:permissions') {
          return [{ resource: 'products', action: 'read' }];
        }
        return undefined;
      });
      authorizationService.hasRole.mockResolvedValue(true);
      authorizationService.hasPermission.mockResolvedValue(true);

      await expect(guard.canActivate(buildContext(user))).resolves.toBe(true);
    });
  });

  it('throws UnauthorizedException when RBAC metadata is present but there is no authenticated user on the request', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === 'rbac:roles' ? ['ADMIN'] : undefined,
    );

    await expect(
      guard.canActivate(buildContext(undefined)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authorizationService.hasRole).not.toHaveBeenCalled();
  });

  it('propagates database errors from AuthorizationService instead of turning them into a 403', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === 'rbac:roles' ? ['ADMIN'] : undefined,
    );
    authorizationService.hasRole.mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    await expect(guard.canActivate(buildContext(user))).rejects.toThrow(
      'connection terminated unexpectedly',
    );
  });
});
