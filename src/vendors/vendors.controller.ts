import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { SafeUser } from '../auth/utils/safe-user';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorVerificationDto } from './dto/update-vendor-verification.dto';
import { VendorsService } from './vendors.service';

/**
 * Vendor onboarding/profile foundation (Phase 10), extended with
 * ADMIN-only verification/activation (Phase 17, ADR-1). Controller stays
 * thin: identity resolution, transition validation, and persistence all
 * live in VendorsService — see its doc-comment for the exact business
 * rules (docs/database/vendor-shop.md §6) this implements.
 *
 * Verification and activation are deliberately two separate endpoints,
 * not a combined generic status-update endpoint — this shape is an
 * approved architecture decision (ADR-1,
 * docs/remaining-architecture-plan.md), not open for reconsideration.
 * Neither uses `VendorShopOwnershipGuard` — a vendor can never verify or
 * activate itself or another vendor; only `@Roles('ADMIN')` +
 * `AuthorizationGuard` (the same infrastructure already used by
 * `POST /api/categories` and `POST /api/payments/:id/refunds`) grants
 * access.
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

  @Patch(':vendorId/verification')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({ name: 'vendorId', description: "The vendor's id." })
  @ApiOperation({
    summary: "Update a vendor's verification status (ADMIN only)",
    description:
      'Transitions Vendor.verificationStatus. Only the transitions ' +
      'documented in docs/database/vendor-shop.md §6 are accepted: ' +
      'PENDING→UNDER_REVIEW, UNDER_REVIEW→VERIFIED, PENDING/' +
      'UNDER_REVIEW→REJECTED. VERIFIED and REJECTED are terminal — no ' +
      're-verification or re-application path exists. This endpoint ' +
      'never touches Vendor.status (see the separate activation ' +
      'endpoint) or any Shop resource.',
  })
  @ApiOkResponse({ description: 'The updated vendor.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN.' })
  @ApiNotFoundResponse({ description: 'Vendor not found.' })
  @ApiBadRequestResponse({ description: 'Invalid payload.' })
  @ApiConflictResponse({
    description:
      "The vendor's current verificationStatus does not allow this transition.",
  })
  verify(
    @Param('vendorId') vendorId: string,
    @Body() dto: UpdateVendorVerificationDto,
  ) {
    return this.vendorsService.verify(vendorId, dto);
  }

  @Patch(':vendorId/activation')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({ name: 'vendorId', description: "The vendor's id." })
  @ApiOperation({
    summary: 'Activate a verified vendor (ADMIN only)',
    description:
      'Transitions Vendor.status from PENDING to ACTIVE — the only ' +
      'transition docs/database/vendor-shop.md §6 documents under ' +
      '"Vendor Activation" — and only when verificationStatus is ' +
      'already VERIFIED. Takes no request body: there is no other ' +
      'valid target for a client to choose. This endpoint never touches ' +
      'Vendor.verificationStatus (see the separate verification ' +
      'endpoint) or any Shop resource.',
  })
  @ApiOkResponse({ description: 'The updated (now ACTIVE) vendor.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN.' })
  @ApiNotFoundResponse({ description: 'Vendor not found.' })
  @ApiConflictResponse({
    description:
      'The vendor is not eligible for activation (must be ' +
      'status=PENDING and verificationStatus=VERIFIED).',
  })
  activate(@Param('vendorId') vendorId: string) {
    return this.vendorsService.activate(vendorId);
  }
}
