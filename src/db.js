import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  token             TEXT    NOT NULL UNIQUE,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  customer_name     TEXT    NOT NULL,
  customer_phone    TEXT    NOT NULL,
  order_type        TEXT    NOT NULL,
  ready_in          INTEGER NOT NULL DEFAULT 0,
  delivery_location TEXT,
  notes             TEXT,
  payment_method    TEXT    NOT NULL,
  payment_status    TEXT    NOT NULL DEFAULT 'unpaid',
  mpesa_code        TEXT,
  status            TEXT    NOT NULL DEFAULT 'received',
  subtotal          INTEGER NOT NULL,
  delivery_fee      INTEGER NOT NULL DEFAULT 0,
  total             INTEGER NOT NULL,
  items_json        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_phone   ON orders(customer_phone);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_availability (
  item_id   TEXT PRIMARY KEY,
  available INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS waitlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT,
  contact    TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
`;

// Order numbers shown to customers start here so the first order isn't "#1".
export const ORDER_NUMBER_OFFSET = 1000;

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  // Columns added after the first release (STK Push). Older databases get them on start-up.
  const cols = new Set(db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name));
  for (const [name, type] of [['stk_checkout_id', 'TEXT'], ['stk_status', 'TEXT'], ['stk_message', 'TEXT'], ['stk_phone', 'TEXT']]) {
    if (!cols.has(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${type}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_stk ON orders(stk_checkout_id)');
  return createStore(db);
}

function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    number: row.id + ORDER_NUMBER_OFFSET,
    token: row.token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customer: { name: row.customer_name, phone: row.customer_phone },
    orderType: row.order_type,
    readyIn: row.ready_in,
    deliveryLocation: row.delivery_location,
    notes: row.notes,
    payment: {
      method: row.payment_method,
      status: row.payment_status,
      mpesaCode: row.mpesa_code,
      stk: row.stk_status ? { status: row.stk_status, message: row.stk_message, phone: row.stk_phone } : null,
    },
    status: row.status,
    subtotal: row.subtotal,
    deliveryFee: row.delivery_fee,
    total: row.total,
    items: JSON.parse(row.items_json),
  };
}

function createStore(db) {
  const q = {
    insertOrder: db.prepare(`
      INSERT INTO orders (token, created_at, updated_at, customer_name, customer_phone, order_type, ready_in,
        delivery_location, notes, payment_method, payment_status, status, subtotal, delivery_fee, total, items_json)
      VALUES (:token, :now, :now, :name, :phone, :orderType, :readyIn, :deliveryLocation, :notes,
        :paymentMethod, 'unpaid', 'received', :subtotal, :deliveryFee, :total, :items)`),
    byToken: db.prepare('SELECT * FROM orders WHERE token = ?'),
    byId: db.prepare('SELECT * FROM orders WHERE id = ?'),
    byIdAndPhone: db.prepare('SELECT * FROM orders WHERE id = ? AND customer_phone = ?'),
    setMpesaCode: db.prepare(`UPDATE orders SET mpesa_code = ?, payment_status = 'pending_verification', updated_at = ?
      WHERE id = ? AND payment_status != 'paid'`),
    active: db.prepare(`SELECT * FROM orders WHERE status IN ('received','preparing','ready') ORDER BY id ASC`),
    recent: db.prepare(`SELECT * FROM orders WHERE status IN ('completed','cancelled') ORDER BY id DESC LIMIT ?`),
    since: db.prepare('SELECT * FROM orders WHERE created_at >= ? ORDER BY id DESC'),
    maxId: db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM orders'),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    availability: db.prepare('SELECT item_id, available FROM item_availability'),
    setAvailability: db.prepare(`INSERT INTO item_availability (item_id, available) VALUES (?, ?)
      ON CONFLICT(item_id) DO UPDATE SET available = excluded.available`),
    addWaitlist: db.prepare(`INSERT INTO waitlist (name, contact, created_at) VALUES (?, ?, ?)
      ON CONFLICT(contact) DO UPDATE SET name = COALESCE(excluded.name, waitlist.name)`),
    waitlist: db.prepare('SELECT id, name, contact, created_at AS createdAt FROM waitlist ORDER BY id DESC'),
    waitlistCount: db.prepare('SELECT COUNT(*) AS n FROM waitlist'),
  };

  const now = () => new Date().toISOString();

  return {
    raw: db,

    createOrder(o) {
      const info = q.insertOrder.run({
        token: o.token,
        now: now(),
        name: o.customer.name,
        phone: o.customer.phone,
        orderType: o.orderType,
        readyIn: o.readyIn,
        deliveryLocation: o.deliveryLocation ?? null,
        notes: o.notes ?? null,
        paymentMethod: o.paymentMethod,
        subtotal: o.subtotal,
        deliveryFee: o.deliveryFee,
        total: o.total,
        items: JSON.stringify(o.items),
      });
      return rowToOrder(q.byId.get(Number(info.lastInsertRowid)));
    },

    getOrderByToken: (token) => rowToOrder(q.byToken.get(token)),
    getOrderById: (id) => rowToOrder(q.byId.get(id)),
    findOrder: (number, phone) => rowToOrder(q.byIdAndPhone.get(number - ORDER_NUMBER_OFFSET, phone)),

    submitMpesaCode(id, code) {
      q.setMpesaCode.run(code, now(), id);
      return rowToOrder(q.byId.get(id));
    },

    /** A PIN prompt was sent; remember Safaricom's request id so the callback can find the order. */
    setStkPending(id, checkoutId, phone) {
      db.prepare(`UPDATE orders SET stk_checkout_id = ?, stk_status = 'pending', stk_message = NULL, stk_phone = ?, updated_at = ?
        WHERE id = ?`).run(checkoutId, phone, now(), id);
      return rowToOrder(q.byId.get(id));
    },

    getOrderByStkId: (checkoutId) => rowToOrder(db.prepare('SELECT * FROM orders WHERE stk_checkout_id = ?').get(checkoutId)),

    /** Result from Safaricom. Success marks the order paid with the M-Pesa receipt number. */
    setStkResult(id, { success, message, receipt }) {
      if (success) {
        db.prepare(`UPDATE orders SET stk_status = 'success', stk_message = NULL, payment_status = 'paid', mpesa_code = ?, updated_at = ?
          WHERE id = ?`).run(receipt, now(), id);
      } else {
        db.prepare(`UPDATE orders SET stk_status = 'failed', stk_message = ?, updated_at = ? WHERE id = ? AND payment_status != 'paid'`)
          .run(message, now(), id);
      }
      return rowToOrder(q.byId.get(id));
    },

    updateOrder(id, { status, paymentStatus }) {
      const sets = [];
      const params = [];
      if (status) { sets.push('status = ?'); params.push(status); }
      if (paymentStatus) { sets.push('payment_status = ?'); params.push(paymentStatus); }
      if (!sets.length) return rowToOrder(q.byId.get(id));
      sets.push('updated_at = ?');
      params.push(now(), id);
      db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      return rowToOrder(q.byId.get(id));
    },

    activeOrders: () => q.active.all().map(rowToOrder),
    recentClosedOrders: (limit = 50) => q.recent.all(limit).map(rowToOrder),
    ordersSince: (iso) => q.since.all(iso).map(rowToOrder),
    latestOrderId: () => q.maxId.get().id,

    getSetting(key, fallback = null) {
      const row = q.getSetting.get(key);
      return row ? JSON.parse(row.value) : fallback;
    },
    setSetting: (key, value) => q.setSetting.run(key, JSON.stringify(value)),

    availability() {
      const map = {};
      for (const r of q.availability.all()) map[r.item_id] = !!r.available;
      return map;
    },
    setAvailability: (itemId, available) => q.setAvailability.run(itemId, available ? 1 : 0),

    addToWaitlist: (name, contact) => q.addWaitlist.run(name || null, contact, now()),
    waitlist: () => q.waitlist.all().map((r) => ({ ...r })),
    waitlistCount: () => q.waitlistCount.get().n,
  };
}
