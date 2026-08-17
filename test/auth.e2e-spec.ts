import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Auth API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const registeredEmails: string[] = [];

  const uniqueEmail = () => `auth-e2e-${randomUUID()}@example.com`;

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
  });

  afterAll(async () => {
    if (registeredEmails.length > 0) {
      await prisma.user.deleteMany({
        where: { email: { in: registeredEmails } },
      });
    }

    await app.close();
  });

  it('POST /api/auth/register creates a user and hides sensitive fields', async () => {
    const email = uniqueEmail();
    registeredEmails.push(email);

    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email,
        password: 'StrongPassw0rd!',
        firstName: 'Jane',
        lastName: 'Doe',
      })
      .expect(201);

    expect(response.body.email).toBe(email);
    expect(response.body.firstName).toBe('Jane');
    expect(response.body.status).toBe('ACTIVE');
    expect(response.body).not.toHaveProperty('password');
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('POST /api/auth/register rejects a duplicate email with 409 Conflict', async () => {
    const email = uniqueEmail();
    registeredEmails.push(email);

    const payload = {
      email,
      password: 'StrongPassw0rd!',
      firstName: 'Jane',
    };

    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(payload)
      .expect(201);

    const duplicateResponse = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(payload)
      .expect(409);

    expect(duplicateResponse.body).not.toHaveProperty('passwordHash');
  });

  it('POST /api/auth/register rejects an invalid payload with 400 Bad Request', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'not-an-email',
        password: 'short',
      })
      .expect(400);
  });
});
