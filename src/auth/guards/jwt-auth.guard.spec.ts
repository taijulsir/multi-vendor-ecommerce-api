import { UnauthorizedException } from '@nestjs/common';

import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  it('is defined and exposes canActivate (from Passport AuthGuard(\'jwt\'))', () => {
    expect(guard).toBeDefined();
    expect(typeof guard.canActivate).toBe('function');
  });

  describe('handleRequest (inherited from AuthGuard)', () => {
    // The strategy/passport-level verification itself is exercised end to
    // end in test/auth.e2e-spec.ts (missing header, malformed bearer,
    // invalid signature, expired token, unknown/suspended/blocked user —
    // all via real HTTP requests). This test covers only the guard's own
    // pass-through contract without re-testing Passport's internals.
    it('returns the authenticated user on a successful authentication flow', () => {
      const user = { id: 'user-uuid', email: 'jane.doe@example.com' };

      expect(guard.handleRequest(null, user, null, {} as any)).toBe(user);
    });

    it('throws UnauthorizedException when authentication fails (no user, no error)', () => {
      expect(() =>
        guard.handleRequest(null, false, 'No auth token', {} as any),
      ).toThrow(UnauthorizedException);
    });

    it('propagates a strategy-thrown error instead of exposing internal details', () => {
      const strategyError = new UnauthorizedException();

      expect(() =>
        guard.handleRequest(strategyError, false, null, {} as any),
      ).toThrow(strategyError);
    });
  });
});
