import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { ProductImagesController } from './product-images/product-images.controller';
import { ProductImagesService } from './product-images/product-images.service';
import { InventoryService } from './product-variants/inventory.service';
import { ProductVariantsController } from './product-variants/product-variants.controller';
import { ProductVariantsService } from './product-variants/product-variants.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';

/**
 * The Catalog domain (docs/architecture.md's project structure lists a
 * single `catalog/` module directory, unlike `vendors/`/`shops/` which
 * are split — honored literally here). Category, Product, and (Phase 21)
 * ProductVariant/Inventory (Phase 21), and ProductImage (Phase 22) are
 * kept as internally-separate concerns (own controllers/services/dto
 * folders) within this one module, matching that documented structure
 * while keeping each concern independently readable. `StorageModule` is
 * the one infrastructure import here, not a Catalog concern itself.
 */
@Module({
  imports: [PrismaModule, AuthModule, StorageModule],
  controllers: [
    CategoriesController,
    ProductsController,
    ProductVariantsController,
    ProductImagesController,
  ],
  providers: [
    CategoriesService,
    ProductsService,
    ProductVariantsService,
    InventoryService,
    ProductImagesService,
  ],
})
export class CatalogModule {}
