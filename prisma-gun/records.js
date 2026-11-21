import { AsyncLocalStorage } from 'node:async_hooks';
import { createQueries } from './record-queries.js';
import { openRecordsPeer } from './records-peer.js';

export const gunRecordsStubAdapter = {
  // This identifies the generated Prisma Client. Gun operations bypass the SQL engine.
  provider: 'sqlite',
  adapterName: 'prisma-gun/records',
  async connect() {
    throw new Error('Gun record storage does not execute SQL.');
  },
};

const mutations = new Set([
  'create',
  'createMany',
  'update',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

export function withGunRecords(prisma, { peer, name = 'app', models }) {
  const execute = createQueries(models);
  const transaction = new AsyncLocalStorage();
  let queue = Promise.resolve();
  let storage;
  let state;
  let writeFailure;

  async function load() {
    if (state) return;
    storage ??= await openRecordsPeer(peer, name);
    try {
      const records = await storage.read();
      if (records !== null && Object.keys(models).some((model) => !Array.isArray(records[model]))) {
        throw new Error('Gun relay returned incompatible records.');
      }
      state = records ?? Object.fromEntries(Object.keys(models).map((model) => [model, []]));
    } catch (error) {
      storage.close();
      storage = undefined;
      throw error;
    }
  }

  function exclusive(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  function transact(operation) {
    if (transaction.getStore()) return operation();
    return exclusive(async () => {
      if (writeFailure) throw writeFailure;
      await load();
      const active = { records: structuredClone(state), changed: false };
      const result = await transaction.run(active, operation);
      if (active.changed) {
        try {
          await storage.write(active.records);
          state = active.records;
        } catch (error) {
          // A write may have reached the relay even if the acknowledgement was lost.
          writeFailure = new Error(
            'Gun storage could not confirm the write. Restart the application before accepting more changes.',
            { cause: error },
          );
          throw writeFailure;
        }
      }
      return result;
    });
  }

  function dispatch(model, operation, args) {
    const mutation = mutations.has(operation);
    const active = transaction.getStore();
    if (active) {
      const result = execute(active.records, model, operation, args);
      if (mutation) active.changed = true;
      return result;
    }
    if (mutation) return transact(() => dispatch(model, operation, args));
    return exclusive(async () => {
      if (writeFailure) throw writeFailure;
      await load();
      return execute(state, model, operation, args);
    });
  }

  const client = prisma.$extends({
    name: 'prisma-gun/records',
    client: {
      $connect: () => exclusive(load),
      $disconnect: () =>
        exclusive(() => {
          storage?.close();
          storage = state = writeFailure = undefined;
        }),
      $transaction: (operations) =>
        transact(async () => {
          if (typeof operations === 'function') return operations(client);
          const results = [];
          for (const operation of operations) results.push(await operation);
          return results;
        }),
    },
    query: {
      $allModels: {
        $allOperations: async ({ model, operation, args }) => dispatch(model, operation, args),
      },
    },
  });
  return client;
}
