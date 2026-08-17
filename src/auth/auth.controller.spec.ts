import { AuthController } from './auth.controller';
import type { SafeUser } from './utils/safe-user';

describe('AuthController', () => {
  let controller: AuthController;

  const authService = {
    register: jest.fn(),
    login: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController(authService as any);
  });

  describe('me', () => {
    it('returns exactly the authenticated user resolved by the guard/decorator, unmodified', () => {
      const user: SafeUser = {
        id: 'user-uuid',
        email: 'jane.doe@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: null,
        avatarUrl: null,
        status: 'ACTIVE',
        emailVerifiedAt: null,
        lastLoginAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
      };

      const result = controller.me(user);

      // Pure delegation: no extra logic, no AuthService call, no mutation.
      expect(result).toBe(user);
      expect(authService.login).not.toHaveBeenCalled();
      expect(authService.register).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('accessToken');
    });
  });
});
