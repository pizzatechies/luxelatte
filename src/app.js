import express from 'express';
import {
  validateOrder, normalizeMpesaCode, normalizePhone, normalizeEmail, ORDER_STATUSES, PAYMENT_STATUSES,
} from './validate.js';
import { createAdminAuth, rateLimit, securityHeaders, newOrderToken } from './security.js';
import { createPages } from './pages.js';

/**
 * Builds the Express app. Everything it needs is injected so tests can run it against an in-memory DB.
 */
export function createApp({ store, catalog, site, publicDir, viewsDir, cachePages = true, adminPassword, sessionSecret, tzOffsetMinutes = 180, trustProxy = false }) {
  const app = express();
  const auth = createAdminAuth({ password: adminPassword, secret: sessionSecret });

  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);
  app.use(securityHeaders);
  app.use(express.json({ limit: '20kb' }));

  const acceptingOrders = () => store.getSetting('acceptingOrders', true);
  const closedMessage = () => store.getSetting('closedMessage', '');

  const maskPhone = (p) => (p.length > 6 ? p.slice(0, 3) + '•'.repeat(p.length - 6) + p.slice(-3) : p);

  /** What a customer holding the tracking link is allowed to see. */
  const publicOrder = (o) => ({
    number: o.number,
    token: o.token,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    status: o.status,
    customer: { name: o.customer.name, phone: maskPhone(o.customer.phone) },
    orderType: o.orderType,
    readyIn: o.readyIn,
    deliveryLocation: o.deliveryLocation,
    notes: o.notes,
    payment: { method: o.payment.method, status: o.payment.status, mpesaCode: o.payment.mpesaCode },
    items: o.items,
    subtotal: o.subtotal,
    deliveryFee: o.deliveryFee,
    total: o.total,
  });

  const startOfToday = () => {
    const off = tzOffsetMinutes * 60_000;
    const day = 86_400_000;
    return new Date(Math.floor((Date.now() + off) / day) * day - off).toISOString();
  };

  // ---------- Public API ----------
  const api = express.Router();

  api.get('/site', (req, res) => {
    res.json({ ...site, acceptingOrders: acceptingOrders(), closedMessage: closedMessage() });
  });

  api.get('/menu', (req, res) => {
    res.json(catalog.withAvailability(store.availability()));
  });

  const orderLimiter = rateLimit({ windowMs: 10 * 60_000, max: 15, message: 'Too many orders from this device. Please wait a few minutes or call us.' });

  api.post('/orders', orderLimiter, (req, res) => {
    if (!acceptingOrders()) {
      return res.status(409).json({ error: closedMessage() || 'We are not taking online orders right now. Please visit us at the counter.' });
    }
    const result = validateOrder(req.body, { catalog, availability: store.availability(), site });
    if (!result.ok) return res.status(422).json({ error: Object.values(result.errors)[0], fields: result.errors });
    const order = store.createOrder({ ...result.value, token: newOrderToken() });
    res.status(201).json({ order: publicOrder(order) });
  });

  const lookupLimiter = rateLimit({ windowMs: 10 * 60_000, max: 20 });

  api.post('/orders/lookup', lookupLimiter, (req, res) => {
    const number = Number(String(req.body?.number ?? '').replace(/\D/g, ''));
    const phone = normalizePhone(req.body?.phone);
    const order = number && phone ? store.findOrder(number, phone) : null;
    if (!order) return res.status(404).json({ error: 'We could not find an order with that number and phone.' });
    res.json({ token: order.token });
  });

  api.get('/orders/:token', (req, res) => {
    const order = store.getOrderByToken(req.params.token);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json({ order: publicOrder(order) });
  });

  api.post('/orders/:token/mpesa', lookupLimiter, (req, res) => {
    const order = store.getOrderByToken(req.params.token);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.payment.status === 'paid') return res.json({ order: publicOrder(order) });
    if (order.status === 'cancelled') return res.status(409).json({ error: 'This order was cancelled.' });
    const code = normalizeMpesaCode(req.body?.code);
    if (!code) return res.status(422).json({ error: 'That doesn’t look like an M-Pesa code. It’s 10 letters and numbers, e.g. SJK3H7X9QW.' });
    res.json({ order: publicOrder(store.submitMpesaCode(order.id, code)) });
  });

  const waitlistLimiter = rateLimit({ windowMs: 10 * 60_000, max: 10 });

  api.post('/waitlist', waitlistLimiter, (req, res) => {
    const raw = String(req.body?.contact ?? '');
    const contact = raw.includes('@') ? normalizeEmail(raw) : normalizePhone(raw);
    if (!contact) return res.status(422).json({ error: 'Please enter a valid phone number or email.' });
    const name = String(req.body?.name ?? '').trim().slice(0, 60);
    store.addToWaitlist(name, contact);
    res.status(201).json({ ok: true });
  });

  // ---------- Admin API ----------
  const admin = express.Router();
  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, message: 'Too many sign-in attempts. Try again in 15 minutes.' });

  admin.post('/login', loginLimiter, (req, res) => {
    if (!auth.passwordMatches(req.body?.password)) return res.status(401).json({ error: 'Wrong password.' });
    auth.login(req, res);
    res.json({ ok: true });
  });

  admin.post('/logout', (req, res) => {
    auth.logout(req, res);
    res.json({ ok: true });
  });

  admin.get('/session', (req, res) => res.json({ authed: auth.isAuthed(req) }));

  admin.use(auth.require);

  admin.get('/orders', (req, res) => {
    const today = store.ordersSince(startOfToday());
    const counted = today.filter((o) => o.status !== 'cancelled');
    res.json({
      active: store.activeOrders(),
      recent: store.recentClosedOrders(60),
      latestId: store.latestOrderId(),
      stats: {
        ordersToday: counted.length,
        revenueToday: counted.filter((o) => o.payment.status === 'paid').reduce((s, o) => s + o.total, 0),
        unpaidToday: counted.filter((o) => o.payment.status !== 'paid').reduce((s, o) => s + o.total, 0),
        awaitingVerification: store.activeOrders().filter((o) => o.payment.status === 'pending_verification').length,
      },
    });
  });

  admin.patch('/orders/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!store.getOrderById(id)) return res.status(404).json({ error: 'Order not found.' });
    const { status, paymentStatus } = req.body ?? {};
    if (status !== undefined && !ORDER_STATUSES.includes(status)) return res.status(422).json({ error: 'Unknown status.' });
    if (paymentStatus !== undefined && !PAYMENT_STATUSES.includes(paymentStatus)) return res.status(422).json({ error: 'Unknown payment status.' });
    res.json({ order: store.updateOrder(id, { status, paymentStatus }) });
  });

  admin.get('/settings', (req, res) => {
    res.json({ acceptingOrders: acceptingOrders(), closedMessage: closedMessage() });
  });

  admin.patch('/settings', (req, res) => {
    const { acceptingOrders: accepting, closedMessage: msg } = req.body ?? {};
    if (typeof accepting === 'boolean') store.setSetting('acceptingOrders', accepting);
    if (typeof msg === 'string') store.setSetting('closedMessage', msg.trim().slice(0, 200));
    res.json({ acceptingOrders: acceptingOrders(), closedMessage: closedMessage() });
  });

  admin.patch('/menu/:itemId', (req, res) => {
    if (!catalog.get(req.params.itemId)) return res.status(404).json({ error: 'Unknown item.' });
    if (typeof req.body?.available !== 'boolean') return res.status(422).json({ error: '`available` must be true or false.' });
    store.setAvailability(req.params.itemId, req.body.available);
    res.json(catalog.withAvailability(store.availability()));
  });

  admin.get('/waitlist', (req, res) => res.json({ waitlist: store.waitlist() }));

  admin.get('/waitlist.csv', (req, res) => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Name', 'Contact', 'Signed up'], ...store.waitlist().map((w) => [w.name, w.contact, w.createdAt])];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="eatery-waitlist.csv"');
    res.send(rows.map((r) => r.map(esc).join(',')).join('\n'));
  });

  api.use('/admin', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  }, admin);

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // ---------- Pages ----------
  const page = createPages(viewsDir, { cache: cachePages });
  app.get('/', page('index.html'));
  app.get('/checkout', page('checkout.html'));
  app.get('/order/:token', page('order.html'));
  app.get('/track', page('track.html'));
  app.get('/eatery', page('eatery.html'));
  app.get('/admin', (req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex'); next(); }, page('admin.html'));
  app.use(express.static(publicDir, { maxAge: '1h', index: false }));
  app.use(page('404.html', 404));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  return app;
}
