import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Permissions } from './decorators/permissions.decorator';
import { Roles } from './decorators/roles.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthorizationGuard } from './guards/authorization.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { SafeUser } from './utils/safe-user';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiCreatedResponse({ description: 'User registered successfully' })
  @ApiConflictResponse({ description: 'Email is already registered' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiOkResponse({
    description:
      'Login successful. Returns the authenticated user together with a ' +
      'short-lived JWT access token (see JWT_ACCESS_EXPIRES_IN) and an ' +
      'opaque refresh token (see JWT_REFRESH_EXPIRES_IN) for obtaining ' +
      'new access tokens via POST /auth/refresh.',
    schema: {
      example: {
        id: 'b3f1c2a0-1234-4a5b-8c9d-0e1f2a3b4c5d',
        email: 'jane.doe@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: null,
        avatarUrl: null,
        status: 'ACTIVE',
        emailVerifiedAt: null,
        lastLoginAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refreshToken:
          'k3f9c2a01234a5b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7081920a1b2c3d',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiForbiddenResponse({
    description: 'Account is not permitted to authenticate',
  })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token for a new access token + refresh token',
  })
  @ApiOkResponse({
    description:
      'A new short-lived access token and a new refresh token. The ' +
      'presented refresh token is invalidated as part of this call and ' +
      'cannot be used again — presenting it again is treated as refresh-' +
      'token reuse.',
    schema: {
      example: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refreshToken:
          'k3f9c2a01234a5b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7081920a1b2c3d',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description:
      'The refresh token is missing, unrecognized, expired, already ' +
      'used, or the associated account is no longer permitted to ' +
      'authenticate. The response is intentionally generic and does not ' +
      'indicate which of these applies.',
  })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Revoke the current login session (refresh-token family)',
  })
  @ApiNoContentResponse({
    description:
      'The session has been revoked (or was already invalid/not yours, ' +
      'in which case this is a no-op) — this endpoint is idempotent and ' +
      'always returns 204 for an authenticated caller. Other sessions ' +
      '(other refresh-token families, including other devices for the ' +
      'same user) are unaffected. The current access token remains ' +
      'valid until it naturally expires (see JWT_ACCESS_EXPIRES_IN) — ' +
      'this phase does not implement access-token revocation.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, malformed, invalid, or expired access token.',
  })
  async logout(
    @CurrentUser() user: SafeUser,
    @Body() dto: RefreshTokenDto,
  ): Promise<void> {
    await this.authService.logout(user.id, dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @ApiOkResponse({
    description:
      'The authenticated user, re-derived from the current database state.',
    schema: {
      example: {
        id: 'b3f1c2a0-1234-4a5b-8c9d-0e1f2a3b4c5d',
        email: 'jane.doe@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: null,
        avatarUrl: null,
        status: 'ACTIVE',
        emailVerifiedAt: null,
        lastLoginAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
      },
    },
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing, malformed, invalid, or expired access token, or the ' +
      'account is no longer permitted to authenticate.',
  })
  me(@CurrentUser() user: SafeUser): SafeUser {
    return user;
  }

  // ---------------------------------------------------------------------
  // RBAC demonstration endpoints (Phase 8).
  //
  // These exist only to exercise AuthorizationGuard end to end against a
  // real route; they are not a business feature. No ProductModule (or
  // any other domain module) was created for this — see this phase's
  // final report. `products:read` is used only because it's the example
  // permission docs/database/identity-access.md §3 and this task's own
  // fixtures already use; it does not imply a Product entity/domain
  // exists.
  // ---------------------------------------------------------------------

  @Get('rbac-demo/role')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '[RBAC demo] Requires the ADMIN role',
    description:
      'Demonstrates role-based authorization only. Not a real business ' +
      'endpoint.',
  })
  @ApiOkResponse({ description: 'Caller has the ADMIN role.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description: 'Authenticated, but missing the required role.',
  })
  rbacDemoRole(@CurrentUser() user: SafeUser) {
    return { message: 'You have the ADMIN role.', userId: user.id };
  }

  @Get('rbac-demo/permission')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions({ resource: 'products', action: 'read' })
  @ApiBearerAuth()
  @ApiOperation({
    summary: '[RBAC demo] Requires the products:read permission',
    description:
      'Demonstrates permission-based authorization only. Not a real ' +
      'business endpoint.',
  })
  @ApiOkResponse({ description: 'Caller has the products:read permission.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description: 'Authenticated, but missing the required permission.',
  })
  rbacDemoPermission(@CurrentUser() user: SafeUser) {
    return {
      message: 'You have the products:read permission.',
      userId: user.id,
    };
  }

  @Get('rbac-demo/role-and-permission')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Roles('ADMIN')
  @Permissions({ resource: 'products', action: 'read' })
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      '[RBAC demo] Requires BOTH the ADMIN role AND the products:read permission',
    description:
      'Demonstrates that a route declaring both @Roles() and ' +
      '@Permissions() requires all of them (AND) — not a real business ' +
      'endpoint.',
  })
  @ApiOkResponse({
    description: 'Caller has both the ADMIN role and products:read.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but missing the required role and/or permission.',
  })
  rbacDemoRoleAndPermission(@CurrentUser() user: SafeUser) {
    return {
      message: 'You have the ADMIN role and the products:read permission.',
      userId: user.id,
    };
  }

  @Get('rbac-demo/roles-any')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Roles('ADMIN', 'VENDOR')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '[RBAC demo] Requires ADMIN OR VENDOR (any one role suffices)',
    description:
      "Demonstrates that multiple roles in one @Roles() call are OR'd — " +
      'not a real business endpoint.',
  })
  @ApiOkResponse({ description: 'Caller has ADMIN and/or VENDOR.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description: 'Authenticated, but has neither required role.',
  })
  rbacDemoRolesAny(@CurrentUser() user: SafeUser) {
    return { message: 'You have ADMIN and/or VENDOR.', userId: user.id };
  }

  @Get('rbac-demo/permissions-all')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Permissions(
    { resource: 'products', action: 'read' },
    { resource: 'inventory', action: 'adjust' },
  )
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      '[RBAC demo] Requires products:read AND inventory:adjust (all permissions required)',
    description:
      'Demonstrates that multiple permissions in one @Permissions() ' +
      "call are AND'd — not a real business endpoint.",
  })
  @ApiOkResponse({
    description: 'Caller has both products:read and inventory:adjust.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description: 'Authenticated, but missing at least one required permission.',
  })
  rbacDemoPermissionsAll(@CurrentUser() user: SafeUser) {
    return {
      message: 'You have products:read and inventory:adjust.',
      userId: user.id,
    };
  }
}
