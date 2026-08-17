import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../types/jwt-payload';
import { isAuthenticatable } from '../utils/account-status';
import { toSafeUser, type SafeUser } from '../utils/safe-user';

/**
 * Verifies the access token's signature/expiration (via passport-jwt,
 * using the same JWT_ACCESS_SECRET + HS256 configuration as Phase 3's
 * issuance) and then re-derives the authenticated user from the current
 * database state — never trusting anything beyond the token's `sub`
 * claim. This is what lets a suspended/blocked status (or a deleted user)
 * revoke an already-issued token's effective access without any separate
 * token-revocation mechanism.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      algorithms: ['HS256'],
    });
  }

  /**
   * Called by Passport only after the token's signature and expiration
   * have already been verified. Whatever this method returns becomes
   * `req.user`.
   */
  async validate(payload: JwtPayload): Promise<SafeUser> {
    if (typeof payload?.sub !== 'string' || payload.sub.length === 0) {
      throw new UnauthorizedException();
    }

    const user = await this.prisma.user
      .findUnique({ where: { id: payload.sub } })
      .catch(() => {
        // A malformed `sub` (not a valid UUID) would otherwise surface as
        // an internal Prisma error; treat any lookup failure the same as
        // "no such user" instead of leaking it.
        return null;
      });

    if (!user || !isAuthenticatable(user.status)) {
      throw new UnauthorizedException();
    }

    return toSafeUser(user);
  }
}
