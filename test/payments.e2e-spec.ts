import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Phase 15 — Payment / PaymentAttempt / Webhook / Refund foundation.
 * Orders are produced via the real checkout flow (Phase 13), exactly
 * like Phase 14's e2e suite.
 */
describe('Payments API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const registeredEmails: string[] = [];
  const password = 'StrongPassw0rd!';

  const uniqueEmail = () => `payments-e2e-${randomUUID()}@example.com`;
  const uniqueSlug = (prefix: string) => `${prefix}-${randomUUID()}`;
  const uniqueEventId = () => `evt-${randomUUID()}`;

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
        name: 'Payments Test Category',
        slug: uniqueSlug('payments-cat'),
      },
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
        const payments = await prisma.payment.findMany({
          where: { masterOrderId: { in: masterOrderIds } },
          select: { id: true },
        });
        const paymentIds = payments.map((p) => p.id);

        await prisma.refund.deleteMany({
          where: { paymentId: { in: paymentIds } },
        });
        await prisma.paymentAttempt.deleteMany({
          where: { paymentId: { in: paymentIds } },
        });
        await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });

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

  describe('POST /api/payments', () => {
    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/api/payments')
        .send({ masterOrderId: randomUUID(), method: 'CASH_ON_DELIVERY' })
        .expect(401);
    });

    it('creates a payment with amount/currency derived from the order, and a first PaymentAttempt', async () => {
      const { customer, order } =
        await checkoutAsNewCustomer('CreatePaymentUser');

      const response = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CASH_ON_DELIVERY' })
        .expect(201);

      expect(response.body.masterOrderId).toBe(order.id);
      expect(response.body.status).toBe('PENDING');
      expect(response.body.currency).toBe('BDT');
      expect(response.body.amount).toBe(order.totalAmount);
      expect(response.body.attempts).toHaveLength(1);
      expect(response.body.attempts[0].attemptNumber).toBe(1);
      expect(response.body.attempts[0].status).toBe('INITIATED');
      expect(response.body.attempts[0].providerReference).toBeTruthy();
    });

    it('rejects (400) client-supplied amount/currency/status — unknown properties rejected by the global whitelist', async () => {
      const { customer, order } =
        await checkoutAsNewCustomer('SpoofPaymentUser');

      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({
          masterOrderId: order.id,
          method: 'CASH_ON_DELIVERY',
          amount: '1.00',
          currency: 'USD',
          status: 'PAID',
        })
        .expect(400);
    });

    it('rejects (400) an invalid payload (missing method)', async () => {
      const { customer, order } = await checkoutAsNewCustomer(
        'InvalidPaymentDtoUser',
      );

      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id })
        .expect(400);
    });

    it("rejects (403) User A creating a payment for User B's order", async () => {
      const { order } = await checkoutAsNewCustomer('PaymentOwnerA');
      const userB = await registerAndLogin('PaymentAttackerB');

      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CASH_ON_DELIVERY' })
        .expect(403);
    });

    it('rejects (403) a nonexistent masterOrderId', async () => {
      const user = await registerAndLogin('NonexistentOrderPaymentUser');

      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ masterOrderId: randomUUID(), method: 'CASH_ON_DELIVERY' })
        .expect(403);
    });

    it('rejects (409) a second payment for an order that already has one', async () => {
      const { customer, order } = await checkoutAsNewCustomer(
        'DuplicatePaymentUser',
      );

      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CASH_ON_DELIVERY' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CARD' })
        .expect(409);
    });
  });

  describe('GET /api/payments/:paymentId', () => {
    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(`/api/payments/${randomUUID()}`)
        .expect(401);
    });

    it("returns the caller's own payment", async () => {
      const { customer, order } =
        await checkoutAsNewCustomer('ViewPaymentUser');
      const created = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CASH_ON_DELIVERY' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/api/payments/${created.body.id}`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(created.body.id);
    });

    it("forbids (403) User A from viewing User B's payment", async () => {
      const { customer, order } = await checkoutAsNewCustomer('ViewOwnerA');
      const created = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CASH_ON_DELIVERY' })
        .expect(201);
      const userB = await registerAndLogin('ViewAttackerB');

      const response = await request(app.getHttpServer())
        .get(`/api/payments/${created.body.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(403);

      const serialized = JSON.stringify(response.body).toLowerCase();
      expect(serialized).not.toMatch(/prisma|postgres|sql/);
    });

    it('allows an ADMIN to view any payment', async () => {
      const { customer, order } = await checkoutAsNewCustomer('AdminViewOwner');
      const created = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CASH_ON_DELIVERY' })
        .expect(201);
      const admin = await createAdmin('PaymentViewAdmin');

      const response = await request(app.getHttpServer())
        .get(`/api/payments/${created.body.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(created.body.id);
    });
  });

  describe('POST /api/payments/webhook', () => {
    it('rejects (400) an invalid payload', async () => {
      await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .send({ provider: 'MANUAL' })
        .expect(400);
    });

    it('processes payment.succeeded: marks the attempt/payment PAID and syncs MasterOrder.paymentStatus', async () => {
      const { customer, order } =
        await checkoutAsNewCustomer('WebhookSuccessUser');
      const created = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CASH_ON_DELIVERY' })
        .expect(201);
      const providerReference = created.body.attempts[0].providerReference;

      const response = await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .send({
          provider: 'MANUAL',
          eventId: uniqueEventId(),
          eventType: 'payment.succeeded',
          providerReference,
        })
        .expect(200);

      expect(response.body).toEqual({ status: 'processed' });

      const payment = await request(app.getHttpServer())
        .get(`/api/payments/${created.body.id}`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      expect(payment.body.status).toBe('PAID');
      expect(payment.body.paidAmount).toBe(order.totalAmount);
      expect(payment.body.attempts[0].status).toBe('SUCCEEDED');

      const masterOrder = await request(app.getHttpServer())
        .get(`/api/orders/${order.id}`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      expect(masterOrder.body.paymentStatus).toBe('PAID');
    });

    it('processes payment.failed: marks the attempt/payment FAILED and syncs MasterOrder.paymentStatus', async () => {
      const { customer, order } =
        await checkoutAsNewCustomer('WebhookFailUser');
      const created = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CASH_ON_DELIVERY' })
        .expect(201);
      const providerReference = created.body.attempts[0].providerReference;

      await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .send({
          provider: 'MANUAL',
          eventId: uniqueEventId(),
          eventType: 'payment.failed',
          providerReference,
        })
        .expect(200);

      const payment = await request(app.getHttpServer())
        .get(`/api/payments/${created.body.id}`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      expect(payment.body.status).toBe('FAILED');

      const masterOrder = await request(app.getHttpServer())
        .get(`/api/orders/${order.id}`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      expect(masterOrder.body.paymentStatus).toBe('FAILED');
    });

    it('a replayed (duplicate) event is a no-op and does not double-apply the state change', async () => {
      const { customer, order } =
        await checkoutAsNewCustomer('WebhookReplayUser');
      const created = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CASH_ON_DELIVERY' })
        .expect(201);
      const providerReference = created.body.attempts[0].providerReference;
      const eventId = uniqueEventId();
      const eventPayload = {
        provider: 'MANUAL',
        eventId,
        eventType: 'payment.succeeded',
        providerReference,
      };

      const first = await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .send(eventPayload)
        .expect(200);
      expect(first.body).toEqual({ status: 'processed' });

      const replay = await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .send(eventPayload)
        .expect(200);
      expect(replay.body).toEqual({ status: 'duplicate' });

      const payment = await request(app.getHttpServer())
        .get(`/api/payments/${created.body.id}`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      // paidAmount must equal the order total exactly once, not doubled.
      expect(payment.body.paidAmount).toBe(order.totalAmount);
    });

    it('an unrecognized eventType is recorded as ignored and does not change any state', async () => {
      const { customer, order } =
        await checkoutAsNewCustomer('WebhookIgnoredUser');
      const created = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CASH_ON_DELIVERY' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .send({
          provider: 'MANUAL',
          eventId: uniqueEventId(),
          eventType: 'charge.dispute.created',
          providerReference: created.body.attempts[0].providerReference,
        })
        .expect(200);
      expect(response.body).toEqual({ status: 'ignored' });

      const payment = await request(app.getHttpServer())
        .get(`/api/payments/${created.body.id}`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      expect(payment.body.status).toBe('PENDING');
    });

    it('an event with no correlating providerReference is unmatched and never leaks internal identifiers', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .send({
          provider: 'MANUAL',
          eventId: uniqueEventId(),
          eventType: 'payment.succeeded',
          providerReference: 'ref_does_not_exist',
        })
        .expect(200);

      expect(response.body).toEqual({ status: 'unmatched' });
      const serialized = JSON.stringify(response.body).toLowerCase();
      expect(serialized).not.toMatch(/prisma|postgres|sql/);
    });
  });

  describe('POST /api/payments/:paymentId/retry', () => {
    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(`/api/payments/${randomUUID()}/retry`)
        .expect(401);
    });

    it('rejects (409) retrying a payment that is not FAILED', async () => {
      const { customer, order } =
        await checkoutAsNewCustomer('RetryNotFailedUser');
      const created = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CASH_ON_DELIVERY' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/payments/${created.body.id}/retry`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(409);
    });

    it('creates a second PaymentAttempt after a FAILED payment, preserving the first attempt', async () => {
      const { customer, order } =
        await checkoutAsNewCustomer('RetrySuccessUser');
      const created = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CASH_ON_DELIVERY' })
        .expect(201);
      const firstProviderReference = created.body.attempts[0].providerReference;

      await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .send({
          provider: 'MANUAL',
          eventId: uniqueEventId(),
          eventType: 'payment.failed',
          providerReference: firstProviderReference,
        })
        .expect(200);

      const retried = await request(app.getHttpServer())
        .post(`/api/payments/${created.body.id}/retry`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(201);

      expect(retried.body.status).toBe('PENDING');
      expect(retried.body.attempts).toHaveLength(2);
      expect(retried.body.attempts[0].attemptNumber).toBe(1);
      expect(retried.body.attempts[0].status).toBe('FAILED');
      expect(retried.body.attempts[1].attemptNumber).toBe(2);
      expect(retried.body.attempts[1].status).toBe('INITIATED');
      expect(retried.body.attempts[1].providerReference).not.toBe(
        firstProviderReference,
      );
    });

    it("forbids (403) User A retrying User B's payment", async () => {
      const { customer, order } = await checkoutAsNewCustomer('RetryOwnerA');
      const created = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CASH_ON_DELIVERY' })
        .expect(201);
      const userB = await registerAndLogin('RetryAttackerB');

      await request(app.getHttpServer())
        .post(`/api/payments/${created.body.id}/retry`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(403);
    });
  });

  describe('POST /api/payments/:paymentId/refunds', () => {
    const paidPaymentFixture = async (namePrefix: string) => {
      const { customer, order } = await checkoutAsNewCustomer(namePrefix);
      const created = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ masterOrderId: order.id, method: 'CASH_ON_DELIVERY' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .send({
          provider: 'MANUAL',
          eventId: uniqueEventId(),
          eventType: 'payment.succeeded',
          providerReference: created.body.attempts[0].providerReference,
        })
        .expect(200);

      return { customer, order, paymentId: created.body.id };
    };

    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(`/api/payments/${randomUUID()}/refunds`)
        .send({ amount: '100.00', reason: 'CUSTOMER_RETURN' })
        .expect(401);
    });

    it('rejects (403) a non-ADMIN caller, including the payment owner', async () => {
      const { customer, paymentId } =
        await paidPaymentFixture('RefundNonAdminUser');

      await request(app.getHttpServer())
        .post(`/api/payments/${paymentId}/refunds`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ amount: '100.00', reason: 'CUSTOMER_RETURN' })
        .expect(403);
    });

    it('rejects (400) an invalid (zero) refund amount', async () => {
      const { paymentId } = await paidPaymentFixture('RefundInvalidAmountUser');
      const admin = await createAdmin('RefundInvalidAmountAdmin');

      await request(app.getHttpServer())
        .post(`/api/payments/${paymentId}/refunds`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ amount: '0', reason: 'CUSTOMER_RETURN' })
        .expect(400);
    });

    it('rejects (409) a refund amount exceeding the refundable balance', async () => {
      const { order, paymentId } = await paidPaymentFixture(
        'RefundExcessiveUser',
      );
      const admin = await createAdmin('RefundExcessiveAdmin');
      const excessive = (Number(order.totalAmount) + 100).toFixed(2);

      await request(app.getHttpServer())
        .post(`/api/payments/${paymentId}/refunds`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ amount: excessive, reason: 'CUSTOMER_RETURN' })
        .expect(409);
    });

    it('creates a partial refund and, on refund.succeeded, marks the payment PARTIALLY_REFUNDED and syncs MasterOrder.paymentStatus', async () => {
      const { customer, order, paymentId } =
        await paidPaymentFixture('RefundPartialUser');
      const admin = await createAdmin('RefundPartialAdmin');
      const partialAmount = (Number(order.totalAmount) / 2).toFixed(2);

      const refundResponse = await request(app.getHttpServer())
        .post(`/api/payments/${paymentId}/refunds`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ amount: partialAmount, reason: 'CUSTOMER_RETURN' })
        .expect(201);

      expect(refundResponse.body.status).toBe('PENDING');
      expect(refundResponse.body.amount).toBe(`${partialAmount}`);
      expect(refundResponse.body.currency).toBe('BDT');

      await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .send({
          provider: 'MANUAL',
          eventId: uniqueEventId(),
          eventType: 'refund.succeeded',
          providerReference: refundResponse.body.providerReference,
        })
        .expect(200);

      const payment = await request(app.getHttpServer())
        .get(`/api/payments/${paymentId}`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      expect(payment.body.status).toBe('PARTIALLY_REFUNDED');
      expect(payment.body.refundedAmount).toBe(`${partialAmount}`);

      const masterOrder = await request(app.getHttpServer())
        .get(`/api/orders/${order.id}`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      expect(masterOrder.body.paymentStatus).toBe('PARTIALLY_REFUNDED');
    });

    it('a second refund cannot push cumulative refunds past paidAmount', async () => {
      const { order, paymentId } = await paidPaymentFixture(
        'RefundCumulativeUser',
      );
      const admin = await createAdmin('RefundCumulativeAdmin');
      const total = Number(order.totalAmount);

      const firstRefund = await request(app.getHttpServer())
        .post(`/api/payments/${paymentId}/refunds`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ amount: (total - 100).toFixed(2), reason: 'CUSTOMER_RETURN' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/payments/webhook')
        .send({
          provider: 'MANUAL',
          eventId: uniqueEventId(),
          eventType: 'refund.succeeded',
          providerReference: firstRefund.body.providerReference,
        })
        .expect(200);

      // Only 100 remains refundable; requesting 200 must be rejected.
      await request(app.getHttpServer())
        .post(`/api/payments/${paymentId}/refunds`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ amount: '200.00', reason: 'CUSTOMER_RETURN' })
        .expect(409);
    });

    // ---------------------------------------------------------------
    // Concurrency proof (Phase 25 — M-1 fix,
    // docs/final-system-audit.md). Real PostgreSQL, real application
    // services, the real webhook endpoint — `Promise.all` fires two
    // genuinely simultaneous requests, the same technique already
    // established for concurrent checkout (Phase 18) and concurrent
    // inventory adjustment (Phase 21); no artificial sleep is used to
    // manufacture the race.
    // ---------------------------------------------------------------
    describe('Concurrency (Phase 25 — M-1 fix)', () => {
      it('accumulates two concurrent refund.succeeded settlements for the same Payment correctly — neither contribution is lost', async () => {
        const { customer, order, paymentId } = await paidPaymentFixture(
          'RefundConcurrencyUser',
        );
        const admin = await createAdmin('RefundConcurrencyAdmin');
        const total = Number(order.totalAmount);

        // Two independent, already-admin-approved refunds against the
        // same payment (30% and 20% of the total — both individually
        // well within the refundable balance, summing to 50%). Created
        // sequentially (refund *creation* is not what M-1 is about —
        // see this phase's final report for why that is a separate,
        // out-of-scope observation); it is their *settlement* that must
        // race.
        const amountA = (total * 0.3).toFixed(2);
        const amountB = (total * 0.2).toFixed(2);

        const refundA = await request(app.getHttpServer())
          .post(`/api/payments/${paymentId}/refunds`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .send({ amount: amountA, reason: 'CUSTOMER_RETURN' })
          .expect(201);

        const refundB = await request(app.getHttpServer())
          .post(`/api/payments/${paymentId}/refunds`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .send({ amount: amountB, reason: 'CUSTOMER_RETURN' })
          .expect(201);

        // The actual race M-1 describes: both refunds' webhook
        // settlements arrive at genuinely the same time.
        const [responseA, responseB] = await Promise.all([
          request(app.getHttpServer()).post('/api/payments/webhook').send({
            provider: 'MANUAL',
            eventId: uniqueEventId(),
            eventType: 'refund.succeeded',
            providerReference: refundA.body.providerReference,
          }),
          request(app.getHttpServer()).post('/api/payments/webhook').send({
            provider: 'MANUAL',
            eventId: uniqueEventId(),
            eventType: 'refund.succeeded',
            providerReference: refundB.body.providerReference,
          }),
        ]);

        expect(responseA.status).toBe(200);
        expect(responseB.status).toBe(200);
        expect(responseA.body).toEqual({ status: 'processed' });
        expect(responseB.body).toEqual({ status: 'processed' });

        const payment = await request(app.getHttpServer())
          .get(`/api/payments/${paymentId}`)
          .set('Authorization', `Bearer ${customer.accessToken}`)
          .expect(200);

        const expectedRefunded = (Number(amountA) + Number(amountB)).toFixed(2);
        // The core M-1 proof: both concurrent contributions are
        // reflected in the final cumulative amount — neither commit
        // overwrote the other the way the pre-fix read-then-absolute-
        // set implementation would have allowed.
        expect(payment.body.refundedAmount).toBe(expectedRefunded);
        expect(payment.body.status).toBe('PARTIALLY_REFUNDED');

        const refundAResult = payment.body.refunds.find(
          (r: { id: string }) => r.id === refundA.body.id,
        );
        const refundBResult = payment.body.refunds.find(
          (r: { id: string }) => r.id === refundB.body.id,
        );
        expect(refundAResult.status).toBe('SUCCEEDED');
        expect(refundBResult.status).toBe('SUCCEEDED');

        const masterOrder = await request(app.getHttpServer())
          .get(`/api/orders/${order.id}`)
          .set('Authorization', `Bearer ${customer.accessToken}`)
          .expect(200);
        expect(masterOrder.body.paymentStatus).toBe('PARTIALLY_REFUNDED');
      });

      it('two concurrent webhook deliveries reporting the SAME refund (different eventIds, e.g. a non-conforming gateway retry) apply the financial effect exactly once', async () => {
        const { customer, paymentId } = await paidPaymentFixture(
          'RefundReplayRaceUser',
        );
        const admin = await createAdmin('RefundReplayRaceAdmin');

        const refund = await request(app.getHttpServer())
          .post(`/api/payments/${paymentId}/refunds`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .send({ amount: '500.00', reason: 'CUSTOMER_RETURN' })
          .expect(201);

        const [responseA, responseB] = await Promise.all([
          request(app.getHttpServer()).post('/api/payments/webhook').send({
            provider: 'MANUAL',
            eventId: uniqueEventId(),
            eventType: 'refund.succeeded',
            providerReference: refund.body.providerReference,
          }),
          request(app.getHttpServer()).post('/api/payments/webhook').send({
            provider: 'MANUAL',
            eventId: uniqueEventId(),
            eventType: 'refund.succeeded',
            providerReference: refund.body.providerReference,
          }),
        ]);

        // Exactly one of the two concurrent deliveries actually applies
        // the financial effect via the atomic conditional `updateMany`
        // (the other affects 0 rows and is reported as a duplicate) —
        // proving the Phase 16 value-based idempotency layer holds
        // under genuine concurrency, not just sequential replay.
        const statuses = [responseA.body.status, responseB.body.status].sort();
        expect(statuses).toEqual(['duplicate', 'processed']);

        const payment = await request(app.getHttpServer())
          .get(`/api/payments/${paymentId}`)
          .set('Authorization', `Bearer ${customer.accessToken}`)
          .expect(200);

        // The financial effect was applied exactly once, not twice.
        expect(payment.body.refundedAmount).toBe('500.00');
        expect(payment.body.status).toBe('PARTIALLY_REFUNDED');
      });
    });
  });
});
