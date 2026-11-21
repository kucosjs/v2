import { PrismaClient } from '@prisma/client';
import { gunStubAdapter, withGun } from 'prisma-gun';

const db = withGun(new PrismaClient({ adapter: gunStubAdapter }), {
  peers: process.env.DATABASE_URL.split(',').map((s) => s.trim()),
});

await db.user.create({ data: { email: 'ada@example.com', name: 'Ada' } });
await db.user.findMany({ where: { name: { contains: 'A' } }, orderBy: { email: 'asc' }, take: 10 });
db.$gun.gun.get('whatever'); // raw Gun escape hatch
