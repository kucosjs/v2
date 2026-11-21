# Prisma Gun

Prisma Gun connects Prisma Client model calls to Gun peers. After the one-time client setup, supported queries such as `db.user.create()` and `db.user.findMany()` work through the same Prisma model API. Gun stores the records directly.

## Use it in another Prisma project

Copy `prisma-gun/` into your project and install it as a local dependency with `npm install ./prisma-gun`. Start the included relay with `node prisma-gun/relay.js`, or connect to your own private Gun peer.

```dotenv
DATABASE_URL=http://localhost:8765/gun
```

Initialize your generated Prisma Client once with `withGun`.

```js
import { PrismaClient } from './generated/prisma/client.js';
import { gunStubAdapter, withGun } from 'prisma-gun';

const peers = process.env.DATABASE_URL.split(',').map((peer) => peer.trim());

export const db = withGun(new PrismaClient({ adapter: gunStubAdapter }), {
  peers,
  name: 'my-app',
});
```

Use your project's generated client import path and load your environment before this module runs. The supplied stub matches the Prisma client's `sqlite` provider metadata. Model operations go to Gun, and Gun initializes its own records on first use.

`withGun` supports basic CRUD, count, scalar filters, sorting, and offset pagination on models with a single `id`. Supply required fields explicitly.

For relational queries and transactions, `prisma-gun/records` exposes `withGunRecords`. Supply your own model keys, defaults, and relation metadata. Use one writer per record namespace.
