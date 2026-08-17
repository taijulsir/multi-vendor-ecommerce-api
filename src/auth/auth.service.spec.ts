import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

describe('AuthService', () => {
  let service: AuthService;

  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const passwordService = {
    hash: jest.fn(),
    verify: jest.fn(),
  };

  const jwtService = {
    signAsync: jest.fn(),
  };

  const refreshTokenService = {
    generate: jest.fn(),
    hash: jest.fn(),
    getExpiresAt: jest.fn(),
  };

  const dto: RegisterDto = {
    email: 'jane.doe@example.com',
    password: 'StrongPassw0rd!',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '+8801XXXXXXXXX',
  };

  const persistedUser = {
    id: 'user-uuid',
    email: dto.email,
    passwordHash: 'hashed-password',
    firstName: dto.firstName,
    lastName: dto.lastName,
    phone: dto.phone,
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
    service = new AuthService(
      prisma as any,
      passwordService as any,
      jwtService as any,
      refreshTokenService as any,
    );
  });

  describe('register', () => {
    it('hashes the password, creates the user, and returns it without passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      passwordService.hash.mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue(persistedUser);

      const result = await service.register(dto);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: dto.email },
      });
      expect(passwordService.hash).toHaveBeenCalledWith(dto.password);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: dto.email,
          passwordHash: 'hashed-password',
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
        },
      });

      expect(result.email).toBe(dto.email);
      expect(result.status).toBe('ACTIVE');
      expect(result).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(result)).not.toContain('hashed-password');
    });

    it('throws ConflictException when the email already exists', async () => {
      prisma.user.findUnique.mockResolvedValue(persistedUser);

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(passwordService.hash).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('translates a concurrent duplicate-email database error (P2002) into a ConflictException', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      passwordService.hash.mockResolvedValue('hashed-password');

      const dbError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`email`)',
        { code: 'P2002', clientVersion: '7.9.1' },
      );
      prisma.user.create.mockRejectedValue(dbError);

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('propagates password hashing errors without attempting persistence', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      passwordService.hash.mockRejectedValue(
        new Error('argon2 hashing failed'),
      );

      await expect(service.register(dto)).rejects.toThrow(
        'argon2 hashing failed',
      );

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('propagates unexpected persistence errors instead of swallowing them', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      passwordService.hash.mockResolvedValue('hashed-password');
      prisma.user.create.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.register(dto)).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = {
      email: 'jane.doe@example.com',
      password: 'StrongPassw0rd!',
    };

    const activeUser = { ...persistedUser, status: 'ACTIVE' };

    const stubRefreshTokenIssuance = () => {
      refreshTokenService.generate.mockReturnValue('raw-refresh-token');
      refreshTokenService.hash.mockReturnValue('hashed-refresh-token');
      refreshTokenService.getExpiresAt.mockReturnValue(
        new Date('2026-01-08T00:00:00.000Z'),
      );
      prisma.refreshToken.create.mockResolvedValue({
        id: 'refresh-token-uuid',
        userId: activeUser.id,
        tokenHash: 'hashed-refresh-token',
        expiresAt: new Date('2026-01-08T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
    };

    it('verifies the password, updates lastLoginAt, signs an access token, issues+persists a hashed refresh token, and returns the user without passwordHash', async () => {
      const updatedUser = {
        ...activeUser,
        lastLoginAt: new Date('2026-01-02T00:00:00.000Z'),
      };

      prisma.user.findUnique.mockResolvedValue(activeUser);
      passwordService.verify.mockResolvedValue(true);
      prisma.user.update.mockResolvedValue(updatedUser);
      jwtService.signAsync.mockResolvedValue('signed-jwt-token');
      stubRefreshTokenIssuance();

      const result = await service.login(loginDto);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: loginDto.email },
      });
      expect(passwordService.verify).toHaveBeenCalledWith(
        activeUser.passwordHash,
        loginDto.password,
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: activeUser.id },
        data: { lastLoginAt: expect.any(Date) },
      });
      expect(jwtService.signAsync).toHaveBeenCalledTimes(1);
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: updatedUser.id,
      });

      // Refresh-token persistence: only the hash is ever written to the
      // database, never the raw token.
      expect(refreshTokenService.hash).toHaveBeenCalledWith(
        'raw-refresh-token',
      );
      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: {
          userId: updatedUser.id,
          tokenHash: 'hashed-refresh-token',
          expiresAt: new Date('2026-01-08T00:00:00.000Z'),
        },
      });

      expect(result.lastLoginAt).toEqual(updatedUser.lastLoginAt);
      expect(result.accessToken).toBe('signed-jwt-token');
      expect(result.refreshToken).toBe('raw-refresh-token');

      // Security: no sensitive/internal field ever reaches the response.
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('tokenHash');
      expect(JSON.stringify(result)).not.toContain(activeUser.passwordHash);
      expect(JSON.stringify(result)).not.toContain('hashed-refresh-token');
    });

    it('never logs the raw refresh token', async () => {
      const updatedUser = {
        ...activeUser,
        lastLoginAt: new Date('2026-01-02T00:00:00.000Z'),
      };

      prisma.user.findUnique.mockResolvedValue(activeUser);
      passwordService.verify.mockResolvedValue(true);
      prisma.user.update.mockResolvedValue(updatedUser);
      jwtService.signAsync.mockResolvedValue('signed-jwt-token');
      stubRefreshTokenIssuance();

      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      try {
        await service.login(loginDto);

        for (const call of [...logSpy.mock.calls, ...errorSpy.mock.calls]) {
          expect(JSON.stringify(call)).not.toContain('raw-refresh-token');
        }
      } finally {
        logSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });

    it('rejects with a generic error, does not update lastLoginAt, and does not sign a token for an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(service.login(loginDto)).rejects.toThrow(
        'Invalid email or password',
      );

      expect(passwordService.verify).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects with the same generic error, does not update lastLoginAt, and does not sign a token for a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      passwordService.verify.mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(service.login(loginDto)).rejects.toThrow(
        'Invalid email or password',
      );

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('propagates password verification errors, does not update lastLoginAt, and does not sign a token', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      passwordService.verify.mockRejectedValue(
        new Error('argon2 verify failed'),
      );

      await expect(service.login(loginDto)).rejects.toThrow(
        'argon2 verify failed',
      );

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it.each(['SUSPENDED', 'BLOCKED'] as const)(
      'rejects a %s account with ForbiddenException, does not update lastLoginAt, and does not sign a token',
      async (status) => {
        prisma.user.findUnique.mockResolvedValue({ ...activeUser, status });
        passwordService.verify.mockResolvedValue(true);

        await expect(service.login(loginDto)).rejects.toBeInstanceOf(
          ForbiddenException,
        );

        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(jwtService.signAsync).not.toHaveBeenCalled();
        expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      },
    );

    it('propagates lastLoginAt persistence failures instead of swallowing them, and does not sign a token', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      passwordService.verify.mockResolvedValue(true);
      prisma.user.update.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.login(loginDto)).rejects.toThrow(
        'connection terminated unexpectedly',
      );

      expect(jwtService.signAsync).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('propagates JWT signing failures after lastLoginAt has already been persisted, without issuing a refresh token', async () => {
      const updatedUser = {
        ...activeUser,
        lastLoginAt: new Date('2026-01-02T00:00:00.000Z'),
      };

      prisma.user.findUnique.mockResolvedValue(activeUser);
      passwordService.verify.mockResolvedValue(true);
      prisma.user.update.mockResolvedValue(updatedUser);
      jwtService.signAsync.mockRejectedValue(new Error('signing key error'));

      await expect(service.login(loginDto)).rejects.toThrow(
        'signing key error',
      );

      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('propagates refresh-token persistence failures instead of swallowing them', async () => {
      const updatedUser = {
        ...activeUser,
        lastLoginAt: new Date('2026-01-02T00:00:00.000Z'),
      };

      prisma.user.findUnique.mockResolvedValue(activeUser);
      passwordService.verify.mockResolvedValue(true);
      prisma.user.update.mockResolvedValue(updatedUser);
      jwtService.signAsync.mockResolvedValue('signed-jwt-token');
      refreshTokenService.generate.mockReturnValue('raw-refresh-token');
      refreshTokenService.hash.mockReturnValue('hashed-refresh-token');
      refreshTokenService.getExpiresAt.mockReturnValue(new Date());
      prisma.refreshToken.create.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.login(loginDto)).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('refresh', () => {
    const refreshDto: RefreshTokenDto = { refreshToken: 'raw-refresh-token' };

    const activeUser = { ...persistedUser, status: 'ACTIVE' };

    const validRecord = (overrides: Record<string, unknown> = {}) => ({
      id: 'refresh-token-uuid',
      userId: activeUser.id,
      tokenHash: 'hashed-refresh-token',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      user: activeUser,
      ...overrides,
    });

    beforeEach(() => {
      refreshTokenService.hash.mockReturnValue('hashed-refresh-token');
    });

    it('issues a new access token for a valid, unexpired refresh token belonging to an ACTIVE user', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(validRecord());
      jwtService.signAsync.mockResolvedValue('new-signed-jwt-token');

      const result = await service.refresh(refreshDto);

      expect(refreshTokenService.hash).toHaveBeenCalledWith(
        'raw-refresh-token',
      );
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: 'hashed-refresh-token' },
        include: { user: true },
      });
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: activeUser.id,
      });
      expect(result).toEqual({ accessToken: 'new-signed-jwt-token' });
    });

    it('rejects with UnauthorizedException for an unknown token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh(refreshDto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('rejects with UnauthorizedException for an expired token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        validRecord({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.refresh(refreshDto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('rejects with UnauthorizedException for a malformed/unrecognized token (hashes to no match)', async () => {
      refreshTokenService.hash.mockReturnValue('some-other-hash');
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(
        service.refresh({ refreshToken: 'not-a-real-token' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it.each(['SUSPENDED', 'BLOCKED'] as const)(
      'rejects with UnauthorizedException (401, not 403) for a %s user',
      async (status) => {
        prisma.refreshToken.findUnique.mockResolvedValue(
          validRecord({ user: { ...activeUser, status } }),
        );

        await expect(service.refresh(refreshDto)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        expect(jwtService.signAsync).not.toHaveBeenCalled();
      },
    );

    it('rejects with UnauthorizedException when the token record has no resolvable user', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        validRecord({ user: null }),
      );

      await expect(service.refresh(refreshDto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('propagates access-token signing failures', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(validRecord());
      jwtService.signAsync.mockRejectedValue(new Error('signing key error'));

      await expect(service.refresh(refreshDto)).rejects.toThrow(
        'signing key error',
      );
    });

    it('never exposes the token hash in the response', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(validRecord());
      jwtService.signAsync.mockResolvedValue('new-signed-jwt-token');

      const result = await service.refresh(refreshDto);

      expect(result).not.toHaveProperty('tokenHash');
      expect(JSON.stringify(result)).not.toContain('hashed-refresh-token');
    });
  });
});
