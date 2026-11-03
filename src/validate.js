export const ORDER_STATUSES = ['received', 'preparing', 'ready', 'completed', 'cancelled'];
export const PAYMENT_STATUSES = ['unpaid', 'pending_verification', 'paid'];

const MAX_LINES = 30;
const MAX_QTY = 20;

const str = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

/**
 * Normalises a phone number. Kenyan numbers (07.., 01.., +254.., 254..) become 0XXXXXXXXX;
 * other international numbers are kept as +<digits>. Returns null if it doesn't look like a phone.
 */
export function normalizePhone(input) {
  const raw = str(input);
  if (!raw) return null;
  const plus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (/^(?:254|0)?([17]\d{8})$/.test(digits) && (!plus || digits.startsWith('254'))) {
    return '0' + digits.slice(-9);
  }
  if (plus && digits.length >= 8 && digits.length <= 15) return '+' + digits;
  return null;
}

export function normalizeMpesaCode(input) {
  const code = str(input).toUpperCase().replace(/\s/g, '');
  return /^[A-Z0-9]{10}$/.test(code) ? code : null;
}

export function normalizeEmail(input) {
  const email = str(input).toLowerCase();
  return email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

/**
 * Validates an order request against the live menu and site settings.
 * Prices are always taken from the catalog; anything the client sends about price is ignored.
 */
export function validateOrder(body, { catalog, availability, site }) {
  const errors = {};
  const b = body && typeof body === 'object' ? body : {};

  const name = str(b.name);
  if (name.length < 2 || name.length > 60) errors.name = 'Please enter your name (2–60 characters).';

  const phone = normalizePhone(b.phone);
  if (!phone) errors.phone = 'Please enter a valid phone number, e.g. 0712 345 678.';

  const orderType = str(b.orderType);
  if (!site.orderTypes[orderType]) errors.orderType = 'Please choose how you would like your order.';

  const readyIn = Number(b.readyIn ?? 0);
  if (!site.pickupTimes.includes(readyIn)) errors.readyIn = 'Please choose when you would like your order.';

  let deliveryLocation = null;
  if (orderType === 'delivery') {
    deliveryLocation = str(b.deliveryLocation);
    if (deliveryLocation.length < 3 || deliveryLocation.length > 200) {
      errors.deliveryLocation = 'Please tell us where to deliver (3–200 characters).';
    }
  }

  const notes = str(b.notes).slice(0, 300) || null;

  const paymentMethod = str(b.paymentMethod);
  if (!site.payment.methods[paymentMethod]) errors.paymentMethod = 'Please choose a payment method.';

  const merged = new Map();
  const items = Array.isArray(b.items) ? b.items : [];
  if (items.length === 0) errors.items = 'Your cart is empty.';
  if (items.length > MAX_LINES) errors.items = 'That is a lot of drinks! Please call us for large orders.';

  for (const line of items.slice(0, MAX_LINES)) {
    const item = catalog.get(str(line?.itemId));
    const size = item?.sizes.find((s) => s.id === str(line?.sizeId));
    const qty = Number(line?.qty);
    if (!item || !size) { errors.items = 'Some items in your cart are no longer on the menu.'; continue; }
    if (availability[item.id] === false) { errors.items = `Sorry, ${item.name} is sold out right now.`; continue; }
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) { errors.items = `Quantity must be between 1 and ${MAX_QTY}.`; continue; }
    const key = `${item.id}:${size.id}`;
    const prev = merged.get(key);
    const nextQty = (prev?.qty ?? 0) + qty;
    if (nextQty > MAX_QTY) { errors.items = `Quantity must be between 1 and ${MAX_QTY}.`; continue; }
    merged.set(key, {
      itemId: item.id,
      sizeId: size.id,
      name: item.name,
      size: size.label,
      unitPrice: size.price,
      qty: nextQty,
      lineTotal: size.price * nextQty,
      deliverySurcharge: item.deliverySurcharge,
    });
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  const lines = [...merged.values()];
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  // Delivery = flat fee (site.json) + per-drink surcharge for categories that set one (juices: +50 each).
  const deliveryFee = orderType === 'delivery'
    ? (Number(site.deliveryFee) || 0) + lines.reduce((sum, l) => sum + l.deliverySurcharge * l.qty, 0)
    : 0;
  for (const l of lines) delete l.deliverySurcharge;

  return {
    ok: true,
    value: {
      customer: { name, phone },
      orderType,
      readyIn,
      deliveryLocation,
      notes,
      paymentMethod,
      items: lines,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
    },
  };
}
