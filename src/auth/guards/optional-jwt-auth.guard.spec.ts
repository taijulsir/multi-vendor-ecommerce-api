import { UnauthorizedException } from '@nestjs/common';

import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

describe('OptionalJwtAuthGuard', () => {
  let guard: OptionalJwtAuthGuard;

  beforeEach(() => {
    guard = new OptionalJwtAuthGuard();
  });

  it('is defined and exposes canActivate (from Passport AuthGuard)', () => {
    expect(guard).toBeDefined();
    expect(typeof guard.canActivate).toBe('function');
  });

  describe('handleRequest', () => {
    it('returns the authenticated user on a successful authentication flow', () => {
      const user = { id: 'user-uuid', email: 'jane.doe@example.com' };

      expect(guard.handleRequest(null, user)).toBe(user);
    });

    it('returns undefined instead of throwing when there is no token', () => {
      expect(guard.handleRequest(null, false)).toBe(false);
    });

    it('does not propagate a strategy-level error either — auth stays optional', () => {
      expect(() =>
        guard.handleRequest(new UnauthorizedException(), false),
      ).not.toThrow();
    });
  });
});
