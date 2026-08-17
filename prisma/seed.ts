import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * Phase 1 (Identity & Access) seed data.
 *
 * Per docs/database/identity-access.md §"Initial Roles" and the
 * implementation plan's Phase 1 note: seed only the three initial platform
 * roles. Permission seed data is explicitly deferred to the authorization
 * implementation phase.
 */
async function main() {
  const roles = ['ADMIN', 'VENDOR', 'CUSTOMER'] as const;

  for (const name of roles) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    console.log(`Seeded role: ${role.name} (${role.id})`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
