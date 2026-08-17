import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { Prisma, type User, type UserStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password/password.service';

/** `User` with the sensitive `passwordHash` field removed. */
export type SafeUser = Omit<User, 'passwordHash'>;

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Deliberately identical for "no such user" and "wrong password" so the
// public response never reveals which condition failed.
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

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

  async login(dto: LoginDto): Promise<SafeUser> {
    // Email is normalized the same way as RegisterDto (trim + lower-case),
    // via LoginDto's @Transform — see docs/database/identity-access.md
    // "Email Normalization".
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Unknown email and wrong password must be indistinguishable to the
    // caller: both fall through to the same generic error below. Password
    // verification always runs through the existing PasswordService (no
    // separate/second hashing mechanism), which also avoids a trivially
    // fast rejection path purely on "no such user".
    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const passwordMatches = await this.passwordService.verify(
      user.passwordHash,
      dto.password,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    // Only checked *after* the credentials have been proven correct, so an
    // attacker who does not know the password cannot use status-specific
    // error text to probe account state.
    this.assertCanAuthenticate(user.status);

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.toSafeUser(updatedUser);
  }

  /**
   * Gate on docs/database/identity-access.md "User Status":
   *  - ACTIVE: explicitly documented as able to authenticate.
   *  - SUSPENDED / BLOCKED: the source documents describe these as
   *    "temporarily restricted" / "prevented from normal platform access"
   *    but do not explicitly state whether the restriction applies to the
   *    authentication step itself or only to post-login feature access.
   *    This method takes the conservative reading — only ACTIVE accounts
   *    may complete login — since requirement 6g ("only an account allowed
   *    to authenticate should continue") requires some gate, and ACTIVE is
   *    the only status the architecture explicitly grants that ability to.
   *    See the final report for this task for the flagged ambiguity.
   */
  private assertCanAuthenticate(status: UserStatus): void {
    if (status === 'ACTIVE') {
      return;
    }

    if (status === 'SUSPENDED') {
      throw new ForbiddenException('Account is suspended.');
    }

    if (status === 'BLOCKED') {
      throw new ForbiddenException('Account is blocked.');
    }

    // Fail closed on any status the architecture has not defined login
    // behavior for, rather than silently allowing authentication.
    throw new ForbiddenException('Account is not permitted to authenticate.');
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
