import { ConflictException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

describe('AuthService', () => {
  let service: AuthService;

  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const passwordService = {
    hash: jest.fn(),
    verify: jest.fn(),
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
    service = new AuthService(prisma as any, passwordService as any);
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
});
