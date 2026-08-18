import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

import { VendorOrderOwnershipGuard } from './vendor-order-ownership.guard';
import type { SafeUser } from '../utils/safe-user';

describe('VendorOrderOwnershipGuard', () => {
  let guard: VendorOrderOwnershipGuard;

  const ownershipService = {
    getVendorIdForUser: jest.fn(),
    isVendorOrderOwnedByVendor: jest.fn(),
  };

  const authorizationService = {
    hasRole: jest.fn(),
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

  const buildContext = (
    requestUser: SafeUser | undefined,
    params: Record<string, string> = { vendorOrderId: 'vendor-order-uuid' },
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user: requestUser, params }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new VendorOrderOwnershipGuard(
      ownershipService as any,
      authorizationService as any,
    );
  });

  it('allows the owning vendor', async () => {
    authorizationService.hasRole.mockResolvedValue(false);
    ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
    ownershipService.isVendorOrderOwnedByVendor.mockResolvedValue(true);

    await expect(guard.canActivate(buildContext(user))).resolves.toBe(true);

    expect(ownershipService.getVendorIdForUser).toHaveBeenCalledWith(user.id);
    expect(ownershipService.isVendorOrderOwnedByVendor).toHaveBeenCalledWith(
      'vendor-order-uuid',
      'vendor-uuid',
    );
  });

  it('forbids (403) a non-owning vendor (vendor A cannot access vendor B resource)', async () => {
    authorizationService.hasRole.mockResolvedValue(false);
    ownershipService.getVendorIdForUser.mockResolvedValue('vendor-a-uuid');
    ownershipService.isVendorOrderOwnedByVendor.mockResolvedValue(false);

    await expect(guard.canActivate(buildContext(user))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('forbids (403) an unknown/nonexistent VendorOrder id', async () => {
    authorizationService.hasRole.mockResolvedValue(false);
    ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
    ownershipService.isVendorOrderOwnedByVendor.mockResolvedValue(false);

    await expect(
      guard.canActivate(
        buildContext(user, { vendorOrderId: 'nonexistent-uuid' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forbids (403) a user with no vendor profile at all (missing ownership relation)', async () => {
    authorizationService.hasRole.mockResolvedValue(false);
    ownershipService.getVendorIdForUser.mockResolvedValue(null);

    await expect(guard.canActivate(buildContext(user))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ownershipService.isVendorOrderOwnedByVendor).not.toHaveBeenCalled();
  });

  it('forbids (403, fail-closed) when no :vendorOrderId route param is present', async () => {
    authorizationService.hasRole.mockResolvedValue(false);

    await expect(
      guard.canActivate(buildContext(user, {})),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ownershipService.getVendorIdForUser).not.toHaveBeenCalled();
  });

  it('allows an ADMIN to access a VendorOrder they do not own (documented bypass)', async () => {
    authorizationService.hasRole.mockResolvedValue(true);

    await expect(guard.canActivate(buildContext(user))).resolves.toBe(true);

    expect(authorizationService.hasRole).toHaveBeenCalledWith(user.id, 'ADMIN');
    expect(ownershipService.getVendorIdForUser).not.toHaveBeenCalled();
    expect(ownershipService.isVendorOrderOwnedByVendor).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when there is no authenticated user on the request', async () => {
    await expect(
      guard.canActivate(buildContext(undefined)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authorizationService.hasRole).not.toHaveBeenCalled();
  });

  it('propagates database errors from the admin-role check instead of turning them into a 403', async () => {
    authorizationService.hasRole.mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    await expect(guard.canActivate(buildContext(user))).rejects.toThrow(
      'connection terminated unexpectedly',
    );
  });

  it('propagates database errors from the ownership check instead of turning them into a 403', async () => {
    authorizationService.hasRole.mockResolvedValue(false);
    ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
    ownershipService.isVendorOrderOwnedByVendor.mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    await expect(guard.canActivate(buildContext(user))).rejects.toThrow(
      'connection terminated unexpectedly',
    );
  });
});
