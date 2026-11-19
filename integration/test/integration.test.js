import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { server } from '../src/server.js';
import { validate, submit } from '../src/rfq.js';
import { productPayload, synchronize } from '../src/sync.js';

const plant = {
  ID: '1234567890123456789', Masked_Node_ID: 'NODE-BD-01', MOQ: '50000',
  Dosage_Form: 'Tablets', Certification: 'WHO-GMP', Commerce_Product_ID: '998',
  Molecule: 'Private test molecule', Real_Plant_Name: 'Private test plant',
  Drug_Licence_Number: 'Private test licence', Factory_Address: 'Private test address',
};
const request = { node: 'NODE-BD-01', name: 'Rahul Sharma', email: 'rahul@example.com',
  quantity: 75000, website: '' };
const origin = 'https://store.example';

function database() {
  const entries = new Map();
  let fail = false;
  return {
    entries,
    failNext() { fail = true; },
    async read(report, fields, criteria) {
      if (report === 'RFQ_Catalog') return !criteria.includes('Masked_Node_ID') ||
        criteria.includes(plant.Masked_Node_ID) ? [plant] : [];
      const key = criteria.match(/[a-f0-9]{64}/)[0];
      return entries.has(key) ? [{ ID: '456' }] : [];
    },
    async add(form, values) {
      if (fail) {
        fail = false;
        throw new Error('Private upstream error');
      }
      if (entries.has(values.Submission_Key)) throw new Error('Duplicate');
      entries.set(values.Submission_Key, values);
      return '456';
    },
  };
}

const pipes = new Map();
const origFetch = globalThis.fetch;

globalThis.fetch = async (url, options = {}) => {
  const str = String(url);
  for (const [prefix, pipe] of pipes.entries()) {
    if (str.startsWith(prefix)) {
      const path = str.slice(prefix.length) || '/';
      return new Promise((resolve, reject) => {
        const req = http.request({
          socketPath: pipe,
          path,
          method: options.method || 'GET',
          headers: options.headers || {}
        }, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            const bodyBuf = Buffer.concat(chunks);
            resolve({
              status: res.statusCode,
              ok: res.statusCode >= 200 && res.statusCode < 300,
              headers: {
                get(k) { return res.headers[k.toLowerCase()] ?? null; }
              },
              async json() { return JSON.parse(bodyBuf.toString('utf8')); },
              async text() { return bodyBuf.toString('utf8'); }
            });
          });
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
      });
    }
  }
  return origFetch(url, options);
};

async function listening(t, db) {
  const pipe = '\\\\.\\pipe\\jollyrx-test-' + Math.random().toString(36).slice(2);
  const app = server(db, origin).listen(pipe);
  await once(app, 'listening');
  const base = 'http://pipe-' + Math.random().toString(36).slice(2) + '.local';
  pipes.set(base, pipe);
  t.after(() => new Promise(resolve => {
    pipes.delete(base);
    app.close(resolve);
  }));
  return base;
}

function post(base, body, source = origin) {
  return fetch(base + '/rfq', {
    method: 'POST', headers: { Origin: source, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

for (const [label, fields] of Object.entries({
  'empty name': { name: ' ' }, 'invalid email': { email: 'a@b' },
  'zero quantity': { quantity: 0 }, 'negative quantity': { quantity: -3 },
  'fractional quantity': { quantity: 2.5 }, 'injected node': { node: '" || ID !=0' },
  'HTML name': { name: '<script>' }, 'filled honeypot': { website: 'spam' },
})) {
  test('rejects ' + label, () => assert.throws(() => validate({ ...request, ...fields })));
}

test('public catalog allowlists fields and origin', async t => {
  const base = await listening(t, database());
  assert.equal((await fetch(base + '/catalog')).status, 403);
  const res = await fetch(base + '/catalog', { headers: { Origin: origin } });
  assert.equal(res.headers.get('access-control-allow-origin'), origin);
  assert.deepEqual(await res.json(), { items: [
    { node: 'NODE-BD-01', dosage: 'Tablets', certification: 'WHO-GMP', moq: 50000 },
  ] });
});

test('RFQ HTTP success, exact lookup ID, safe upstream error, bad origin, unknown node', async t => {
  const db = database();
  const base = await listening(t, db);
  db.failNext();
  const failed = await post(base, request);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'Service temporarily unavailable. Please try again.' });
  assert.equal(db.entries.size, 0);
  const unknown = await post(base, { ...request, node: 'NODE-ZZ-99' });
  assert.equal(unknown.status, 400);
  assert.equal((await post(base, request, 'https://untrusted.example')).status, 403);
  const success = await post(base, request);
  assert.deepEqual(await success.json(), { ok: true });
  const [saved] = db.entries.values();
  assert.equal(saved.Formulation_Reference, plant.ID);
  assert.equal(saved.Masked_Node_ID, request.node);
  assert.equal(saved.Inquiry_Status, 'New');
  assert.equal(saved.Target_Quantity, request.quantity);
  assert.equal(saved.Buyer_Email, request.email);
  assert.equal(saved.Buyer_Name, request.name);
});

test('concurrent duplicate RFQs resolve to one persisted fake record', async () => {
  const db = database();
  await Promise.all([submit(db, validate(request)), submit(db, validate(request))]);
  assert.equal(db.entries.size, 1);
});

test('RFQ rate limit returns 429 after six requests', async t => {
  const base = await listening(t, database());
  for (let n = 0; n < 6; n++) assert.equal((await post(base, request)).status, 200);
  assert.equal((await post(base, request)).status, 429);
});

test('Commerce payload is an explicit allowlist and creates unavailable inventory', () => {
  const payload = productPayload(plant, true);
  assert.deepEqual(Object.keys(payload).sort(), [
    'name', 'product_description', 'product_short_description', 'show_in_storefront',
    'url', 'variant_type', 'variants',
  ].sort());
  assert.equal(payload.show_in_storefront, false);
  assert.deepEqual(payload.variants, [{ rate: '1', initial_stock: '0', sku: plant.Masked_Node_ID }]);
  assert.doesNotMatch(JSON.stringify(payload), /Private test/);
  assert.equal(productPayload(plant, false).variants, undefined);
});

function syncDatabase() {
  const rows = ['BD', 'GJ', 'MH'].map((region, i) => ({
    ...plant, ID: String(i + 1), Masked_Node_ID: 'NODE-' + region + '-01',
    Commerce_Product_ID: '', Sync_Status: 'Pending',
  }));
  const logs = [];
  return {
    rows, logs,
    async read() { return rows.map(row => ({ ...row })); },
    async update(report, id, values) { Object.assign(rows.find(row => row.ID === id), values); },
    async add(form, values) { logs.push(values); },
  };
}

test('synchronization persists product IDs and updates on re-run', async () => {
  const db = syncDatabase();
  const writes = [];
  const save = async (payload, id) => {
    writes.push(id);
    return id || String(writes.length + 100);
  };
  assert.equal(await synchronize(db, save), true);
  assert.equal(await synchronize(db, save), true);
  assert.deepEqual(writes, ['', '', '', '101', '102', '103']);
  assert.equal(db.logs.length, 6);
});

test('ambiguous Commerce create is recorded and never blindly re-created', async () => {
  const db = syncDatabase();
  let attempts = 0;
  const save = async (payload, id) => {
    if (payload.name === 'NODE-BD-01') {
      attempts++;
      throw new Error('Timeout after request sent');
    }
    return id || String(200 + (payload.name === 'NODE-GJ-01' ? 1 : 2));
  };
  assert.equal(await synchronize(db, save), false);
  assert.equal(await synchronize(db, save), false);
  assert.equal(attempts, 1);
  assert.equal(db.rows[0].Sync_Status, 'Error');
  assert.ok(db.logs.some(row => row.Operation === 'Reconcile'));
});
