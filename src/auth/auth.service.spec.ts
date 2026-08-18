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
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    // `refresh()` runs everything through `$transaction(async (tx) => ...)`.
    // In these unit tests `tx` and the top-level client share the same
    // mocked methods, since only call arguments/ordering matter here —
    // real cross-request row-locking is a database-level guarantee that
    // is verified against the live Postgres instance in the E2E suite,
    // not something a mock can meaningfully simulate.
    $transaction: jest.fn(),
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
    prisma.$transaction.mockImplementation((callback: any) =>
      callback(prisma),
    );
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
    const familyId = 'family-uuid';

    const validRecord = (overrides: Record<string, unknown> = {}) => ({
      id: 'refresh-token-uuid',
      userId: activeUser.id,
      familyId,
      tokenHash: 'hashed-refresh-token',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      user: activeUser,
      ...overrides,
    });

    beforeEach(() => {
      refreshTokenService.hash.mockReturnValue('hashed-refresh-token');
      refreshTokenService.generate.mockReturnValue('new-raw-refresh-token');
      refreshTokenService.getExpiresAt.mockReturnValue(
        new Date('2026-01-08T00:00:00.000Z'),
      );
      // Default: claim succeeds (the common "valid token" case). Individual
      // tests override this to simulate the various rejection paths.
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.refreshToken.findUniqueOrThrow.mockResolvedValue(validRecord());
      prisma.refreshToken.create.mockResolvedValue({});
      jwtService.signAsync.mockResolvedValue('new-signed-jwt-token');
    });

    it('rotates a valid token: claims it atomically, creates a same-family replacement, and returns both new tokens', async () => {
      const result = await service.refresh(refreshDto);

      expect(refreshTokenService.hash).toHaveBeenCalledWith(
        'raw-refresh-token',
      );
      // Atomic claim: only matches a still-unrevoked, unexpired row.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash: 'hashed-refresh-token',
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { revokedAt: expect.any(Date) },
      });
      // New token carries the SAME familyId forward — not a new one.
      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: {
          userId: activeUser.id,
          familyId,
          tokenHash: expect.any(String),
          expiresAt: new Date('2026-01-08T00:00:00.000Z'),
        },
      });
      expect(refreshTokenService.hash).toHaveBeenCalledWith(
        'new-raw-refresh-token',
      );
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: activeUser.id,
      });

      expect(result).toEqual({
        accessToken: 'new-signed-jwt-token',
        refreshToken: 'new-raw-refresh-token',
      });
      // The rotated-away-from token's hash must never appear anywhere in
      // the response.
      expect(JSON.stringify(result)).not.toContain('hashed-refresh-token');
    });

    it('rejects an unknown token with UnauthorizedException and does not touch any family', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.findUnique.mockResolvedValue(null); // no such hash exists at all

      await expect(service.refresh(refreshDto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      // Only the one (failed) claim attempt — no family-revocation call,
      // since there is no family to revoke for a token that never existed.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('rejects a malformed/unrecognized token the same way as an unknown one', async () => {
      refreshTokenService.hash.mockReturnValue('some-other-hash');
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(
        service.refresh({ refreshToken: 'not-a-real-token' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    });

    it('rejects an expired-but-never-used token with 401 and does NOT treat it as reuse (no family revocation)', async () => {
      // The claim's WHERE clause excludes expired rows, so it "fails" —
      // but the row exists and was never revoked, so this must not be
      // mistaken for reuse.
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.findUnique.mockResolvedValue(
        validRecord({
          expiresAt: new Date(Date.now() - 1000),
          revokedAt: null,
        }),
      );

      await expect(service.refresh(refreshDto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      // Exactly one updateMany call (the failed claim) — no second call
      // revoking a family.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('detects reuse of an already-consumed token, revokes the entire family, and returns a generic 401', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.findUnique.mockResolvedValue(
        validRecord({ revokedAt: new Date('2026-01-01T00:05:00.000Z') }),
      );

      await expect(service.refresh(refreshDto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(service.refresh(refreshDto)).rejects.toThrow(
        'Invalid or expired refresh token',
      );

      // Second updateMany call: family-wide revocation, scoped to this
      // family only, and only affecting still-active tokens.
      expect(prisma.refreshToken.updateMany).toHaveBeenNthCalledWith(2, {
        where: { familyId, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('does not revoke an unrelated family when reuse is detected in a different one', async () => {
      const otherFamilyId = 'other-family-uuid';
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.findUnique.mockResolvedValue(
        validRecord({
          familyId: otherFamilyId,
          revokedAt: new Date('2026-01-01T00:05:00.000Z'),
        }),
      );

      await expect(service.refresh(refreshDto)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenNthCalledWith(2, {
        where: { familyId: otherFamilyId, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it.each(['SUSPENDED', 'BLOCKED'] as const)(
      'rejects with UnauthorizedException (401, not 403) for a %s user, consumes the token, but issues no replacement',
      async (status) => {
        prisma.refreshToken.findUniqueOrThrow.mockResolvedValue(
          validRecord({ user: { ...activeUser, status } }),
        );

        await expect(service.refresh(refreshDto)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );

        // The claim still ran (token consumed either way)...
        expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
        // ...but no replacement token or access token is issued.
        expect(prisma.refreshToken.create).not.toHaveBeenCalled();
        expect(jwtService.signAsync).not.toHaveBeenCalled();
      },
    );

    it('propagates access-token signing failures and rolls back (no replacement token left dangling)', async () => {
      jwtService.signAsync.mockRejectedValue(new Error('signing key error'));

      await expect(service.refresh(refreshDto)).rejects.toThrow(
        'signing key error',
      );

      // create() was still called inside the transaction (order: create
      // then sign), but since the whole callback is one $transaction, a
      // real Prisma client would roll back that write along with the
      // claim when the callback throws — this test's mock cannot itself
      // assert the rollback (that is a database-level guarantee, verified
      // in E2E), only that the error propagates rather than being
      // swallowed and a success response returned.
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('propagates unexpected database failures instead of swallowing them', async () => {
      prisma.refreshToken.updateMany.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.refresh(refreshDto)).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });

    it('never exposes any token hash in the response', async () => {
      const result = await service.refresh(refreshDto);

      expect(result).not.toHaveProperty('tokenHash');
      expect(JSON.stringify(result)).not.toContain('hashed-refresh-token');
    });

    describe('concurrent refresh (sequential race-outcome approximation)', () => {
      // True concurrent-safety is a database row-locking guarantee
      // (Postgres, under the transaction in AuthService.refresh) and is
      // exercised for real — via Promise.all against the live database —
      // in test/auth.e2e-spec.ts. This test only documents/locks in the
      // *logic* that must run once the database has already resolved the
      // race: whichever request's `updateMany` reports `count: 1` is the
      // winner; the loser must observe `count: 0` against an
      // already-revoked row and be treated as reuse.
      it('treats the loser of a resolved race as reuse and revokes the family', async () => {
        // Request 1 (winner): claim succeeds.
        prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 });
        const winner = await service.refresh(refreshDto);
        expect(winner.accessToken).toBe('new-signed-jwt-token');

        // Request 2 (loser): by the time its claim runs, the row is
        // already revoked (by request 1) — the DB guarantees this
        // ordering via row locking; here it is simulated directly.
        prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 });
        prisma.refreshToken.findUnique.mockResolvedValue(
          validRecord({ revokedAt: new Date() }),
        );

        await expect(service.refresh(refreshDto)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        expect(prisma.refreshToken.updateMany).toHaveBeenNthCalledWith(3, {
          where: { familyId, revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        });
      });
    });
  });
});
