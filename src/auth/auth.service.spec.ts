import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

describe('AuthService', () => {
  let service: AuthService;

  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const passwordService = {
    hash: jest.fn(),
    verify: jest.fn(),
  };

  const jwtService = {
    signAsync: jest.fn(),
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

    it('verifies the password, updates lastLoginAt, signs a token, and returns the user without passwordHash', async () => {
      const updatedUser = {
        ...activeUser,
        lastLoginAt: new Date('2026-01-02T00:00:00.000Z'),
      };

      prisma.user.findUnique.mockResolvedValue(activeUser);
      passwordService.verify.mockResolvedValue(true);
      prisma.user.update.mockResolvedValue(updatedUser);
      jwtService.signAsync.mockResolvedValue('signed-jwt-token');

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

      expect(result.lastLoginAt).toEqual(updatedUser.lastLoginAt);
      expect(result.accessToken).toBe('signed-jwt-token');
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('refreshToken');
      expect(JSON.stringify(result)).not.toContain(activeUser.passwordHash);
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
    });

    it('propagates JWT signing failures after lastLoginAt has already been persisted', async () => {
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
    });
  });
});
