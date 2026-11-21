import Gun from "gun";
import { randomUUID } from "node:crypto";

const once = (ref, wait) => new Promise((resolve) => {
  let done = false;
  const finish = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
  const t = setTimeout(() => finish(undefined), wait + 500);
  ref.once(finish, { wait });
});

const put = (ref, val, wait) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("prisma-gun: put ack timeout")), wait + 500);
  ref.put(val, (ack) => { clearTimeout(t); ack.err ? reject(new Error(String(ack.err))) : resolve(); });
});

// function collect(setRef, wait) {
//   return new Promise((resolve) => {
//     const rows = new Map();
//     const m = setRef.map();            // keep the chain so off() works
//     let quiet, hard;
//     const finish = () => { clearTimeout(quiet); clearTimeout(hard); m.off(); resolve([...rows.values()]); };
//     const bump = (ms) => { clearTimeout(quiet); quiet = setTimeout(finish, ms); };
//     hard = setTimeout(finish, wait + 1000);
//     bump(wait);                        // first item may be slow
//     m.once((data, key) => {
//       if (data && typeof data.json === "string") { try { rows.set(key, JSON.parse(data.json)); } catch {} }
//       else rows.delete(key);
//       bump(250);
//     });
//   });
// }

// read a whole model set: map().once() + quiet window
function collect(setRef, wait) {
  return new Promise((resolve) => {
    const rows = new Map();
    let quiet, hard;
    const finish = () => { clearTimeout(quiet); clearTimeout(hard); setRef.map().off(); resolve([...rows.values()]); };
    const bump = () => { clearTimeout(quiet); quiet = setTimeout(finish, 250); };
    hard = setTimeout(finish, wait + 1000);
    setRef.map().once((data, key) => {
      if (data && typeof data.json === "string") { try { rows.set(key, JSON.parse(data.json)); } catch {} }
      else rows.delete(key);
      bump();
    });
    bump();
  });
}

const eq = (a, b) => a === b;

function matchField(v, cond) {
  if (cond === null || typeof cond !== "object" || cond instanceof Date)
    return eq(v, cond instanceof Date ? cond.toISOString() : cond);
  for (const [op, raw] of Object.entries(cond)) {
    const val = raw instanceof Date ? raw.toISOString() : raw;
    switch (op) {
      case "equals":     if (!eq(v, val)) return false; break;
      case "not":        if (eq(v, val)) return false; break;
      case "in":         if (!val.some((x) => eq(v, x))) return false; break;
      case "notIn":      if (val.some((x) => eq(v, x))) return false; break;
      case "contains":   if (!String(v ?? "").includes(val)) return false; break;
      case "startsWith": if (!String(v ?? "").startsWith(val)) return false; break;
      case "endsWith":   if (!String(v ?? "").endsWith(val)) return false; break;
      case "gt":         if (!(v > val)) return false; break;
      case "gte":        if (!(v >= val)) return false; break;
      case "lt":         if (!(v < val)) return false; break;
      case "lte":        if (!(v <= val)) return false; break;
      case "mode":       break;
      default: throw new Error(`prisma-gun: unsupported filter "${op}" (relation filters need include support)`);
    }
  }
  return true;
}

function matches(row, where = {}) {
  for (const [key, cond] of Object.entries(where)) {
    const list = Array.isArray(cond) ? cond : [cond];
    if (key === "AND") { if (!list.every((w) => matches(row, w))) return false; }
    else if (key === "OR") { if (!cond.some((w) => matches(row, w))) return false; }
    else if (key === "NOT") { if (list.some((w) => matches(row, w))) return false; }
    else if (!matchField(row[key], cond)) return false;
  }
  return true;
}

function applyQuery(rows, args = {}) {
  let out = rows.filter((r) => matches(r, args.where));
  if (args.orderBy) {
    const orders = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
    out.sort((a, b) => {
      for (const o of orders) for (const [f, dir] of Object.entries(o)) {
        if (a[f] < b[f]) return dir === "desc" ? 1 : -1;
        if (a[f] > b[f]) return dir === "desc" ? -1 : 1;
      }
      return 0;
    });
  }
  if (args.cursor) throw new Error("prisma-gun: cursor pagination not supported yet");
  if (args.distinct) {
    const fields = Array.isArray(args.distinct) ? args.distinct : [args.distinct];
    const seen = new Set();
    out = out.filter((r) => { const k = JSON.stringify(fields.map((f) => r[f])); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  if (args.skip) out = out.slice(args.skip);
  if (args.take != null) out = out.slice(0, Math.abs(args.take));
  if (args.include) throw new Error("prisma-gun: include (relations) not supported yet");
  if (args.select) out = out.map((r) => Object.fromEntries(Object.entries(args.select).filter(([, v]) => v).map(([k]) => [k, r[k]])));
  return out;
}

class GunStore {
  constructor({ peers, name = "app", gun, wait = 2000, id = () => randomUUID() } = {}) {
    this.gun = gun ?? Gun({ peers: peers ?? [], axe: false, multicast: false, stats: false });
    this.ns = this.gun.get("prisma-gun").get(name);
    this.wait = wait; this.id = id;
  }
  set(model) { return this.ns.get("rows").get(model); }
  ref(model, id) { return this.set(model).get(String(id)); }
  all(model) { return collect(this.set(model), this.wait); }
  async read(model, id) {
    const n = await once(this.ref(model, id), this.wait);
    return n && typeof n.json === "string" ? JSON.parse(n.json) : null;
  }
  async write(model, row) {
    await put(this.ref(model, row.id), { json: JSON.stringify(row), updatedAt: Date.now() }, this.wait);
    return row;
  }
  async remove(model, id) { await put(this.ref(model, id), null, this.wait); }

  async dispatch(model, op, args = {}) {
    switch (op) {
      case "findUnique": case "findUniqueOrThrow": case "findFirst": case "findFirstOrThrow": {
        let row = null;
        const w = args.where ?? {};
        if ("id" in w && (w.id === null || typeof w.id !== "object")) row = await this.read(model, w.id);
        if (row && !matches(row, w)) row = null;
        if (!row) row = applyQuery(await this.all(model), { ...args, take: 1 })[0] ?? null;
        if (!row && op.endsWith("OrThrow")) throw new Error(`prisma-gun: ${model} not found`);
        return row ? applyQuery([row], { select: args.select, include: args.include })[0] : null;
      }
      case "findMany": return applyQuery(await this.all(model), args);
      case "count": return (await this.all(model)).filter((r) => matches(r, args.where)).length;
      case "create": {
        const row = { id: this.id(model), ...args.data };
        await this.write(model, row);
        return applyQuery([row], args)[0];
      }
      case "createMany": {
        const data = Array.isArray(args.data) ? args.data : [args.data];
        for (const d of data) await this.write(model, { id: this.id(model), ...d });
        return { count: data.length };
      }
      case "update": {
        const current = await this.dispatch(model, "findUnique", { where: args.where });
        if (!current) throw new Error(`prisma-gun: ${model} not found for update`);
        const row = { ...current, ...args.data };
        await this.write(model, row);
        return applyQuery([row], args)[0];
      }
      case "updateMany": {
        const rows = (await this.all(model)).filter((r) => matches(r, args.where));
        for (const r of rows) await this.write(model, { ...r, ...args.data });
        return { count: rows.length };
      }
      case "upsert": {
        const current = await this.dispatch(model, "findUnique", { where: args.where });
        const tail = { select: args.select, include: args.include };
        return current
          ? this.dispatch(model, "update", { where: args.where, data: args.update, ...tail })
          : this.dispatch(model, "create", { data: { ...args.where, ...args.create }, ...tail });
      }
      case "delete": {
        const current = await this.dispatch(model, "findUnique", { where: args.where });
        if (!current) throw new Error(`prisma-gun: ${model} not found for delete`);
        await this.remove(model, current.id);
        return applyQuery([current], args)[0];
      }
      case "deleteMany": {
        const rows = (await this.all(model)).filter((r) => matches(r, args.where));
        for (const r of rows) await this.remove(model, r.id);
        return { count: rows.length };
      }
      default: throw new Error(`prisma-gun: operation "${op}" not supported yet`);
    }
  }
}

// Exists only so `new PrismaClient({ adapter })` constructs on v7.
// If any of these ever runs, something bypassed the extension: fail loudly.
export const gunStubAdapter = {
  provider: "sqlite", // dialect tag for codegen; no SQL is ever executed
  adapterName: "prisma-gun/stub",
  async queryRaw() { throw new Error("prisma-gun: $queryRaw unavailable in Gun mode (no SQL engine)"); },
  async executeRaw() { throw new Error("prisma-gun: $executeRaw unavailable in Gun mode"); },
  async executeScript() { throw new Error("prisma-gun: migrations don't apply; Gun is schemaless"); },
  async startTransaction() { throw new Error("prisma-gun: interactive $transaction not supported in Gun mode"); },
  getConnectionInfo() { return { supportsRelationJoins: false }; },
  async connect() { return this; },
  async dispose() {},
};

export function withGun(prisma, opts) {
  const store = new GunStore(opts);
  return prisma.$extends({
    name: "prisma-gun",
    client: { $gun: store },
    query: {
      $allModels: {
        // never calls query(): the request stops here, engine untouched
        async $allOperations({ model, operation, args }) {
          return store.dispatch(model, operation, args);
        },
      },
    },
  });
}


// import { PrismaClient as BaseClient } from "@prisma/client";
//
// export class PrismaGun {
//   provider = "sqlite"; // dialect tag for construction; no SQL ever runs
//   adapterName = "prisma-gun";
//   constructor(opts = {}) { this.opts = opts; }
//   async queryRaw() { throw new Error("prisma-gun: $queryRaw unavailable in Gun mode"); }
//   async executeRaw() { throw new Error("prisma-gun: $executeRaw unavailable in Gun mode"); }
//   async executeScript() { throw new Error("prisma-gun: migrations don't apply; Gun is schemaless"); }
//   async startTransaction() { throw new Error("prisma-gun: interactive $transaction not supported"); }
//   getConnectionInfo() { return { supportsRelationJoins: false }; }
//   async connect() { return this; }
//   async dispose() {}
// }
//
// export const gunify = (Base) => class extends Base {
//   constructor(options = {}) {
//     super(options);
//     if (options.adapter instanceof PrismaGun) {
//       return withGun(this, options.adapter.opts); // ctor returns the extended client
//     }
//   }
// };
//
// export class PrismaClient extends gunify(BaseClient) {}
