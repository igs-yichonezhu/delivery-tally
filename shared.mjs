// Small independent records let different people's orders merge safely.
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const key = (...parts) => JSON.stringify(parts);
export function toRecords(state) {
  const records = {};
  for (const name of state.names || []) records[key('name', name)] = true;
  for (const [id, store] of Object.entries(state.stores || {})) {
    for (const order of store.orders || []) records[key('order', id, order.name)] = order;
    for (const item of store.custom || []) records[key('custom', id, item.name)] = item;
    for (const name of store.hidden || []) records[key('hidden', id, name)] = true;
    for (const [name, edit] of Object.entries(store.edits || {})) records[key('edit', id, name)] = edit;
  }
  return structuredClone(records);
}
export function fromRecords(records, selectedStore = 'ruige') {
  const state = { store: selectedStore, names: [], stores: {} };
  for (const [encoded, value] of Object.entries(records)) {
    const [kind, id, name] = JSON.parse(encoded);
    if (kind === 'name') { state.names.push(id); continue; }
    const s = state.stores[id] ||= { orders: [], custom: [], hidden: [], edits: {} };
    if (kind === 'order') s.orders.push(value);
    if (kind === 'custom') s.custom.push(value);
    if (kind === 'hidden') s.hidden.push(name);
    if (kind === 'edit') Object.defineProperty(s.edits, name, {value, enumerable: true, writable: true, configurable: true});
  }
  return structuredClone(state);
}
export function diff(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter(k => !same(before[k] ?? null, after[k] ?? null))
    .map(k => ({ key: k, before: before[k] ?? null, after: after[k] ?? null }));
}
export function applyPatch(records, changes) {
  const conflicts = changes.filter(op => !same(records[op.key] ?? null, op.before)).map(op => op.key);
  if (conflicts.length) return { conflicts };
  const next = structuredClone(records);
  for (const op of changes) {
    if (op.after === null) delete next[op.key];
    else Object.defineProperty(next, op.key, {value: op.after, enumerable: true, writable: true, configurable: true});
  }
  return { records: next };
}
