import type { User } from '../../generated/prisma/client';

/** `User` with the sensitive `passwordHash` field removed. */
export type SafeUser = Omit<User, 'passwordHash'>;

/**
 * Maps a full `User` record to its public-safe representation.
 *
 * Uses an explicit field allowlist (rather than destructure-and-omit) so
 * that a newly added `User` field must be a conscious decision made here,
 * not an accidental leak through the response.
 *
 * Shared between `AuthService` (register/login) and `JwtStrategy`
 * (`GET /auth/me` and any future protected route) so both produce the
 * exact same "safe user" shape from a single source of truth.
 */
export function toSafeUser(user: User): SafeUser {
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
