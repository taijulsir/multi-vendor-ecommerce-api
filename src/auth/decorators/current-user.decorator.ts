import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { SafeUser } from '../utils/safe-user';

/**
 * Reads the authenticated user that JwtAuthGuard/JwtStrategy already
 * placed on `req.user`. Only usable behind `@UseGuards(JwtAuthGuard)` (or
 * an equivalent guard that populates `req.user` with a `SafeUser`) — it
 * does not perform authentication itself.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SafeUser => {
    const request = context.switchToHttp().getRequest<{ user: SafeUser }>();
    return request.user;
  },
);
