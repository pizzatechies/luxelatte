import { $, $$, esc, money, art, api, cart, getMenu, getSite, indexMenu, initChrome, myOrders, storage, icons } from './lib.js';

initChrome();

const form = $('[data-form]');
const submitBtn = $('[data-submit]');
let site;
let menuIndex = new Map();

const ORDER_TYPES = {
  pickup: { label: 'Pick up', hint: 'Grab it from the counter' },
  dinein: { label: 'Dine in', hint: 'Enjoy it here with us' },
  delivery: { label: 'Delivery', hint: 'We bring it to you' },
};
const PAYMENTS = {
  mpesa: { label: 'M-Pesa Paybill', hint: 'Pay now and share your M-Pesa code' },
  counter: { label: 'Pay at the counter', hint: 'Cash or M-Pesa when you collect' },
};
const timeLabel = (m) => (m === 0 ? 'As soon as possible' : m === 60 ? 'In 1 hour' : m > 60 ? `In ${m / 60} hours` : `In ${m} min`);

const choice = (name, value, title, hint, checked) => `
  <label class="choice">
    <input type="radio" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''}>
    <span class="choice__box"><strong>${esc(title)}</strong>${hint ? `<span>${esc(hint)}</span>` : ''}</span>
  </label>`;

function renderChoices() {
  const types = Object.keys(ORDER_TYPES).filter((t) => site.orderTypes[t]);
  $('[data-order-types]').innerHTML = types
    .map((t, i) => choice('orderType', t, ORDER_TYPES[t].label, t === 'delivery' && site.deliveryFee ? `${ORDER_TYPES[t].hint} (+${money(site.deliveryFee)})` : ORDER_TYPES[t].hint, i === 0))
    .join('');
  $('[data-times]').innerHTML = site.pickupTimes.map((m, i) => choice('readyIn', m, timeLabel(m), '', i === 0)).join('');
  const pays = Object.keys(PAYMENTS).filter((p) => site.payment.methods[p]);
  $('[data-payments]').innerHTML = pays
    .map((p, i) => choice('paymentMethod', p, PAYMENTS[p].label, p === 'mpesa' ? `Paybill ${site.payment.paybill} · Acc ${site.payment.account}` : PAYMENTS[p].hint, i === 0))
    .join('');

  const saved = storage.get('ll_customer', null);
  if (saved) {
    form.elements.namedItem('name').value = saved.name || '';
    form.elements.namedItem('phone').value = saved.phone || '';
  }
}

const values = () => Object.fromEntries(new FormData(form).entries());

function totals() {
  const lines = cart.resolve(menuIndex);
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const fee = values().orderType === 'delivery' ? Number(site.deliveryFee) || 0 : 0;
  return { lines, subtotal, fee, total: subtotal + fee };
}

function renderSummary() {
  if (!site) return;
  const { lines, subtotal, fee, total } = totals();
  const empty = lines.length === 0;
  $('[data-checkout]').hidden = empty;
  $('[data-checkout-empty]').hidden = !empty;
  if (empty) return;

  $('[data-summary-lines]').innerHTML = lines.map((l) => `
    <div class="line">
      <div class="line__art" style="--c:${esc(l.item.color)}">${art(l.item)}</div>
      <div>
        <div class="line__name">${l.qty} × ${esc(l.item.name)}</div>
        <div class="line__meta">${esc(l.size.label)}${l.available ? '' : ' · <span class="tag tag--soldout">Sold out</span>'}</div>
      </div>
      <div class="line__total">${money(l.lineTotal)}</div>
    </div>`).join('');

  $('[data-totals]').innerHTML = `
    <div><span class="muted">Subtotal</span><span>${money(subtotal)}</span></div>
    ${fee ? `<div><span class="muted">Delivery</span><span>${money(fee)}</span></div>` : ''}
    <div class="grand"><span>Total</span><span>${money(total)}</span></div>`;

  const method = values().paymentMethod;
  $('[data-paynote]').innerHTML = method === 'mpesa'
    ? `${icons.mpesa}<span>After placing your order you’ll pay <strong>${money(total)}</strong> to Paybill <strong>${esc(site.payment.paybill)}</strong>, account <strong>${esc(site.payment.account)}</strong>, and enter your M-Pesa code on the next page.</span>`
    : `${icons.info}<span>Pay <strong>${money(total)}</strong> at the counter when you collect, by cash or M-Pesa.</span>`;

  submitBtn.innerHTML = `Place order · ${money(total)}`;
  submitBtn.disabled = lines.some((l) => !l.available) || !site.acceptingOrders;
}

function showErrors(fields = {}) {
  $$('[data-field]').forEach((f) => {
    const err = f.querySelector(':scope > .error');
    const msg = fields[f.dataset.field];
    f.classList.toggle('has-error', !!msg);
    if (err) { err.textContent = msg || ''; err.hidden = !msg; }
  });
  const first = Object.keys(fields)[0];
  if (first) $(`[data-field="${first}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clientValidate(v) {
  const errors = {};
  if ((v.name || '').trim().length < 2) errors.name = 'Please enter your name.';
  if ((v.phone || '').replace(/\D/g, '').length < 9) errors.phone = 'Please enter a valid phone number.';
  if (v.orderType === 'delivery' && (v.deliveryLocation || '').trim().length < 3) errors.deliveryLocation = 'Please tell us where to deliver.';
  return errors;
}

form.addEventListener('change', (e) => {
  if (e.target.name === 'orderType') $('[data-delivery]').hidden = e.target.value !== 'delivery';
  renderSummary();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = values();
  const formError = $('[data-form-error]');
  formError.hidden = true;
  const errors = clientValidate(v);
  showErrors(errors);
  if (Object.keys(errors).length) return;

  submitBtn.classList.add('is-loading');
  submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Placing your order…';
  try {
    const { order } = await api('/orders', {
      method: 'POST',
      body: {
        name: v.name,
        phone: v.phone,
        orderType: v.orderType,
        readyIn: Number(v.readyIn),
        deliveryLocation: v.deliveryLocation,
        notes: v.notes,
        paymentMethod: v.paymentMethod,
        items: cart.lines.map(({ itemId, sizeId, qty }) => ({ itemId, sizeId, qty })),
      },
    });
    storage.set('ll_customer', { name: v.name.trim(), phone: v.phone.trim() });
    myOrders.add(order);
    cart.clear();
    location.href = `/order/${encodeURIComponent(order.token)}?new=1`;
  } catch (err) {
    if (err.fields) showErrors(err.fields);
    formError.textContent = err.message;
    formError.hidden = false;
    submitBtn.classList.remove('is-loading');
    if (err.fields?.items) getMenu(true).then((m) => { menuIndex = indexMenu(m); renderSummary(); });
    else renderSummary();
  }
});

cart.onChange(() => renderSummary());

Promise.all([getSite(), getMenu()])
  .then(([s, menu]) => {
    site = s;
    menuIndex = indexMenu(menu);
    renderChoices();
    renderSummary();
    if (!site.acceptingOrders) {
      const banner = $('[data-closed-banner]');
      banner.innerHTML = `${icons.clock}<span>${esc(site.closedMessage || 'We’re not taking online orders right now. Please order at the counter.')}</span>`;
      banner.hidden = false;
    }
  })
  .catch(() => {
    $('[data-checkout-empty]').hidden = false;
    $('[data-checkout-empty]').innerHTML = '<div class="form-error" style="margin-top:24px">We couldn’t load checkout. Please refresh the page.</div>';
  });
