import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db.js';
import { createCatalog, loadJson } from '../src/catalog.js';
import { createApp } from '../src/app.js';
import { normalizePhone, normalizeMpesaCode } from '../src/validate.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function boot() {
  const app = createApp({
    store: openDatabase(':memory:'),
    catalog: createCatalog(loadJson(path.join(root, 'data'), 'menu.json')),
    site: loadJson(path.join(root, 'data'), 'site.json'),
    publicDir: path.join(root, 'public'),
    viewsDir: path.join(root, 'views'),
    adminPassword: 'secret',
    sessionSecret: 'test',
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const req = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, body: json, text };
  };
  return { req, close: () => server.close() };
}

const order = {
  name: 'Wanjiru', phone: '+254 712 345 678', orderType: 'pickup', readyIn: 0, paymentMethod: 'mpesa',
  items: [{ itemId: 'latte', sizeId: 'large', qty: 2 }, { itemId: 'luxe-sunrise', sizeId: 'regular', qty: 1, price: 1 }],
};

test('phone and M-Pesa code normalisation', () => {
  assert.equal(normalizePhone('0712 345 678'), '0712345678');
  assert.equal(normalizePhone('+254112542203'), '0112542203');
  assert.equal(normalizePhone('712345678'), '0712345678');
  assert.equal(normalizePhone('12'), null);
  assert.equal(normalizeMpesaCode(' sjk3h7x9qw '), 'SJK3H7X9QW');
  assert.equal(normalizeMpesaCode('SHORT'), null);
});

test('full order lifecycle', async () => {
  const { req, close } = await boot();
  try {
    const created = await req('POST', '/api/orders', order);
    assert.equal(created.status, 201);
    const o = created.body.order;
    assert.equal(o.total, 750, 'server prices: 2x300 + 150, ignoring client price');
    assert.equal(o.number, 1001);
    assert.match(o.customer.phone, /^071•+678$/);

    const lookup = await req('POST', '/api/orders/lookup', { number: '#1001', phone: '0712345678' });
    assert.equal(lookup.body.token, o.token);

    assert.equal((await req('POST', `/api/orders/${o.token}/mpesa`, { code: 'bad' })).status, 422);
    const paid = await req('POST', `/api/orders/${o.token}/mpesa`, { code: 'SJK3H7X9QW' });
    assert.equal(paid.body.order.payment.status, 'pending_verification');

    assert.equal((await req('GET', '/api/admin/orders')).status, 401);
    assert.equal((await req('POST', '/api/admin/login', { password: 'nope' })).status, 401);
    assert.equal((await req('POST', '/api/admin/login', { password: 'secret' })).status, 200);

    const dash = await req('GET', '/api/admin/orders');
    assert.equal(dash.body.active.length, 1);
    assert.equal(dash.body.stats.awaitingVerification, 1);

    const id = dash.body.active[0].id;
    await req('PATCH', `/api/admin/orders/${id}`, { paymentStatus: 'paid', status: 'ready' });
    const after = await req('GET', `/api/orders/${o.token}`);
    assert.equal(after.body.order.status, 'ready');
    assert.equal(after.body.order.payment.status, 'paid');
    assert.equal((await req('PATCH', `/api/admin/orders/${id}`, { status: 'bogus' })).status, 422);
  } finally { close(); }
});

test('rejects bad orders, sold-out items and paused ordering', async () => {
  const { req, close } = await boot();
  try {
    assert.equal((await req('POST', '/api/orders', { ...order, items: [] })).status, 422);
    assert.equal((await req('POST', '/api/orders', { ...order, items: [{ itemId: 'pizza', sizeId: 'large', qty: 1 }] })).status, 422);
    assert.equal((await req('POST', '/api/orders', { ...order, phone: 'abc' })).body.fields.phone !== undefined, true);
    assert.equal((await req('POST', '/api/orders', { ...order, orderType: 'delivery' })).status, 422, 'delivery disabled by default');

    await req('POST', '/api/admin/login', { password: 'secret' });
    await req('PATCH', '/api/admin/menu/latte', { available: false });
    const soldOut = await req('POST', '/api/orders', order);
    assert.equal(soldOut.status, 422);
    assert.match(soldOut.body.error, /sold out/);

    await req('PATCH', '/api/admin/menu/latte', { available: true });
    await req('PATCH', '/api/admin/settings', { acceptingOrders: false });
    assert.equal((await req('POST', '/api/orders', order)).status, 409);
  } finally { close(); }
});

test('eatery waitlist and pages', async () => {
  const { req, close } = await boot();
  try {
    assert.equal((await req('POST', '/api/waitlist', { contact: 'nope' })).status, 422);
    assert.equal((await req('POST', '/api/waitlist', { contact: 'Fan@Example.com' })).status, 201);
    assert.equal((await req('POST', '/api/waitlist', { contact: 'fan@example.com' })).status, 201, 'duplicates are fine');
    await req('POST', '/api/admin/login', { password: 'secret' });
    assert.equal((await req('GET', '/api/admin/waitlist')).body.waitlist.length, 1);

    for (const p of ['/', '/checkout', '/track', '/eatery', '/admin', '/order/x']) {
      const r = await req('GET', p);
      assert.equal(r.status, 200, p);
      assert.ok(!r.text.includes('{{>'), `${p} has unrendered partials`);
    }
    assert.equal((await req('GET', '/does-not-exist')).status, 404);
  } finally { close(); }
});
