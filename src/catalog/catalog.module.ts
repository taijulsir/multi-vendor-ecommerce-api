import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';

/**
 * The Catalog domain (docs/architecture.md's project structure lists a
 * single `catalog/` module directory, unlike `vendors/`/`shops/` which
 * are split — honored literally here). Category and Product are kept as
 * internally-separate concerns (own controllers/services/dto folders)
 * within this one module, matching that documented structure while
 * keeping the two concerns independently readable.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CategoriesController, ProductsController],
  providers: [CategoriesService, ProductsService],
})
export class CatalogModule {}
