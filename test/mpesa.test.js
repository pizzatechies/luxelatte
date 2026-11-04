import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db.js';
import { createCatalog, loadJson } from '../src/catalog.js';
import { createApp } from '../src/app.js';
import { createMpesa } from '../src/mpesa.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A stand-in for Safaricom's Daraja API that records what we send it. */
async function fakeDaraja() {
  const calls = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/oauth/v1/generate')) return res.end(JSON.stringify({ access_token: 'tok123', expires_in: '3599' }));
      if (req.url === '/mpesa/stkpush/v1/processrequest') {
        n += 1;
        return res.end(JSON.stringify({ ResponseCode: '0', CheckoutRequestID: `ws_CO_${n}`, MerchantRequestID: `m${n}`, CustomerMessage: 'Success' }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  server.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { calls, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

async function boot(daraja) {
  const mpesa = createMpesa({
    MPESA_CONSUMER_KEY: 'key', MPESA_CONSUMER_SECRET: 'secret', MPESA_SHORTCODE: '174379', MPESA_PASSKEY: 'pass',
    PUBLIC_URL: 'https://luxe.example.com/', MPESA_BASE_URL: daraja.url,
  });
  const app = createApp({
    store: openDatabase(':memory:'),
    catalog: createCatalog(loadJson(path.join(root, 'data'), 'menu.json')),
    site: loadJson(path.join(root, 'data'), 'site.json'),
    publicDir: path.join(root, 'public'), viewsDir: path.join(root, 'views'),
    adminPassword: 'secret', sessionSecret: 'test', mpesa,
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { req, mpesa, close: () => server.close() };
}

const callback = (id, ok, extra = {}) => ({
  Body: { stkCallback: {
    MerchantRequestID: 'm', CheckoutRequestID: id, ResultCode: ok ? 0 : extra.code ?? 1032, ResultDesc: ok ? 'Processed' : 'Request cancelled by user',
    ...(ok ? { CallbackMetadata: { Item: [{ Name: 'Amount', Value: extra.amount }, { Name: 'MpesaReceiptNumber', Value: 'TKA1B2C3D4' }, { Name: 'PhoneNumber', Value: 254712345678 }] } } : {}),
  } },
});

const newOrder = (req) => req('POST', '/api/orders', {
  name: 'Wanjiru', phone: '0712345678', orderType: 'pickup', readyIn: 0, paymentMethod: 'mpesa',
  items: [{ itemId: 'latte', sizeId: 'large', qty: 1 }, { itemId: 'glazed-donut', sizeId: 'single', qty: 1 }],
}).then((r) => r.body.order);

test('STK push: prompt, then Safaricom confirms payment', async () => {
  const daraja = await fakeDaraja();
  const { req, mpesa, close } = await boot(daraja);
  try {
    assert.equal((await req('GET', '/api/site')).body.stkEnabled, true);
    const o = await newOrder(req);
    assert.equal(o.total, 300);

    assert.equal((await req('POST', `/api/orders/${o.token}/stk`, { phone: '+44 7700 900123' })).status, 422, 'Kenyan numbers only');
    const sent = await req('POST', `/api/orders/${o.token}/stk`, { phone: '0712 345 678' });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.order.payment.stk.status, 'pending');

    const push = daraja.calls.find((c) => c.url === '/mpesa/stkpush/v1/processrequest');
    assert.equal(push.auth, 'Bearer tok123');
    assert.equal(push.body.Amount, 300);
    assert.equal(push.body.PartyA, '254712345678');
    assert.equal(push.body.PhoneNumber, '254712345678');
    assert.equal(push.body.BusinessShortCode, '174379');
    assert.equal(push.body.TransactionType, 'CustomerPayBillOnline');
    assert.equal(push.body.AccountReference, `LL${o.number}`);
    assert.equal(Buffer.from(push.body.Password, 'base64').toString(), `174379pass${push.body.Timestamp}`);
    assert.match(push.body.Timestamp, /^\d{14}$/);
    assert.equal(push.body.CallBackURL, `https://luxe.example.com/api/mpesa/callback/${mpesa.callbackSecret}`);

    assert.equal((await req('POST', '/api/mpesa/callback/wrong', callback('ws_CO_1', true, { amount: 300 }))).status, 404);
    const ack = await req('POST', `/api/mpesa/callback/${mpesa.callbackSecret}`, callback('ws_CO_1', true, { amount: 300 }));
    assert.equal(ack.body.ResultCode, 0);

    const after = (await req('GET', `/api/orders/${o.token}`)).body.order;
    assert.equal(after.payment.status, 'paid');
    assert.equal(after.payment.mpesaCode, 'TKA1B2C3D4');
    assert.equal(after.payment.stk.status, 'success');
  } finally { close(); daraja.close(); }
});

test('STK push: cancelled prompt and short payment are not marked paid', async () => {
  const daraja = await fakeDaraja();
  const { req, mpesa, close } = await boot(daraja);
  const cb = `/api/mpesa/callback/${mpesa.callbackSecret}`;
  try {
    const a = await newOrder(req);
    await req('POST', `/api/orders/${a.token}/stk`, { phone: '0712345678' });
    await req('POST', cb, callback('ws_CO_1', false, { code: 1032 }));
    const failed = (await req('GET', `/api/orders/${a.token}`)).body.order.payment;
    assert.equal(failed.status, 'unpaid');
    assert.equal(failed.stk.status, 'failed');
    assert.match(failed.stk.message, /cancelled/);

    const b = await newOrder(req);
    await req('POST', `/api/orders/${b.token}/stk`, { phone: '0712345678' });
    await req('POST', cb, callback('ws_CO_2', true, { amount: 50 }));
    const short = (await req('GET', `/api/orders/${b.token}`)).body.order.payment;
    assert.equal(short.status, 'unpaid');
    assert.match(short.stk.message, /50 of KES 300/);
  } finally { close(); daraja.close(); }
});

test('STK push is off without Daraja credentials', async () => {
  assert.equal(createMpesa({}), null);
});
