import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Phase 14 — Order viewing (customer's own MasterOrders,
 * vendor's own VendorOrders). Orders are produced via the real
 * checkout flow (Phase 13) rather than inserted directly, for realism.
 */
describe('Orders API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const registeredEmails: string[] = [];
  const password = 'StrongPassw0rd!';

  const uniqueEmail = () => `orders-e2e-${randomUUID()}@example.com`;
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

  const createVendorProductVariant = async () => {
    const owner = await registerAndLogin('FixtureOwner');
    const vendor = await prisma.vendor.create({
      data: {
        userId: owner.id,
        businessName: 'Fixture Vendor',
        status: 'ACTIVE',
      },
    });
    const product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        categoryId,
        name: 'Fixture Product',
        slug: uniqueSlug('fixture-product'),
        status: 'ACTIVE',
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: uniqueSlug('sku').toUpperCase(),
        price: '2500.00',
        currency: 'BDT',
      },
    });
    await prisma.inventory.create({
      data: { variantId: variant.id, onHand: 100, reserved: 0 },
    });

    return { owner, vendor, product, variant };
  };

  /** Registers a customer, adds one item to cart, checks out, returns everything needed for assertions. */
  const checkoutAsNewCustomer = async (firstName: string) => {
    const customer = await registerAndLogin(firstName);
    const fixture = await createVendorProductVariant();

    await request(app.getHttpServer())
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ variantId: fixture.variant.id, quantity: 2 })
      .expect(200);

    const checkoutResponse = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ shippingAddress })
      .expect(201);

    return { customer, fixture, order: checkoutResponse.body };
  };

  /** Same as checkoutAsNewCustomer, but the cart contains items from two distinct vendors, producing two VendorOrders under one MasterOrder. */
  const checkoutMultiVendorAsNewCustomer = async (firstName: string) => {
    const customer = await registerAndLogin(firstName);
    const fixtureA = await createVendorProductVariant();
    const fixtureB = await createVendorProductVariant();

    await request(app.getHttpServer())
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ variantId: fixtureA.variant.id, quantity: 1 })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ variantId: fixtureB.variant.id, quantity: 1 })
      .expect(200);

    const checkoutResponse = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ shippingAddress })
      .expect(201);

    return { customer, fixtureA, fixtureB, order: checkoutResponse.body };
  };

  const createAdmin = async (firstName: string) => {
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'ADMIN' },
    });
    const admin = await registerAndLogin(firstName);
    await prisma.userRole.create({
      data: { userId: admin.id, roleId: adminRole.id },
    });
    return admin;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = app.get(PrismaService);

    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    const category = await prisma.category.create({
      data: { name: 'Orders Test Category', slug: uniqueSlug('orders-cat') },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
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

  describe('GET /api/orders (customer)', () => {
    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/api/orders').expect(401);
    });

    it('returns an empty list for a user with no orders', async () => {
      const user = await registerAndLogin('NoOrdersUser');

      const response = await request(app.getHttpServer())
        .get('/api/orders')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it("lists the caller's own orders, newest first", async () => {
      const { customer, order } = await checkoutAsNewCustomer('ListOrdersUser');

      const response = await request(app.getHttpServer())
        .get('/api/orders')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(order.id);
    });

    it("does not include another user's orders", async () => {
      const { order: orderA } = await checkoutAsNewCustomer(
        'IsolationOrdersUserA',
      );
      const userB = await registerAndLogin('IsolationOrdersUserB');

      const response = await request(app.getHttpServer())
        .get('/api/orders')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
      expect(
        response.body.find((o: { id: string }) => o.id === orderA.id),
      ).toBeUndefined();
    });
  });

  describe('GET /api/orders/:masterOrderId (customer)', () => {
    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(`/api/orders/${randomUUID()}`)
        .expect(401);
    });

    it("returns the caller's own order with correct totals/currency/status", async () => {
      const { customer, order } =
        await checkoutAsNewCustomer('DetailOrderUser');

      const response = await request(app.getHttpServer())
        .get(`/api/orders/${order.id}`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(order.id);
      expect(response.body.currency).toBe('BDT');
      expect(response.body.totalAmount).toBe('5000.00');
      expect(response.body.paymentStatus).toBe('PENDING');
      expect(response.body.vendorOrders).toHaveLength(1);
      // Customer-facing view must not leak vendor/platform financial split.
      expect(response.body.vendorOrders[0]).not.toHaveProperty(
        'commissionAmount',
      );
      expect(response.body.vendorOrders[0]).not.toHaveProperty(
        'vendorNetAmount',
      );
    });

    it("forbids (403) User A from viewing User B's order", async () => {
      const { order } = await checkoutAsNewCustomer('CrossUserOrderOwnerA');
      const userB = await registerAndLogin('CrossUserOrderAttackerB');

      const response = await request(app.getHttpServer())
        .get(`/api/orders/${order.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(403);

      const serialized = JSON.stringify(response.body).toLowerCase();
      expect(serialized).not.toMatch(/prisma|postgres|sql/);
    });

    it('forbids (403) a nonexistent order id, identically to a real cross-user order', async () => {
      const user = await registerAndLogin('NonexistentOrderUser');

      await request(app.getHttpServer())
        .get(`/api/orders/${randomUUID()}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it("allows an ADMIN to view another user's order (documented bypass)", async () => {
      const { order } = await checkoutAsNewCustomer('AdminViewOrderOwner');
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { name: 'ADMIN' },
      });
      const adminAccount = await registerAndLogin('OrdersAdmin');
      await prisma.userRole.create({
        data: { userId: adminAccount.id, roleId: adminRole.id },
      });

      const response = await request(app.getHttpServer())
        .get(`/api/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminAccount.accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(order.id);
    });
  });

  describe('GET /api/vendor-orders (vendor)', () => {
    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/api/vendor-orders').expect(401);
    });

    it('rejects (403) a caller with no vendor profile', async () => {
      const user = await registerAndLogin('NoVendorProfileOrdersUser');

      await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it("lists the caller's own vendor orders, including commission/vendorNet fields", async () => {
      const { fixture } = await checkoutAsNewCustomer('VendorListOrdersUser');

      const response = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].vendorId).toBe(fixture.vendor.id);
      expect(response.body[0]).toHaveProperty('commissionAmount');
      expect(response.body[0]).toHaveProperty('vendorNetAmount');
      expect(response.body[0].items).toHaveLength(1);
    });

    it("does not include another vendor's orders", async () => {
      // Vendor A's checkout only matters for its side effect (creating a
      // VendorOrder that Vendor B's own list must not include).
      await checkoutAsNewCustomer('VendorIsolationOrdersUserA');
      const fixtureB = await createVendorProductVariant();

      const response = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixtureB.owner.accessToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('GET /api/vendor-orders/:vendorOrderId (vendor)', () => {
    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(`/api/vendor-orders/${randomUUID()}`)
        .expect(401);
    });

    it("returns the caller's own vendor order", async () => {
      const { fixture } = await checkoutAsNewCustomer('VendorDetailOrdersUser');

      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      const response = await request(app.getHttpServer())
        .get(`/api/vendor-orders/${vendorOrderId}`)
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(vendorOrderId);
      expect(response.body.totalAmount).toBe('5000.00');
    });

    it("forbids (403) Vendor A from viewing Vendor B's VendorOrder", async () => {
      const { fixture: fixtureA } = await checkoutAsNewCustomer(
        'VendorCrossAccessOwnerA',
      );
      const fixtureB = await createVendorProductVariant();

      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixtureA.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      const response = await request(app.getHttpServer())
        .get(`/api/vendor-orders/${vendorOrderId}`)
        .set('Authorization', `Bearer ${fixtureB.owner.accessToken}`)
        .expect(403);

      const serialized = JSON.stringify(response.body).toLowerCase();
      expect(serialized).not.toMatch(/prisma|postgres|sql/);
    });

    it('a spoofed vendorId/userId query parameter cannot bypass ownership', async () => {
      const { fixture: fixtureA } =
        await checkoutAsNewCustomer('VendorSpoofOwnerA');
      const fixtureB = await createVendorProductVariant();

      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixtureA.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      await request(app.getHttpServer())
        .get(
          `/api/vendor-orders/${vendorOrderId}?vendorId=${fixtureA.vendor.id}`,
        )
        .set('Authorization', `Bearer ${fixtureB.owner.accessToken}`)
        .expect(403);
    });

    it('forbids (403) a caller with no vendor profile', async () => {
      const user = await registerAndLogin('NoVendorProfileDetailUser');

      await request(app.getHttpServer())
        .get(`/api/vendor-orders/${randomUUID()}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it("allows an ADMIN to view any vendor's VendorOrder (documented bypass)", async () => {
      const { fixture } = await checkoutAsNewCustomer('VendorAdminViewOwner');
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { name: 'ADMIN' },
      });
      const adminAccount = await registerAndLogin('VendorOrdersAdmin');
      await prisma.userRole.create({
        data: { userId: adminAccount.id, roleId: adminRole.id },
      });

      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      const response = await request(app.getHttpServer())
        .get(`/api/vendor-orders/${vendorOrderId}`)
        .set('Authorization', `Bearer ${adminAccount.accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(vendorOrderId);
    });

    it('returns 404 for a nonexistent VendorOrder id when accessed as ADMIN (guard bypasses existence check)', async () => {
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { name: 'ADMIN' },
      });
      const adminAccount = await registerAndLogin('VendorOrdersAdminNotFound');
      await prisma.userRole.create({
        data: { userId: adminAccount.id, roleId: adminRole.id },
      });

      await request(app.getHttpServer())
        .get(`/api/vendor-orders/${randomUUID()}`)
        .set('Authorization', `Bearer ${adminAccount.accessToken}`)
        .expect(404);
    });
  });

  // -----------------------------------------------------------------
  // Vendor order status lifecycle (Phase 19, ADR-2/ADR-3)
  // -----------------------------------------------------------------
  describe('PATCH /api/vendor-orders/:vendorOrderId/status', () => {
    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .patch(`/api/vendor-orders/${randomUUID()}/status`)
        .send({ status: 'CONFIRMED' })
        .expect(401);
    });

    it('allows a vendor to progress a single-vendor order through the full documented lifecycle, deriving MasterOrder to FULFILLED', async () => {
      const { fixture, order } = await checkoutAsNewCustomer(
        'LifecycleVendorUser',
      );
      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      const transitions = [
        'CONFIRMED',
        'PROCESSING',
        'READY_TO_SHIP',
        'SHIPPED',
        'DELIVERED',
      ];

      for (const status of transitions) {
        const response = await request(app.getHttpServer())
          .patch(`/api/vendor-orders/${vendorOrderId}/status`)
          .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
          .send({ status })
          .expect(200);

        expect(response.body.status).toBe(status);
      }

      const finalVendorOrder = await prisma.vendorOrder.findUniqueOrThrow({
        where: { id: vendorOrderId },
      });
      expect(finalVendorOrder.status).toBe('DELIVERED');
      expect(finalVendorOrder.shippedAt).not.toBeNull();
      expect(finalVendorOrder.deliveredAt).not.toBeNull();

      const history = await prisma.vendorOrderStatusHistory.findMany({
        where: { vendorOrderId },
        orderBy: { createdAt: 'asc' },
      });
      // CheckoutService already writes the initial PENDING row
      // (fromStatus: null) at order creation — this phase's 5 vendor-
      // initiated transitions come after it.
      expect(history).toHaveLength(1 + transitions.length);
      expect(history[0]).toMatchObject({
        fromStatus: null,
        toStatus: 'PENDING',
      });
      expect(history.slice(1).map((h) => h.toStatus)).toEqual(transitions);
      expect(
        history.slice(1).every((h) => h.changedBy === fixture.owner.id),
      ).toBe(true);

      // MasterOrder derived to FULFILLED — single vendor, all delivered —
      // with its own OrderStatusHistory trail, and paymentStatus
      // untouched (Phase 15's concern, not this phase's).
      const finalMasterOrder = await prisma.masterOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(finalMasterOrder.status).toBe('FULFILLED');
      expect(finalMasterOrder.paymentStatus).toBe('PENDING');

      const masterHistory = await prisma.orderStatusHistory.findMany({
        where: { masterOrderId: order.id },
        orderBy: { createdAt: 'asc' },
      });
      // Initial PENDING row (from checkout) + CONFIRMED, PROCESSING,
      // FULFILLED derived transitions (READY_TO_SHIP/SHIPPED collapse
      // into PROCESSING and produce no additional MasterOrder change).
      expect(masterHistory.map((h) => h.toStatus)).toEqual([
        'PENDING',
        'CONFIRMED',
        'PROCESSING',
        'FULFILLED',
      ]);
    });

    it('allows PENDING → CANCELLED and derives MasterOrder to CANCELLED for a single-vendor order', async () => {
      const { fixture, order } =
        await checkoutAsNewCustomer('CancelVendorUser');
      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      const response = await request(app.getHttpServer())
        .patch(`/api/vendor-orders/${vendorOrderId}/status`)
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .send({ status: 'CANCELLED' })
        .expect(200);

      expect(response.body.status).toBe('CANCELLED');
      expect(response.body.cancelledAt).not.toBeNull();

      const finalMasterOrder = await prisma.masterOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(finalMasterOrder.status).toBe('CANCELLED');
      expect(finalMasterOrder.cancelledAt).not.toBeNull();
    });

    it.each([
      ['PENDING', 'PROCESSING'],
      ['PENDING', 'DELIVERED'],
      ['CONFIRMED', 'READY_TO_SHIP'],
    ])(
      'rejects (409) the undocumented transition %s → %s',
      async (from, to) => {
        const { fixture } = await checkoutAsNewCustomer(
          `InvalidTransition${from}${to}User`,
        );
        const listResponse = await request(app.getHttpServer())
          .get('/api/vendor-orders')
          .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
          .expect(200);
        const vendorOrderId = listResponse.body[0].id;

        if (from !== 'PENDING') {
          await request(app.getHttpServer())
            .patch(`/api/vendor-orders/${vendorOrderId}/status`)
            .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
            .send({ status: from })
            .expect(200);
        }

        await request(app.getHttpServer())
          .patch(`/api/vendor-orders/${vendorOrderId}/status`)
          .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
          .send({ status: to })
          .expect(409);
      },
    );

    it('rejects (409) PROCESSING → CANCELLED (explicitly excluded from this MVP by ADR-2)', async () => {
      const { fixture } = await checkoutAsNewCustomer('ProcessingCancelUser');
      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      await request(app.getHttpServer())
        .patch(`/api/vendor-orders/${vendorOrderId}/status`)
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .send({ status: 'CONFIRMED' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/vendor-orders/${vendorOrderId}/status`)
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .send({ status: 'PROCESSING' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/vendor-orders/${vendorOrderId}/status`)
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .send({ status: 'CANCELLED' })
        .expect(409);
    });

    it('rejects (403) another vendor updating a VendorOrder they do not own', async () => {
      const { fixture: fixtureA } = await checkoutAsNewCustomer(
        'StatusCrossVendorOwnerA',
      );
      const fixtureB = await createVendorProductVariant();

      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixtureA.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      const response = await request(app.getHttpServer())
        .patch(`/api/vendor-orders/${vendorOrderId}/status`)
        .set('Authorization', `Bearer ${fixtureB.owner.accessToken}`)
        .send({ status: 'CONFIRMED' })
        .expect(403);

      const serialized = JSON.stringify(response.body).toLowerCase();
      expect(serialized).not.toMatch(/prisma|postgres|sql/);

      // The targeted VendorOrder must remain untouched by the rejected
      // cross-vendor attempt.
      const untouched = await prisma.vendorOrder.findUniqueOrThrow({
        where: { id: vendorOrderId },
      });
      expect(untouched.status).toBe('PENDING');
    });

    it('a spoofed vendorId/userId in the body cannot substitute for ownership when the caller is not the actual owner', async () => {
      const { fixture: fixtureA } =
        await checkoutAsNewCustomer('StatusSpoofOwnerA');
      const fixtureB = await createVendorProductVariant();

      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixtureA.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      await request(app.getHttpServer())
        .patch(`/api/vendor-orders/${vendorOrderId}/status`)
        .set('Authorization', `Bearer ${fixtureB.owner.accessToken}`)
        .send({
          status: 'CONFIRMED',
          vendorId: fixtureA.vendor.id,
          userId: fixtureA.owner.id,
        })
        .expect((res) => {
          // Either rejected by whitelist validation (400, unknown
          // property) or by ownership (403) — never a success.
          if (![400, 403].includes(res.status)) {
            throw new Error(`Unexpected status ${res.status}`);
          }
        });
    });

    it('rejects (400) a body attempting to set unrelated/server-controlled fields even for the actual owner', async () => {
      const { fixture } = await checkoutAsNewCustomer(
        'StatusUnrelatedFieldsUser',
      );
      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      await request(app.getHttpServer())
        .patch(`/api/vendor-orders/${vendorOrderId}/status`)
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .send({
          status: 'CONFIRMED',
          vendorId: randomUUID(),
          masterOrderId: randomUUID(),
          totalAmount: '1.00',
        })
        .expect(400);
    });

    it("allows an ADMIN to update any vendor's VendorOrder status (documented bypass)", async () => {
      const { fixture } = await checkoutAsNewCustomer('StatusAdminUser');
      const admin = await createAdmin('StatusAdmin');

      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      const response = await request(app.getHttpServer())
        .patch(`/api/vendor-orders/${vendorOrderId}/status`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ status: 'CONFIRMED' })
        .expect(200);

      expect(response.body.status).toBe('CONFIRMED');

      const history = await prisma.vendorOrderStatusHistory.findFirst({
        where: { vendorOrderId },
        orderBy: { createdAt: 'desc' },
      });
      expect(history?.changedBy).toBe(admin.id);
    });

    it('returns 404 for a nonexistent VendorOrder id when accessed as ADMIN (guard bypasses existence check)', async () => {
      const admin = await createAdmin('StatusAdminNotFound');

      await request(app.getHttpServer())
        .patch(`/api/vendor-orders/${randomUUID()}/status`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ status: 'CONFIRMED' })
        .expect(404);
    });

    it('derives MasterOrder to PARTIALLY_FULFILLED when only one of two vendors has delivered, leaving the other VendorOrder untouched', async () => {
      const { fixtureA, fixtureB, order } =
        await checkoutMultiVendorAsNewCustomer('PartialFulfillmentUser');

      const listA = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixtureA.owner.accessToken}`)
        .expect(200);
      const vendorOrderAId = listA.body[0].id;

      for (const status of [
        'CONFIRMED',
        'PROCESSING',
        'READY_TO_SHIP',
        'SHIPPED',
        'DELIVERED',
      ]) {
        await request(app.getHttpServer())
          .patch(`/api/vendor-orders/${vendorOrderAId}/status`)
          .set('Authorization', `Bearer ${fixtureA.owner.accessToken}`)
          .send({ status })
          .expect(200);
      }

      const masterOrder = await prisma.masterOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(masterOrder.status).toBe('PARTIALLY_FULFILLED');

      // Vendor B's own VendorOrder must remain completely untouched by
      // Vendor A's transitions.
      const listB = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixtureB.owner.accessToken}`)
        .expect(200);
      expect(listB.body[0].status).toBe('PENDING');

      // Completing Vendor B's side too must derive the MasterOrder all
      // the way to FULFILLED.
      const vendorOrderBId = listB.body[0].id;
      for (const status of [
        'CONFIRMED',
        'PROCESSING',
        'READY_TO_SHIP',
        'SHIPPED',
        'DELIVERED',
      ]) {
        await request(app.getHttpServer())
          .patch(`/api/vendor-orders/${vendorOrderBId}/status`)
          .set('Authorization', `Bearer ${fixtureB.owner.accessToken}`)
          .send({ status })
          .expect(200);
      }

      const finalMasterOrder = await prisma.masterOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(finalMasterOrder.status).toBe('FULFILLED');
    });

    describe('Concurrency', () => {
      it('lets exactly one of two concurrent status-update requests against the same VendorOrder succeed', async () => {
        const { fixture } = await checkoutAsNewCustomer(
          'StatusConcurrencyUser',
        );
        const listResponse = await request(app.getHttpServer())
          .get('/api/vendor-orders')
          .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
          .expect(200);
        const vendorOrderId = listResponse.body[0].id;

        const [responseA, responseB] = await Promise.all([
          request(app.getHttpServer())
            .patch(`/api/vendor-orders/${vendorOrderId}/status`)
            .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
            .send({ status: 'CONFIRMED' }),
          request(app.getHttpServer())
            .patch(`/api/vendor-orders/${vendorOrderId}/status`)
            .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
            .send({ status: 'CONFIRMED' }),
        ]);

        const statuses = [responseA.status, responseB.status].sort(
          (a, b) => a - b,
        );
        expect(statuses).toEqual([200, 409]);

        const history = await prisma.vendorOrderStatusHistory.findMany({
          where: { vendorOrderId, toStatus: 'CONFIRMED' },
        });
        expect(history).toHaveLength(1);

        const finalVendorOrder = await prisma.vendorOrder.findUniqueOrThrow({
          where: { id: vendorOrderId },
        });
        expect(finalVendorOrder.status).toBe('CONFIRMED');
      });
    });
  });
});
