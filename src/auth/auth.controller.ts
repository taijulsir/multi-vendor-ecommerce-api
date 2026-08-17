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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
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
        refreshToken: 'k3f9c2a01234a5b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7081920a1b2c3d',
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
    summary: 'Exchange a refresh token for a new access token',
  })
  @ApiOkResponse({
    description:
      'A new short-lived access token. The presented refresh token is ' +
      'not rotated or invalidated in this phase.',
    schema: {
      example: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description:
      'The refresh token is missing, unrecognized, expired, or the ' +
      'associated account is no longer permitted to authenticate.',
  })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @ApiOkResponse({
    description: 'The authenticated user, re-derived from the current database state.',
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
}
