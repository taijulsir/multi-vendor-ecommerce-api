import { ConflictException, Injectable } from '@nestjs/common';

import { Prisma, type User } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password/password.service';

/** `User` with the sensitive `passwordHash` field removed. */
export type SafeUser = Omit<User, 'passwordHash'>;

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
  ) {}

  async register(dto: RegisterDto): Promise<SafeUser> {
    // Email is already normalized (trimmed + lower-cased) by RegisterDto's
    // @Transform, so the same value is used for both the lookup and the
    // persisted record — see docs/database/identity-access.md "Email
    // Normalization".
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          // `status` is intentionally omitted: it defaults to ACTIVE in
          // prisma/schema/identity-access.prisma, matching
          // docs/database/identity-access.md "User Status".
          //
          // No role is assigned here: the architecture documents do not
          // specify a default role for newly registered users (Role is a
          // separate, explicitly-assigned table per
          // docs/database/identity-access.md "Why Role Is a Database
          // Table"), so none is invented.
        },
      });

      return this.toSafeUser(user);
    } catch (error) {
      // A concurrent request can pass the existence check above and still
      // race to insert the same email; the database's unique constraint is
      // the final authority. Translate that into the same public error
      // instead of leaking a raw database error to the client.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException('Email is already registered');
      }

      throw error;
    }
  }

  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
    };
  }
}
