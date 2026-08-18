import { UnauthorizedException } from '@nestjs/common';

import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  const configService = {
    getOrThrow: jest.fn().mockReturnValue('test-jwt-access-secret'),
  };

  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const activeUser = {
    id: 'user-uuid',
    email: 'jane.doe@example.com',
    passwordHash: 'hashed-password',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: null,
    avatarUrl: null,
    status: 'ACTIVE',
    emailVerifiedAt: null,
    lastLoginAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(configService as any, prisma as any);
  });

  it('returns the safe user for a valid payload referencing an ACTIVE user', async () => {
    prisma.user.findUnique.mockResolvedValue(activeUser);

    const result = await strategy.validate({ sub: activeUser.id });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: activeUser.id },
    });
    expect(result.id).toBe(activeUser.id);
    expect(result.email).toBe(activeUser.email);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('throws UnauthorizedException for an unknown user ID', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'nonexistent-uuid' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException for a SUSPENDED user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...activeUser,
      status: 'SUSPENDED',
    });

    await expect(
      strategy.validate({ sub: activeUser.id }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException for a BLOCKED user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...activeUser,
      status: 'BLOCKED',
    });

    await expect(
      strategy.validate({ sub: activeUser.id }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException for a payload missing a usable sub claim, without querying the database', async () => {
    await expect(
      strategy.validate({ sub: undefined as unknown as string }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate({ sub: '' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('treats a database lookup failure (e.g. a malformed sub) as an authentication failure, not an internal error', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('Invalid UUID format'));

    await expect(
      strategy.validate({ sub: 'not-a-valid-uuid' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
