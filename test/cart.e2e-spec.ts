import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Phase 12 — Cart retrieval/mutation. `ProductVariant` has no
 * application-layer controller yet (Phase 11 deliberately scoped
 * Catalog to Category/Product only), so variant fixtures are created
 * directly via Prisma here, exactly like the Vendor/Shop/Category
 * fixtures in earlier phases' e2e suites before their own controllers
 * existed.
 */
describe('Cart API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const registeredEmails: string[] = [];
  const password = 'StrongPassw0rd!';

  const uniqueEmail = () => `cart-e2e-${randomUUID()}@example.com`;
  const uniqueSlug = (prefix: string) => `${prefix}-${randomUUID()}`;

  const registerAndLogin = async (firstName: string) => {
    const email = uniqueEmail();
    registeredEmails.push(email);

    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, firstName })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);

    return {
      id: login.body.id as string,
      email,
      accessToken: login.body.accessToken as string,
    };
  };

  let categoryId: string;
  let vendorRecordId: string;
  let productId: string;

  const createVariant = async (overrides: Record<string, unknown> = {}) => {
    return prisma.productVariant.create({
      data: {
        productId,
        sku: uniqueSlug('sku').toUpperCase(),
        price: '2500.00',
        currency: 'BDT',
        attributes: { color: 'Black' },
        ...overrides,
      },
    });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = app.get(PrismaService);

    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    const category = await prisma.category.create({
      data: { name: 'Cart Test Category', slug: uniqueSlug('cart-cat') },
    });
    categoryId = category.id;

    const vendorOwner = await registerAndLogin('CartFixtureVendorOwner');
    const vendorRecord = await prisma.vendor.create({
      data: {
        userId: vendorOwner.id,
        businessName: 'Cart Fixture Vendor',
        status: 'ACTIVE',
      },
    });
    vendorRecordId = vendorRecord.id;

    const product = await prisma.product.create({
      data: {
        vendorId: vendorRecordId,
        categoryId,
        name: 'Cart Fixture Product',
        slug: uniqueSlug('cart-product'),
        status: 'ACTIVE',
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    // Deletion order matters: Cart→User, CartItem→ProductVariant,
    // ProductVariant→Product, and Product→{Vendor,Category} are all
    // onDelete: Restrict. Carts (and their items, cascaded) must go
    // before variants; variants before the product; the product before
    // vendor/category; and everything before the users.
    const testUsers = await prisma.user.findMany({
      where: { email: { in: registeredEmails } },
      select: { id: true },
    });
    const testUserIds = testUsers.map((u) => u.id);

    if (testUserIds.length > 0) {
      await prisma.cart.deleteMany({ where: { userId: { in: testUserIds } } });
    }
    await prisma.productVariant.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.vendor.deleteMany({ where: { id: vendorRecordId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });

    if (registeredEmails.length > 0) {
      await prisma.user.deleteMany({
        where: { email: { in: registeredEmails } },
      });
    }

    await app.close();
  });

  describe('GET /api/cart', () => {
    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/api/cart').expect(401);
    });

    it('returns a synthesized empty cart (200, not 404) for a user with no active cart', async () => {
      const user = await registerAndLogin('EmptyCartUser');

      const response = await request(app.getHttpServer())
        .get('/api/cart')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(response.body).toEqual({
        id: null,
        status: null,
        currency: null,
        expiresAt: null,
        items: [],
        total: '0.00',
      });
    });
  });

  describe('POST /api/cart/items', () => {
    it('creates a cart and adds the item, computing subtotal/total from the authoritative variant price', async () => {
      const user = await registerAndLogin('AddItemUser');
      const variant = await createVariant({ price: '2500.00' });

      const response = await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id, quantity: 2 })
        .expect(200);

      expect(response.body.status).toBe('ACTIVE');
      expect(response.body.currency).toBe('BDT');
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].variantId).toBe(variant.id);
      expect(response.body.items[0].quantity).toBe(2);
      expect(response.body.items[0].unitPriceSnapshot).toBe('2500.00');
      expect(response.body.items[0].subtotal).toBe('5000.00');
      expect(response.body.total).toBe('5000.00');
    });

    it('adding the same variant again increments quantity instead of creating a second item (§10)', async () => {
      const user = await registerAndLogin('MergeItemUser');
      const variant = await createVariant();

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id, quantity: 1 })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id, quantity: 2 })
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].quantity).toBe(3);
    });

    it('defaults quantity to 1 when omitted', async () => {
      const user = await registerAndLogin('DefaultQuantityUser');
      const variant = await createVariant();

      const response = await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id })
        .expect(200);

      expect(response.body.items[0].quantity).toBe(1);
    });

    it('rejects (401) an unauthenticated request', async () => {
      const variant = await createVariant();

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .send({ variantId: variant.id })
        .expect(401);
    });

    it('rejects (400) an invalid payload (missing variantId)', async () => {
      const user = await registerAndLogin('InvalidPayloadUser');

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({})
        .expect(400);
    });

    it('rejects (400) an invalid quantity (zero, negative, non-integer)', async () => {
      const user = await registerAndLogin('InvalidQuantityUser');
      const variant = await createVariant();

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id, quantity: 0 })
        .expect(400);

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id, quantity: -1 })
        .expect(400);

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id, quantity: 1.5 })
        .expect(400);
    });

    it('rejects (400) a nonexistent variantId', async () => {
      const user = await registerAndLogin('NonexistentVariantUser');

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: randomUUID() })
        .expect(400);
    });

    it('rejects (400) a variant whose product is not ACTIVE (invalid variant/product relationship)', async () => {
      const user = await registerAndLogin('InactiveProductUser');
      const inactiveProduct = await prisma.product.create({
        data: {
          vendorId: vendorRecordId,
          categoryId,
          name: 'Draft Product',
          slug: uniqueSlug('draft-product'),
          // status intentionally omitted -> defaults DRAFT
        },
      });
      const variant = await prisma.productVariant.create({
        data: {
          productId: inactiveProduct.id,
          sku: uniqueSlug('sku').toUpperCase(),
          price: '999.00',
          currency: 'BDT',
        },
      });

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id })
        .expect(400);

      await prisma.productVariant.delete({ where: { id: variant.id } });
      await prisma.product.delete({ where: { id: inactiveProduct.id } });
    });

    it('rejects (400) an INACTIVE variant', async () => {
      const user = await registerAndLogin('InactiveVariantUser');
      const variant = await createVariant({ status: 'INACTIVE' });

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id })
        .expect(400);
    });

    it('rejects (409) a variant whose currency does not match the existing cart currency', async () => {
      const user = await registerAndLogin('CurrencyMismatchUser');
      const bdtVariant = await createVariant({ currency: 'BDT' });
      const usdVariant = await createVariant({ currency: 'USD' });

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: bdtVariant.id })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: usdVariant.id })
        .expect(409);
    });

    it('a client-supplied userId in the body is rejected by the global whitelist and never used', async () => {
      const user = await registerAndLogin('SpoofUserIdOnAdd');
      const variant = await createVariant();

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id, userId: randomUUID() })
        .expect(400);
    });

    it('client-supplied price/subtotal fields are rejected by the global whitelist', async () => {
      const user = await registerAndLogin('SpoofPriceUser');
      const variant = await createVariant();

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          variantId: variant.id,
          unitPriceSnapshot: '1.00',
          subtotal: '1.00',
        })
        .expect(400);
    });
  });

  describe('PATCH /api/cart/items/:itemId', () => {
    it("updates the quantity of the caller's own item", async () => {
      const user = await registerAndLogin('UpdateQuantityUser');
      const variant = await createVariant();

      const added = await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id, quantity: 1 })
        .expect(200);
      const itemId = added.body.items[0].id;

      const response = await request(app.getHttpServer())
        .patch(`/api/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ quantity: 7 })
        .expect(200);

      expect(response.body.items[0].quantity).toBe(7);
    });

    it('rejects (400) an invalid quantity', async () => {
      const user = await registerAndLogin('InvalidUpdateQuantityUser');
      const variant = await createVariant();

      const added = await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id })
        .expect(200);
      const itemId = added.body.items[0].id;

      await request(app.getHttpServer())
        .patch(`/api/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ quantity: 0 })
        .expect(400);
    });

    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .patch(`/api/cart/items/${randomUUID()}`)
        .send({ quantity: 2 })
        .expect(401);
    });

    it("User A cannot update User B's cart item (403, non-disclosing)", async () => {
      const userA = await registerAndLogin('OwnerUserA');
      const userB = await registerAndLogin('AttackerUserB');
      const variant = await createVariant();

      const added = await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ variantId: variant.id })
        .expect(200);
      const itemId = added.body.items[0].id;

      const response = await request(app.getHttpServer())
        .patch(`/api/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ quantity: 99 })
        .expect(403);

      const serialized = JSON.stringify(response.body).toLowerCase();
      expect(serialized).not.toContain(userA.id.toLowerCase());
      expect(serialized).not.toMatch(/prisma|postgres|sql/);

      // Confirm User A's item was genuinely untouched.
      const cart = await request(app.getHttpServer())
        .get('/api/cart')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);
      expect(cart.body.items[0].quantity).toBe(1);
    });

    it('rejects (403) a nonexistent itemId, identically to a real cross-user item', async () => {
      const user = await registerAndLogin('NonexistentItemUser');

      await request(app.getHttpServer())
        .patch(`/api/cart/items/${randomUUID()}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ quantity: 2 })
        .expect(403);
    });
  });

  describe('DELETE /api/cart/items/:itemId', () => {
    it("removes the caller's own item and returns the updated cart", async () => {
      const user = await registerAndLogin('RemoveItemUser');
      const variant = await createVariant();

      const added = await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id })
        .expect(200);
      const itemId = added.body.items[0].id;

      const response = await request(app.getHttpServer())
        .delete(`/api/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(response.body.items).toEqual([]);
    });

    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .delete(`/api/cart/items/${randomUUID()}`)
        .expect(401);
    });

    it("User A cannot delete User B's cart item", async () => {
      const userA = await registerAndLogin('DeleteOwnerUserA');
      const userB = await registerAndLogin('DeleteAttackerUserB');
      const variant = await createVariant();

      const added = await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ variantId: variant.id })
        .expect(200);
      const itemId = added.body.items[0].id;

      await request(app.getHttpServer())
        .delete(`/api/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(403);

      const cart = await request(app.getHttpServer())
        .get('/api/cart')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);
      expect(cart.body.items).toHaveLength(1);
    });
  });

  describe('DELETE /api/cart/items (clear cart)', () => {
    it("removes every item from the caller's active cart", async () => {
      const user = await registerAndLogin('ClearCartUser');
      const variantA = await createVariant();
      const variantB = await createVariant();

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variantA.id })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variantB.id })
        .expect(200);

      const response = await request(app.getHttpServer())
        .delete('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(response.body.items).toEqual([]);
    });

    it('is a no-op (still 200) for a user with no active cart', async () => {
      const user = await registerAndLogin('ClearEmptyCartUser');

      const response = await request(app.getHttpServer())
        .delete('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(response.body.items).toEqual([]);
    });

    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer()).delete('/api/cart/items').expect(401);
    });

    it("User A's clear-cart request does not affect User B's cart", async () => {
      const userA = await registerAndLogin('ClearIsolationUserA');
      const userB = await registerAndLogin('ClearIsolationUserB');
      const variant = await createVariant();

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ variantId: variant.id })
        .expect(200);

      await request(app.getHttpServer())
        .delete('/api/cart/items')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      const cartB = await request(app.getHttpServer())
        .get('/api/cart')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);
      expect(cartB.body.items).toHaveLength(1);
    });
  });

  describe('Cart read isolation', () => {
    it("User A cannot read User B's cart contents through their own GET /api/cart", async () => {
      const userA = await registerAndLogin('ReadIsolationUserA');
      const userB = await registerAndLogin('ReadIsolationUserB');
      const variant = await createVariant();

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ variantId: variant.id })
        .expect(200);

      const cartA = await request(app.getHttpServer())
        .get('/api/cart')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(cartA.body.items).toEqual([]);
    });
  });
});
