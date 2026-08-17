import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { Prisma, type UserStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password/password.service';
import { RefreshTokenService } from './token/refresh-token.service';
import { JwtPayload } from './types/jwt-payload';
import { isAuthenticatable } from './utils/account-status';
import { toSafeUser, type SafeUser } from './utils/safe-user';

export type { SafeUser };

/** Login response: the safe user representation plus the signed tokens. */
export type LoginResult = SafeUser & {
  accessToken: string;
  refreshToken: string;
};

/** Refresh response: a new access token only — no rotation in this phase. */
export type RefreshResult = { accessToken: string };

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Deliberately identical for "no such user" and "wrong password" so the
// public response never reveals which condition failed.
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

// Deliberately identical for every refresh failure mode (unknown token,
// expired token, malformed-but-parseable token, suspended/blocked
// account) — same "don't reveal which condition failed" principle as
// login, applied to the refresh flow.
const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid or expired refresh token';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
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

      return toSafeUser(user);
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

  async login(dto: LoginDto): Promise<LoginResult> {
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

    // Signed only after credentials + status are confirmed and lastLoginAt
    // is persisted, per this phase's required ordering. Payload is
    // deliberately minimal — see JwtPayload. Expiration/secret/algorithm
    // are centralized in AuthModule's JwtModule.registerAsync(), not
    // hard-coded here.
    const payload: JwtPayload = { sub: updatedUser.id };
    const accessToken = await this.jwtService.signAsync(payload);

    // The raw refresh token exists only long enough to hash it and hand
    // it back to the caller — only the hash is ever persisted or logged.
    const refreshToken = this.refreshTokenService.generate();
    await this.prisma.refreshToken.create({
      data: {
        userId: updatedUser.id,
        tokenHash: this.refreshTokenService.hash(refreshToken),
        expiresAt: this.refreshTokenService.getExpiresAt(),
      },
    });

    return { ...toSafeUser(updatedUser), accessToken, refreshToken };
  }

  /**
   * Exchanges a still-valid refresh token for a new access token.
   *
   * Deliberately does NOT issue a new refresh token or invalidate the
   * presented one — rotation and reuse detection are out of scope for
   * this phase (see the final report). The same refresh token therefore
   * remains usable, unchanged, until it expires.
   */
  async refresh(dto: RefreshTokenDto): Promise<RefreshResult> {
    const tokenHash = this.refreshTokenService.hash(dto.refreshToken);

    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    // Unknown token, expired token, and (defensively) a token whose user
    // relation somehow doesn't resolve are all indistinguishable to the
    // caller — same generic error, same principle as login().
    if (!record || record.expiresAt.getTime() <= Date.now() || !record.user) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    // Reuses the exact same status policy as login/JwtStrategy — see
    // isAuthenticatable(). Presented here as a uniform 401 rather than
    // login's 403, matching JwtStrategy's precedent: this is "continuing
    // an existing session," not a fresh authentication attempt, so an
    // account that can no longer authenticate simply reads as "this
    // token/session is no longer valid."
    if (!isAuthenticatable(record.user.status)) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const payload: JwtPayload = { sub: record.user.id };
    const accessToken = await this.jwtService.signAsync(payload);

    return { accessToken };
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
    if (isAuthenticatable(status)) {
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
}
