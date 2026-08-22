import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Phase 13 — Checkout. `ProductVariant`/`Inventory` have no
 * application-layer controller yet, so fixtures are created directly
 * via Prisma, exactly like Phase 12's cart e2e suite.
 */
describe('Checkout API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const registeredEmails: string[] = [];
  const password = 'StrongPassw0rd!';

  const uniqueEmail = () => `checkout-e2e-${randomUUID()}@example.com`;
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

  const shippingAddress = {
    fullName: 'Jane Doe',
    phone: '+8801XXXXXXXXX',
    addressLine1: 'House 10, Road 5',
    city: 'Dhaka',
    postalCode: '1207',
    country: 'BD',
  };

  let categoryId: string;

  const createVendorProductVariant = async (
    overrides: {
      vendorStatus?: string;
      productStatus?: string;
      variantStatus?: string;
      price?: string;
      currency?: string;
      onHand?: number;
      reserved?: number;
      noInventory?: boolean;
    } = {},
  ) => {
    const owner = await registerAndLogin('FixtureOwner');
    const vendor = await prisma.vendor.create({
      data: {
        userId: owner.id,
        businessName: 'Fixture Vendor',
        status: (overrides.vendorStatus as any) ?? 'ACTIVE',
      },
    });
    const product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        categoryId,
        name: 'Fixture Product',
        slug: uniqueSlug('fixture-product'),
        status: (overrides.productStatus as any) ?? 'ACTIVE',
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: uniqueSlug('sku').toUpperCase(),
        price: overrides.price ?? '2500.00',
        currency: overrides.currency ?? 'BDT',
        status: (overrides.variantStatus as any) ?? 'ACTIVE',
      },
    });
    if (!overrides.noInventory) {
      await prisma.inventory.create({
        data: {
          variantId: variant.id,
          onHand: overrides.onHand ?? 100,
          reserved: overrides.reserved ?? 0,
        },
      });
    }

    return { owner, vendor, product, variant };
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
      data: {
        name: 'Checkout Test Category',
        slug: uniqueSlug('checkout-cat'),
      },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    // Deletion order: orders/cart rows before variants (restrict FKs),
    // variants before products, products before vendor/category, and
    // everything before users.
    const testUsers = await prisma.user.findMany({
      where: { email: { in: registeredEmails } },
      select: { id: true },
    });
    const testUserIds = testUsers.map((u) => u.id);

    if (testUserIds.length > 0) {
      const masterOrders = await prisma.masterOrder.findMany({
        where: { userId: { in: testUserIds } },
        select: { id: true },
      });
      const masterOrderIds = masterOrders.map((o) => o.id);

      if (masterOrderIds.length > 0) {
        const vendorOrders = await prisma.vendorOrder.findMany({
          where: { masterOrderId: { in: masterOrderIds } },
          select: { id: true },
        });
        const vendorOrderIds = vendorOrders.map((v) => v.id);

        await prisma.orderItem.deleteMany({
          where: { vendorOrderId: { in: vendorOrderIds } },
        });
        await prisma.vendorOrderStatusHistory.deleteMany({
          where: { vendorOrderId: { in: vendorOrderIds } },
        });
        await prisma.vendorOrder.deleteMany({
          where: { id: { in: vendorOrderIds } },
        });
        await prisma.orderStatusHistory.deleteMany({
          where: { masterOrderId: { in: masterOrderIds } },
        });
        await prisma.masterOrder.deleteMany({
          where: { id: { in: masterOrderIds } },
        });
      }

      await prisma.cart.deleteMany({ where: { userId: { in: testUserIds } } });
    }

    const vendors = await prisma.vendor.findMany({
      where: { user: { email: { in: registeredEmails } } },
      select: { id: true },
    });
    const vendorIds = vendors.map((v) => v.id);

    if (vendorIds.length > 0) {
      const products = await prisma.product.findMany({
        where: { vendorId: { in: vendorIds } },
        select: { id: true },
      });
      const productIds = products.map((p) => p.id);

      const variants = await prisma.productVariant.findMany({
        where: { productId: { in: productIds } },
        select: { id: true },
      });
      const variantIds = variants.map((v) => v.id);

      await prisma.inventoryTransaction.deleteMany({
        where: { inventory: { variantId: { in: variantIds } } },
      });
      await prisma.inventory.deleteMany({
        where: { variantId: { in: variantIds } },
      });
      await prisma.productVariant.deleteMany({
        where: { id: { in: variantIds } },
      });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    }

    await prisma.category.deleteMany({ where: { id: categoryId } });

    if (registeredEmails.length > 0) {
      await prisma.user.deleteMany({
        where: { email: { in: registeredEmails } },
      });
    }

    await app.close();
  });

  describe('POST /api/checkout', () => {
    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/api/checkout')
        .send({ shippingAddress })
        .expect(401);
    });

    it('rejects (400) an invalid payload (missing shippingAddress)', async () => {
      const user = await registerAndLogin('InvalidPayloadUser');

      await request(app.getHttpServer())
        .post('/api/checkout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({})
        .expect(400);
    });

    it('rejects (400) when the user has no cart at all', async () => {
      const user = await registerAndLogin('NoCartUser');

      await request(app.getHttpServer())
        .post('/api/checkout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ shippingAddress })
        .expect(400);
    });

    it('rejects (400) when the active cart has no items', async () => {
      const user = await registerAndLogin('EmptyCartUser');
      const { variant } = await createVendorProductVariant();

      const added = await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/cart/items/${added.body.items[0].id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/checkout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ shippingAddress })
        .expect(400);
    });

    it('rejects (400) client-supplied price/subtotal/total fields — unknown properties rejected by the global whitelist', async () => {
      const user = await registerAndLogin('SpoofTotalUser');
      const { variant } = await createVendorProductVariant();

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/checkout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ shippingAddress, totalAmount: '1.00', subtotal: '1.00' })
        .expect(400);
    });

    it('creates a MasterOrder + VendorOrder + OrderItem, computes correct totals/currency, converts the cart, and reserves inventory', async () => {
      const user = await registerAndLogin('SuccessfulCheckoutUser');
      const { vendor, product, variant } = await createVendorProductVariant({
        price: '2500.00',
        onHand: 100,
        reserved: 0,
      });

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id, quantity: 3 })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post('/api/checkout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ shippingAddress, customerNote: 'Please call before delivery.' })
        .expect(201);

      expect(response.body.currency).toBe('BDT');
      expect(response.body.subtotal).toBe('7500.00');
      expect(response.body.totalAmount).toBe('7500.00');
      expect(response.body.paymentStatus).toBe('PENDING');
      expect(response.body.status).toBe('PENDING');
      expect(response.body.customerNote).toBe('Please call before delivery.');
      expect(response.body.billingAddressSnapshot).toEqual(
        expect.objectContaining({ fullName: 'Jane Doe' }),
      );
      expect(response.body.vendorOrders).toHaveLength(1);
      expect(response.body.vendorOrders[0].vendorId).toBe(vendor.id);
      expect(response.body.vendorOrders[0].subtotal).toBe('7500.00');
      expect(response.body.vendorOrders[0]).not.toHaveProperty(
        'commissionAmount',
      );
      expect(response.body.vendorOrders[0].items).toHaveLength(1);
      const orderItem = response.body.vendorOrders[0].items[0];
      expect(orderItem.productId).toBe(product.id);
      expect(orderItem.variantId).toBe(variant.id);
      expect(orderItem.quantity).toBe(3);
      expect(orderItem.unitPrice).toBe('2500.00');
      expect(orderItem.totalAmount).toBe('7500.00');

      // Cart converted, not just emptied.
      const cart = await request(app.getHttpServer())
        .get('/api/cart')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(cart.body.id).toBeNull();
      expect(cart.body.items).toEqual([]);

      // Inventory reserved, onHand untouched.
      const inventory = await prisma.inventory.findUniqueOrThrow({
        where: { variantId: variant.id },
      });
      expect(inventory.onHand).toBe(100);
      expect(inventory.reserved).toBe(3);

      const transactions = await prisma.inventoryTransaction.findMany({
        where: { inventoryId: inventory.id },
      });
      expect(transactions).toHaveLength(1);
      expect(transactions[0].type).toBe('RESERVATION');
      expect(transactions[0].quantity).toBe(3);
    });

    it('splits a multi-vendor cart into one VendorOrder per vendor, with MasterOrder totals summing all vendors', async () => {
      const user = await registerAndLogin('MultiVendorUser');
      const fixtureA = await createVendorProductVariant({ price: '1000.00' });
      const fixtureB = await createVendorProductVariant({ price: '2000.00' });

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: fixtureA.variant.id, quantity: 2 })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: fixtureB.variant.id, quantity: 1 })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post('/api/checkout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ shippingAddress })
        .expect(201);

      // 2x1000 + 1x2000 = 4000
      expect(response.body.subtotal).toBe('4000.00');
      expect(response.body.totalAmount).toBe('4000.00');
      expect(response.body.vendorOrders).toHaveLength(2);

      const vendorIds = response.body.vendorOrders.map(
        (vo: { vendorId: string }) => vo.vendorId,
      );
      expect(vendorIds.sort()).toEqual(
        [fixtureA.vendor.id, fixtureB.vendor.id].sort(),
      );

      const totalsSum = response.body.vendorOrders.reduce(
        (sum: number, vo: { totalAmount: string }) =>
          sum + Number(vo.totalAmount),
        0,
      );
      expect(totalsSum).toBe(4000);
    });

    it('rejects (400) when a cart item became unavailable (product deactivated) after being added to the cart', async () => {
      const user = await registerAndLogin('BecameUnavailableUser');
      const { product, variant } = await createVendorProductVariant();

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id })
        .expect(200);

      await prisma.product.update({
        where: { id: product.id },
        data: { status: 'INACTIVE' },
      });

      await request(app.getHttpServer())
        .post('/api/checkout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ shippingAddress })
        .expect(400);
    });

    it("rejects (400) when a cart item's vendor became unavailable after being added to the cart", async () => {
      const user = await registerAndLogin('VendorBecameUnavailableUser');
      const { vendor, variant } = await createVendorProductVariant();

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id })
        .expect(200);

      await prisma.vendor.update({
        where: { id: vendor.id },
        data: { status: 'FROZEN' },
      });

      await request(app.getHttpServer())
        .post('/api/checkout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ shippingAddress })
        .expect(400);
    });

    it('rejects (409) when requested quantity exceeds currently available stock', async () => {
      const user = await registerAndLogin('InsufficientStockUser');
      const { variant } = await createVendorProductVariant({
        onHand: 2,
        reserved: 0,
      });

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id, quantity: 5 })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/checkout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ shippingAddress })
        .expect(409);

      // Insufficient-stock checkout must not have reserved anything.
      const inventory = await prisma.inventory.findUniqueOrThrow({
        where: { variantId: variant.id },
      });
      expect(inventory.reserved).toBe(0);
    });

    it('rejects (409) when a cart item currency no longer matches the cart currency', async () => {
      const user = await registerAndLogin('CurrencyMismatchUser');
      const { variant } = await createVendorProductVariant({ currency: 'BDT' });

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id })
        .expect(200);

      // Simulate the currency changing after add-to-cart (no application
      // endpoint mutates variant currency; this models the documented
      // "must revalidate" scenario directly at the data layer).
      await prisma.productVariant.update({
        where: { id: variant.id },
        data: { currency: 'USD' },
      });

      await request(app.getHttpServer())
        .post('/api/checkout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ shippingAddress })
        .expect(409);
    });

    it('a duplicate/retried checkout against the same (now-converted) cart is rejected rather than creating a second order', async () => {
      const user = await registerAndLogin('DuplicateCheckoutUser');
      const { variant } = await createVendorProductVariant();

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ variantId: variant.id })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/checkout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ shippingAddress })
        .expect(201);

      // Retry against the same (now CONVERTED, itemless-from-the-user's-
      // perspective) cart: no active cart exists any more.
      await request(app.getHttpServer())
        .post('/api/checkout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ shippingAddress })
        .expect(400);

      const orderCount = await prisma.masterOrder.count({
        where: { userId: user.id },
      });
      expect(orderCount).toBe(1);
    });

    it("one user's checkout never touches another user's cart or creates an order under another user's identity", async () => {
      const userA = await registerAndLogin('IsolationUserA');
      const userB = await registerAndLogin('IsolationUserB');
      const { variant } = await createVendorProductVariant();

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ variantId: variant.id })
        .expect(200);

      // User A has no cart at all — must not somehow check out User B's.
      await request(app.getHttpServer())
        .post('/api/checkout')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ shippingAddress })
        .expect(400);

      const ordersForA = await prisma.masterOrder.count({
        where: { userId: userA.id },
      });
      expect(ordersForA).toBe(0);

      const cartB = await request(app.getHttpServer())
        .get('/api/cart')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);
      expect(cartB.body.items).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------
  // Concurrency proof (Phase 18)
  //
  // The sequential "duplicate/retried checkout" test above only proves
  // the *pre-transaction* `cart.findFirst` guard (a cart that is already
  // CONVERTED by the time a second request starts is rejected 400,
  // "empty cart"). It does NOT exercise CheckoutService's actual
  // concurrency mechanism: the atomic `cart.updateMany({ status: ACTIVE
  // → CONVERTED })` guard *inside* the transaction (checkout.service.ts),
  // which is what protects two requests that are both still in flight —
  // both having already passed the pre-transaction check — from racing
  // each other. Proving that requires two HTTP requests that are
  // genuinely still-open at the same time, which `Promise.all` gives:
  // both `supertest` requests are started in the same microtask (calling
  // `.then()`/awaiting a supertest Test object is what triggers
  // `.end()`), so both reach the Node event loop, and then Postgres,
  // while still concurrent — the same technique already established in
  // this codebase's own `test/auth.e2e-spec.ts` "concurrent refresh"
  // test for an analogous single-winner DB-row-lock guarantee. No sleep,
  // delay, or artificial synchronization is introduced anywhere — the
  // race is real, and its outcome is decided entirely by PostgreSQL's
  // own row-level locking on the `carts` row (whichever transaction's
  // `UPDATE ... WHERE status = 'ACTIVE'` commits first "wins"; the
  // second transaction's identical `UPDATE` then finds 0 matching rows
  // under READ COMMITTED and the affected-row-count check fails).
  describe('Concurrency (Phase 18)', () => {
    // A small, deterministic repeat count (not a stress test) — see this
    // phase's final report for why a single run is already conclusive
    // (the guard is a DB row lock, not a probabilistic race) and why a
    // few repeats are still run to demonstrate stability across
    // independent event-loop schedulings.
    const RACE_REPETITIONS = 3;

    it('lets exactly one of two concurrent checkout requests against the same active cart succeed, with no duplicate order and no double inventory reservation', async () => {
      for (let attempt = 0; attempt < RACE_REPETITIONS; attempt++) {
        const user = await registerAndLogin(`ConcurrentCheckout${attempt}`);
        // Inventory tight enough that a double-reservation would be
        // impossible to miss: exactly one unit available for exactly one
        // request to legitimately claim.
        const { variant } = await createVendorProductVariant({
          onHand: 1,
          reserved: 0,
        });

        await request(app.getHttpServer())
          .post('/api/cart/items')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ variantId: variant.id, quantity: 1 })
          .expect(200);

        // Identical payload, identical authenticated identity, identical
        // (server-resolved) cart — the only way these two requests can
        // differ in outcome is the database race itself. No `cartId`,
        // `userId`, price, or quantity is ever sent by the client — the
        // existing CheckoutDto (unchanged) has no such fields.
        const checkoutPayload = { shippingAddress };

        const [responseA, responseB] = await Promise.all([
          request(app.getHttpServer())
            .post('/api/checkout')
            .set('Authorization', `Bearer ${user.accessToken}`)
            .send(checkoutPayload),
          request(app.getHttpServer())
            .post('/api/checkout')
            .set('Authorization', `Bearer ${user.accessToken}`)
            .send(checkoutPayload),
        ]);

        // Exactly one success, one conflict — never two successes
        // (double order) and never two failures (checkout should have
        // been possible at all).
        const statuses = [responseA.status, responseB.status].sort(
          (a, b) => a - b,
        );
        expect(statuses).toEqual([201, 409]);

        // The loser must fail with the documented cart-race conflict —
        // not an unrelated/unexpected error — proving this is genuinely
        // CheckoutService's atomic cart-conversion guard and not some
        // other failure mode.
        const loser = responseA.status === 409 ? responseA : responseB;
        expect(loser.body.message).toBe('Your cart is empty or does not exist');

        // --- The database state is the real proof, not the HTTP status. ---

        const masterOrderCount = await prisma.masterOrder.count({
          where: { userId: user.id },
        });
        expect(masterOrderCount).toBe(1);

        const masterOrder = await prisma.masterOrder.findFirstOrThrow({
          where: { userId: user.id },
          include: { vendorOrders: { include: { items: true } } },
        });
        expect(masterOrder.vendorOrders).toHaveLength(1);
        expect(masterOrder.vendorOrders[0].items).toHaveLength(1);
        expect(masterOrder.vendorOrders[0].items[0].variantId).toBe(variant.id);
        expect(masterOrder.vendorOrders[0].items[0].quantity).toBe(1);

        const inventory = await prisma.inventory.findUniqueOrThrow({
          where: { variantId: variant.id },
        });
        expect(inventory.onHand).toBe(1);
        // The critical assertion: reserved must be exactly 1, never 2.
        expect(inventory.reserved).toBe(1);

        const reservationTransactions = await prisma.inventoryTransaction.count(
          {
            where: { inventoryId: inventory.id, type: 'RESERVATION' },
          },
        );
        expect(reservationTransactions).toBe(1);

        const cart = await prisma.cart.findFirstOrThrow({
          where: { userId: user.id },
        });
        expect(cart.status).toBe('CONVERTED');
      }
    });
  });
});
