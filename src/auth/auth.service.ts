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

/** Refresh response: a new access token AND a new (rotated) refresh token. */
export type RefreshResult = { accessToken: string; refreshToken: string };

/**
 * Internal outcome of an attempted rotation, decided entirely inside the
 * DB transaction in `refresh()`. Returned rather than thrown from the
 * transaction callback so that "this token is invalid" (unknown, expired,
 * reused, or status-rejected) is a single, uniform branch handled once,
 * outside the transaction — this is what guarantees the public response
 * never differs by reason (see `refresh()`).
 */
type RotationOutcome =
  | { kind: 'success'; accessToken: string; refreshToken: string }
  | { kind: 'invalid' };

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
   * Rotates a refresh token: exchanges it for a new access token AND a
   * new refresh token, invalidating the presented one in the same
   * transaction. See docs/architecture.md §18 ("uses rotation") — this is
   * the rotation implementation deferred out of Phase 5.
   *
   * Concurrency / atomicity strategy (task requirements §4–5):
   *
   * The "claim" step is a single conditional `updateMany` —
   * `WHERE tokenHash = ? AND revokedAt IS NULL AND expiresAt > now()` —
   * which is atomic at the database level (Postgres row-lock semantics
   * under READ COMMITTED). If two requests present the same token
   * concurrently, only one can affect a row; the other's `updateMany`
   * necessarily observes `count === 0` once the first has committed,
   * because both run inside a *transaction* and the row lock forces the
   * second to wait for the first to finish before its own WHERE clause is
   * (re-)evaluated. That loser is therefore treated exactly like any
   * other presentation of an already-consumed token: reuse.
   *
   * The claim and the new token's creation happen in the SAME
   * `$transaction`, so a failure between them (JWT signing, DB error)
   * rolls back the claim too — the old token is never left revoked
   * without a replacement having actually been created (task §4).
   */
  async refresh(dto: RefreshTokenDto): Promise<RefreshResult> {
    const tokenHash = this.refreshTokenService.hash(dto.refreshToken);

    const outcome: RotationOutcome = await this.prisma.$transaction(
      async (tx) => {
        const now = new Date();

        const claim = await tx.refreshToken.updateMany({
          where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
          data: { revokedAt: now },
        });

        if (claim.count === 0) {
          // We did not win (or there was nothing to win). Distinguish
          // "already consumed/revoked" (reuse) from "unknown token" or
          // "merely expired, never used" (neither is reuse) only to
          // decide whether a family exists to revoke — the caller-facing
          // outcome is identical in all three cases.
          const existing = await tx.refreshToken.findUnique({
            where: { tokenHash },
          });

          if (existing && existing.revokedAt !== null) {
            // Reuse detected: this exact token was already consumed by
            // an earlier (or, under the race above, a concurrently
            // winning) request. Revoke every still-active token in the
            // family — including ones from later rotations — so the
            // entire chain descended from the compromised/replayed token
            // stops working, per task §6–7. Scoped strictly to this
            // family's ID, so unrelated users/sessions are untouched.
            await tx.refreshToken.updateMany({
              where: { familyId: existing.familyId, revokedAt: null },
              data: { revokedAt: now },
            });
          }

          return { kind: 'invalid' };
        }

        // We atomically won the right to consume this token — fetch what
        // rotation needs. (`expiresAt`/`revokedAt` are already validated
        // by the WHERE clause above; no need to re-check them.)
        const record = await tx.refreshToken.findUniqueOrThrow({
          where: { tokenHash },
          include: { user: true },
        });

        // Reuses the exact same status policy as login/JwtStrategy — see
        // isAuthenticatable(). Presented as a uniform 401 rather than
        // login's 403, matching JwtStrategy's precedent (this is
        // "continuing a session," not a fresh authentication attempt).
        // The token was already revoked by the claim above and is
        // intentionally NOT replaced — a suspended/blocked account must
        // not receive a new refresh token either (task §9).
        if (!isAuthenticatable(record.user.status)) {
          return { kind: 'invalid' };
        }

        const rawRefreshToken = this.refreshTokenService.generate();

        await tx.refreshToken.create({
          data: {
            userId: record.user.id,
            familyId: record.familyId,
            tokenHash: this.refreshTokenService.hash(rawRefreshToken),
            expiresAt: this.refreshTokenService.getExpiresAt(),
          },
        });

        const payload: JwtPayload = { sub: record.user.id };
        const accessToken = await this.jwtService.signAsync(payload);

        return { kind: 'success', accessToken, refreshToken: rawRefreshToken };
      },
    );

    if (outcome.kind === 'invalid') {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    return { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken };
  }

  /**
   * Revokes the login session (refresh-token family) identified by the
   * presented refresh token, for the currently authenticated user only.
   *
   * One `familyId` == one login session (see Phase 6's design — a family
   * is the chain of tokens produced by rotating from a single login), so
   * "logout this session" means "revoke every still-active token in this
   * family," reusing the exact same family-revocation shape already
   * established for reuse detection in `refresh()`. No new persistence
   * model is required.
   *
   * Deliberately idempotent and always succeeds from the caller's
   * perspective (task §7): an unknown token, an already-revoked token,
   * and a token that exists but belongs to a *different* user are all
   * silently no-ops. This is the same "never reveal internal token
   * state" principle used everywhere else in this auth flow — a client
   * cannot distinguish "already logged out" from "that token was never
   * yours" from "that token never existed." Cross-user ownership is
   * enforced here (a caller can only ever revoke their own session) even
   * though `AuthController` also requires a valid access token — this is
   * a deliberate second check, not redundant: the access token proves
   * *who* is calling, but says nothing about which refresh token/session
   * they're allowed to name in the request body.
   */
  async logout(userId: string, dto: RefreshTokenDto): Promise<void> {
    const tokenHash = this.refreshTokenService.hash(dto.refreshToken);

    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!record || record.userId !== userId) {
      return;
    }

    await this.prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
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
