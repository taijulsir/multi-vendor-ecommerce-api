import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { SafeUser } from '../auth/utils/safe-user';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { VendorsService } from './vendors.service';

/**
 * Vendor onboarding/profile foundation (Phase 10). Controller stays thin:
 * identity resolution, duplicate-prevention, and persistence all live in
 * VendorsService — see its doc-comment for the exact business rule
 * (docs/database/vendor-shop.md §6) this implements.
 */
@ApiTags('vendors')
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Apply to become a vendor (create your own Vendor profile)',
    description:
      'Creates a Vendor profile for the authenticated user with ' +
      'status=PENDING and verificationStatus=PENDING (docs/database/' +
      'vendor-shop.md §6). Identity is always taken from the access ' +
      'token — the request body cannot specify whose profile this is. ' +
      'Verification and activation are administrative operations and ' +
      'are not part of this endpoint.',
  })
  @ApiCreatedResponse({ description: 'Vendor profile created.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiConflictResponse({
    description: 'This account already has a vendor profile.',
  })
  create(@CurrentUser() user: SafeUser, @Body() dto: CreateVendorDto) {
    return this.vendorsService.createForUser(user.id, dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get the authenticated user's own vendor profile" })
  @ApiOkResponse({ description: "The caller's vendor profile." })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiNotFoundResponse({
    description: 'This account does not have a vendor profile.',
  })
  me(@CurrentUser() user: SafeUser) {
    return this.vendorsService.findForUser(user.id);
  }
}
