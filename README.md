# Multi-Vendor E-Commerce API

Backend API for a production-oriented multi-vendor e-commerce platform.

Built with NestJS, TypeScript, PostgreSQL, Prisma, Redis, and BullMQ.

---

## Tech Stack

- Node.js 22 LTS
- NestJS
- TypeScript
- PostgreSQL
- Prisma ORM
- Redis
- BullMQ
- Docker Compose
- Jest
- Supertest
- Swagger / OpenAPI

---

## Architecture Foundation

The current backend foundation includes:

- Environment configuration and validation
- PostgreSQL database integration
- Prisma ORM
- Redis integration
- BullMQ infrastructure
- Application health checks
- Global request validation
- Swagger API documentation
- Unit testing
- End-to-end testing
- Dockerized PostgreSQL and Redis
- Node.js version management with `.nvmrc`

---

## Project Structure

```text
src/
├── config/
│   └── env.validation.ts
├── health/
│   ├── health.controller.ts
│   ├── health.module.ts
│   ├── health.service.ts
│   └── health.service.spec.ts
├── prisma/
│   ├── prisma.module.ts
│   └── prisma.service.ts
├── redis/
│   ├── redis.module.ts
│   └── redis.service.ts
├── app.module.ts
└── main.ts

prisma/
└── schema/

test/
├── app.e2e-spec.ts
└── jest-e2e.json

docs/
├── database/
└── plans/
````

---

## Requirements

* Node.js 22 LTS
* npm
* Docker
* Docker Compose

The project uses `.nvmrc` to define the expected Node.js major version.

```bash
nvm use
```

---

## Installation

Clone the repository and install dependencies:

```bash
npm install
```

Create the local environment file:

```bash
cp .env.example .env
```

Update `.env` with the required local configuration.

---

## Local Infrastructure

PostgreSQL and Redis run through Docker Compose.

Start the infrastructure:

```bash
docker compose up -d
```

Check service status:

```bash
docker compose ps
```

Expected services:

```text
postgres
redis
```

PostgreSQL is exposed locally on:

```text
localhost:5433
```

Redis is exposed locally on:

```text
localhost:6379
```

Stop the infrastructure:

```bash
docker compose down
```

---

## Database

Generate the Prisma client:

```bash
npx prisma generate
```

Prisma schema files are located under:

```text
prisma/schema/
```

Database documentation is available under:

```text
docs/database/
```

---

## Running the Application

Development mode:

```bash
npm run start:dev
```

Production build:

```bash
npm run build
```

Production mode:

```bash
npm run start:prod
```

---

## API

The application uses the global API prefix:

```text
/api
```

### Health Check

```http
GET /api/health
```

Example response:

```json
{
  "status": "ok",
  "services": {
    "database": "up",
    "redis": "up"
  },
  "timestamp": "2026-08-17T00:00:00.000Z"
}
```

---

## API Documentation

Swagger documentation is available during local development at:

```text
http://localhost:3000/api/docs
```

---

## Testing

### Unit tests

```bash
npm test -- --runInBand
```

### E2E tests

```bash
npm run test:e2e -- --runInBand
```

### Coverage

```bash
npm run test:cov
```

The E2E test suite uses Node's VM modules support through the configured test script.

---

## Code Quality

Build the project:

```bash
npm run build
```

Check formatting issues:

```bash
git diff --check
```

Run linting:

```bash
npm run lint
```

---

## Security

Check dependency vulnerabilities:

```bash
npm audit
```

Dependency vulnerabilities should be reviewed before applying forced upgrades.

---

## Environment Variables

Example environment configuration is available in:

```text
.env.example
```

Required configuration includes:

* Application port
* PostgreSQL connection
* Redis connection
* JWT access secret
* JWT refresh secret
* Token expiration settings

Never commit the actual `.env` file or production secrets.

---

## Documentation

### Database Documentation

Detailed database domain documentation is available under:

```text
docs/database/
```

Current domains include:

* Identity & Access
* Vendor & Shop
* Catalog
* Cart
* Order
* Payment & Refund
* Promotion
* Review
* Notification
* Wallet & Commission
* Audit

### Implementation Plan

The database implementation plan is available at:

```text
docs/plans/database-implementation-plan.md
```

---

## Development Principles

The project is being developed incrementally with emphasis on:

* Modular NestJS architecture
* Strong TypeScript typing
* Clear separation of concerns
* Database integrity
* Transaction-safe business operations
* Redis-backed infrastructure
* Asynchronous processing with BullMQ
* Automated testing
* Environment validation
* Production-oriented deployment practices

````