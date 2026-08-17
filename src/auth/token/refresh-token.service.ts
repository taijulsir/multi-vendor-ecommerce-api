import { createHmac, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ms, { type StringValue } from 'ms';

/**
 * Dedicated refresh-token generation/hashing utility — deliberately kept
 * separate from PasswordService rather than reusing Argon2id for this.
 *
 * Passwords need a slow, salted KDF to resist offline brute-force against
 * a low-entropy, human-chosen secret. A refresh token is the opposite: a
 * single server-generated, maximum-entropy (256-bit) random value that
 * only ever needs an equality check. A fast, deterministic keyed hash
 * (HMAC-SHA256) is both sufficient and necessary here — Argon2's per-call
 * random salt would make a direct indexed database lookup by hash
 * impossible, forcing an O(n) scan-and-verify instead.
 *
 * Reuses the existing JWT_REFRESH_SECRET / JWT_REFRESH_EXPIRES_IN
 * environment variables rather than introducing new ones — see this
 * phase's final report for why an opaque token (not a second JWT) was
 * chosen despite the "JWT_"-prefixed variable names.
 */
@Injectable()
export class RefreshTokenService {
  private readonly secret: string;
  private readonly expiresIn: StringValue;

  constructor(configService: ConfigService) {
    this.secret = configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.expiresIn = configService.getOrThrow<StringValue>(
      'JWT_REFRESH_EXPIRES_IN',
    );
  }

  /**
   * A cryptographically random, URL-safe opaque token. This raw value is
   * only ever returned to the client — it is never persisted or logged.
   */
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  /** Deterministic keyed hash — the only form of the token ever persisted. */
  hash(rawToken: string): string {
    return createHmac('sha256', this.secret).update(rawToken).digest('hex');
  }

  /** Expiration timestamp for a token generated now, per JWT_REFRESH_EXPIRES_IN. */
  getExpiresAt(): Date {
    return new Date(Date.now() + ms(this.expiresIn));
  }
}
