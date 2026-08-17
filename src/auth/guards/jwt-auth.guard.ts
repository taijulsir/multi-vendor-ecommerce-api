import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Thin wrapper around Passport's `AuthGuard('jwt')`. All verification and
 * user-lookup logic lives in JwtStrategy — this guard has none of its own.
 *
 * On success, populates `req.user` with whatever JwtStrategy.validate()
 * returned (a `SafeUser`). On any failure (missing/malformed
 * Authorization header, invalid signature, expired token, or the strategy
 * itself throwing), Passport's default `handleRequest` behavior applies:
 * a generic `UnauthorizedException` (401) with no internal detail leaked.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
