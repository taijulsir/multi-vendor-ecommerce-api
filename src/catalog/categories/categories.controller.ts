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

import { Roles } from '../../auth/decorators/roles.decorator';
import { AuthorizationGuard } from '../../auth/guards/authorization.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

/**
 * Category management (Phase 11). `Category` is a shared, platform-wide
 * taxonomy (no ownership field) — retrieval is public; creation/update
 * are ADMIN-only. See CategoriesService's doc-comment.
 */
@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'List all categories',
    description:
      'Public. Returns every non-deleted category (both ACTIVE and ' +
      'INACTIVE) as a flat list; each carries its own `parentId` so a ' +
      'client can reconstruct the hierarchy.',
  })
  @ApiOkResponse({ description: 'The list of categories.' })
  findAll() {
    return this.categoriesService.findAll();
  }

  @Get(':categoryId')
  @ApiOperation({ summary: 'Get a category by id' })
  @ApiParam({ name: 'categoryId', description: "The category's id." })
  @ApiOkResponse({ description: 'The category.' })
  @ApiNotFoundResponse({ description: 'Category not found.' })
  findById(@Param('categoryId') categoryId: string) {
    return this.categoriesService.findById(categoryId);
  }

  @Post()
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a category (ADMIN only)' })
  @ApiCreatedResponse({ description: 'Category created.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN.' })
  @ApiConflictResponse({ description: 'The requested slug is already in use.' })
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Patch(':categoryId')
  @UseGuards(JwtAuthGuard, AuthorizationGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({ name: 'categoryId', description: "The category's id." })
  @ApiOperation({ summary: 'Update a category (ADMIN only)' })
  @ApiOkResponse({ description: 'The updated category.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN.' })
  @ApiNotFoundResponse({ description: 'Category not found.' })
  @ApiConflictResponse({ description: 'The requested slug is already in use.' })
  update(
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(categoryId, dto);
  }
}
