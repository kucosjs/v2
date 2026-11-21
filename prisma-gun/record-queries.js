function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

const persisted = (value) => (value instanceof Date ? value.toISOString() : value);

function compare(value, condition) {
  if (condition instanceof Date || condition === null || typeof condition !== 'object') {
    return value === persisted(condition);
  }
  return Object.entries(condition).every(([operator, operand]) => {
    const target = persisted(operand);
    switch (operator) {
      case 'equals':
        return value === target;
      case 'not':
        return !compare(value, operand);
      case 'in':
        return operand.some((item) => compare(value, item));
      case 'notIn':
        return !operand.some((item) => compare(value, item));
      case 'lt':
        return value < target;
      case 'lte':
        return value <= target;
      case 'gt':
        return value > target;
      case 'gte':
        return value >= target;
      default:
        throw new Error(`Gun storage does not support filter ${operator}.`);
    }
  });
}

function relation(state, descriptor, row) {
  const [model, field, foreign, many] = descriptor;
  const related = state[model].filter((item) => item[foreign] === row[field]);
  return many ? related : (related[0] ?? null);
}

export function createQueries(models) {
  function matches(state, model, row, where = {}) {
    const definition = models[model];
    return Object.entries(where).every(([field, condition]) => {
      if (condition === undefined) return true;
      if (field === 'AND' || field === 'OR' || field === 'NOT') {
        const entries = Array.isArray(condition) ? condition : [condition];
        if (field === 'OR') return entries.some((item) => matches(state, model, row, item));
        return entries.every((item) => matches(state, model, row, item) === (field === 'AND'));
      }
      if (definition.key.length > 1 && field === definition.key.join('_')) {
        return matches(state, model, row, condition);
      }
      const descriptor = definition.relations?.[field];
      if (!descriptor) return compare(row[field], condition);
      const target = relation(state, descriptor, row);
      if (descriptor[3]) {
        if (!condition || !Object.hasOwn(condition, 'some')) {
          throw new Error('Gun storage expects a some filter for this relation.');
        }
        return target.some((item) => matches(state, descriptor[0], item, condition.some));
      }
      return target !== null && matches(state, descriptor[0], target, condition);
    });
  }

  function project(state, model, row, args) {
    const definition = models[model];
    const result = args.select ? {} : { ...row };
    for (const [field, selection] of Object.entries(args.select ?? args.include ?? {})) {
      if (!selection) continue;
      if (field === '_count') {
        result._count = Object.fromEntries(
          Object.entries(selection.select)
            .filter(([, value]) => value)
            .map(([name, value]) => {
              const descriptor = definition.relations[name];
              const count = relation(state, descriptor, row).filter((item) =>
                matches(state, descriptor[0], item, value.where),
              ).length;
              return [name, count];
            }),
        );
        continue;
      }
      const descriptor = definition.relations?.[field];
      if (!descriptor) {
        result[field] = row[field];
        continue;
      }
      const target = relation(state, descriptor, row);
      const options = selection === true ? {} : selection;
      result[field] = descriptor[3]
        ? target.map((item) => project(state, descriptor[0], item, options))
        : target && project(state, descriptor[0], target, options);
    }
    for (const field of definition.dates ?? []) {
      if (result[field] != null) result[field] = new Date(result[field]);
    }
    return result;
  }

  function query(state, model, args) {
    let rows = state[model].filter((row) => matches(state, model, row, args.where));
    if (args.orderBy) {
      const ordering = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
      rows.sort((first, second) => {
        for (const order of ordering) {
          for (const [field, direction] of Object.entries(order)) {
            if (first[field] === second[field]) continue;
            return (first[field] < second[field] ? -1 : 1) * (direction === 'desc' ? -1 : 1);
          }
        }
        return 0;
      });
    }
    if (args.skip) rows = rows.slice(args.skip);
    if (args.take !== undefined) rows = rows.slice(0, args.take);
    return rows;
  }

  function put(state, model, data, previous) {
    const definition = models[model];
    const row = previous ? { ...previous } : (definition.defaults?.() ?? {});
    for (const [field, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if (Object.hasOwn(value, 'increment')) row[field] += value.increment;
        else if (Object.hasOwn(value, 'decrement')) row[field] -= value.decrement;
        else throw new Error(`Gun storage does not support updating ${model}.${field} with an object.`);
      } else row[field] = persisted(value);
    }

    for (const keys of [definition.key, ...(definition.unique ?? [])]) {
      if (keys.some((key) => row[key] == null)) throw new Error(`Gun storage is missing a key for ${model}.`);
      if (state[model].some((other) => other !== previous && keys.every((key) => other[key] === row[key]))) {
        fail('P2002', `Duplicate ${model} record.`);
      }
    }
    for (const [related, key, foreign, optional] of definition.references ?? []) {
      if (optional && row[key] == null) continue;
      if (!state[related].some((item) => item[foreign] === row[key])) {
        fail('P2003', `Missing ${related} relation for ${model}.`);
      }
    }
    if (previous) state[model][state[model].indexOf(previous)] = row;
    else state[model].push(row);
    return row;
  }

  function remove(state, model, row) {
    state[model].splice(state[model].indexOf(row), 1);
    for (const [dependent, definition] of Object.entries(models)) {
      for (const [parent, key, foreign, optional] of definition.references ?? []) {
        if (parent !== model) continue;
        const children = state[dependent].filter((item) => item[key] === row[foreign]);
        for (const child of children) {
          if (optional) child[key] = null;
          else remove(state, dependent, child);
        }
      }
    }
  }

  function execute(state, model, operation, args) {
    if (!Object.hasOwn(models, model)) throw new Error(`Gun storage has no model ${model}.`);
    const result = (row) => (row ? project(state, model, row, args) : null);
    switch (operation) {
      case 'create':
        return result(put(state, model, args.data));
      case 'createMany': {
        const entries = Array.isArray(args.data) ? args.data : [args.data];
        for (const data of entries) put(state, model, data);
        return { count: entries.length };
      }
      case 'upsert': {
        const row = query(state, model, args)[0];
        return result(row ? put(state, model, args.update, row) : put(state, model, args.create));
      }
      case 'findUnique':
      case 'findFirst':
        return result(query(state, model, args)[0]);
      case 'findUniqueOrThrow':
      case 'findFirstOrThrow': {
        const row = query(state, model, args)[0];
        if (!row) fail('P2025', `Missing ${model} record.`);
        return result(row);
      }
      case 'findMany':
        return query(state, model, args).map(result);
      case 'count':
        return query(state, model, args).length;
      case 'groupBy': {
        const groups = new Map();
        for (const row of query(state, model, args)) {
          const fields = Object.fromEntries(args.by.map((field) => [field, row[field]]));
          const key = JSON.stringify(fields);
          if (!groups.has(key)) groups.set(key, { ...fields, _count: 0 });
          groups.get(key)._count++;
        }
        return [...groups.values()];
      }
      case 'update': {
        const row = query(state, model, args)[0];
        if (!row) fail('P2025', `Missing ${model} record.`);
        return result(put(state, model, args.data, row));
      }
      case 'updateManyAndReturn':
        return query(state, model, args).map((row) => result(put(state, model, args.data, row)));
      case 'delete': {
        const row = query(state, model, args)[0];
        if (!row) fail('P2025', `Missing ${model} record.`);
        const deleted = result(row);
        remove(state, model, row);
        return deleted;
      }
      case 'deleteMany': {
        const rows = query(state, model, args);
        for (const row of rows) remove(state, model, row);
        return { count: rows.length };
      }
      default:
        throw new Error(`Gun storage does not support Prisma operation ${operation}.`);
    }
  }
  return execute;
}
