import {
  $, $$, esc, money, art, api, cart, getMenu, getSite, indexMenu, initChrome, myOrders, storage, icons,
  STATIC, link, whatsappLink, copyBtn,
} from './lib.js';

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
    .map((t, i) => choice('orderType', t, ORDER_TYPES[t].label, t === 'delivery' ? deliveryHint() : ORDER_TYPES[t].hint, i === 0))
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

/** e.g. "We bring it to you · juices +KES 50 each" (surcharges come from menu.json categories). */
function deliveryHint() {
  const parts = [ORDER_TYPES.delivery.hint];
  if (Number(site.deliveryFee)) parts.push(`+${money(site.deliveryFee)}`);
  // e.g. "drinks +KES 50 each" (one note per surcharge amount, naming the categories it applies to)
  const byAmount = new Map();
  for (const i of menuIndex.values()) {
    if (!i.deliverySurcharge) continue;
    const names = byAmount.get(i.deliverySurcharge) ?? new Set();
    names.add(i.category);
    byAmount.set(i.deliverySurcharge, names);
  }
  for (const [amount, cats] of byAmount) {
    const label = cats.has('coffee') && cats.has('juice') && cats.size === 2 ? 'drinks' : [...cats].join(' & ');
    parts.push(`${label} +${money(amount)} each`);
  }
  return parts.join(' · ');
}

const values = () => Object.fromEntries(new FormData(form).entries());

function totals() {
  const lines = cart.resolve(menuIndex);
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const extras = lines.reduce((n, l) => n + l.item.deliverySurcharge * l.qty, 0);
  const fee = values().orderType === 'delivery' ? (Number(site.deliveryFee) || 0) + extras : 0;
  return { lines, subtotal, fee, total: subtotal + fee };
}

let placed = false;

/** GitHub Pages version: no server, so the order is sent to the shop as a WhatsApp message. */
function placeViaWhatsApp(v) {
  const { lines, fee, total } = totals();
  const ref = `LL-${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const p = site.payment;
  const msg = [
    `Hi Luxe Latte! New order ${ref}`,
    '',
    ...lines.map((l) => `${l.qty} × ${l.item.name} (${l.size.label}): ${money(l.lineTotal)}`),
    fee ? `Delivery: ${money(fee)}` : null,
    `*Total: ${money(total)}*`,
    '',
    `Name: ${v.name.trim()}`,
    `Phone: ${v.phone.trim()}`,
    `${ORDER_TYPES[v.orderType].label} · ${timeLabel(Number(v.readyIn))}`,
    v.orderType === 'delivery' ? `Deliver to: ${v.deliveryLocation.trim()}` : null,
    v.notes?.trim() ? `Notes: ${v.notes.trim()}` : null,
    `Payment: ${v.paymentMethod === 'mpesa' ? `M-Pesa Paybill ${p.paybill}, Account ${p.account}` : 'At the counter'}`,
  ].filter((x) => x !== null).join('\n');
  const wa = whatsappLink(site, msg);

  storage.set('ll_customer', { name: v.name.trim(), phone: v.phone.trim() });
  placed = true;
  cart.clear();

  $('[data-checkout]').outerHTML = `
    <div class="order-wrap" style="margin-top:28px;margin-inline:0;width:min(760px,100%)">
      <div class="card order-hero">
        <span class="eyebrow">Order ${esc(ref)}</span>
        <div class="num" style="font-size:clamp(44px,8vw,72px)">Almost done!</div>
        <p class="lead">Send your order to us on WhatsApp so we can start making it.</p>
        <a class="btn btn--lg btn--ok btn--wrap" style="margin-top:22px;--bg:#25a244;--bd:#25a244" href="${esc(wa)}" target="_blank" rel="noopener">Send order on WhatsApp · ${money(total)}</a>
        <p class="muted" style="font-size:13px;margin-top:12px">We’ll reply on WhatsApp to confirm and let you know when it’s ready.</p>
      </div>
      ${v.paymentMethod === 'mpesa' ? `
      <div class="card">
        <h2>Pay with M-Pesa</h2>
        <p class="card__sub">Then send the M-Pesa confirmation message in the same WhatsApp chat.</p>
        <ol class="pay-steps">
          <li><div><span class="lbl">Open M-Pesa</span><span class="val">Lipa na M-Pesa → Pay Bill</span></div></li>
          <li><div><span class="lbl">Business number</span><span class="val">${esc(p.paybill)}</span></div>${copyBtn(p.paybill)}</li>
          <li><div><span class="lbl">Account number</span><span class="val">${esc(p.account)}</span></div>${copyBtn(p.account)}</li>
          <li><div><span class="lbl">Amount</span><span class="val">${money(total)}</span></div>${copyBtn(String(total))}</li>
          <li><div><span class="lbl">Enter your PIN and send</span><span class="val">Share the M-Pesa SMS with us on WhatsApp</span></div></li>
        </ol>
      </div>` : `
      <div class="card"><div class="notice notice--info">${icons.info}<div>Pay <strong>${money(total)}</strong> at the counter when you collect, by cash or M-Pesa.</div></div></div>`}
      <div class="order-actions"><a class="btn btn--ghost" href="${link('/#menu')}">Back to the menu</a></div>
    </div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  window.open(wa, '_blank', 'noopener');
}

function deliveryNote(lines) {
  const charged = lines.filter((l) => l.item.deliverySurcharge);
  const n = charged.reduce((c, l) => c + l.qty, 0);
  if (!n) return '';
  const amounts = new Set(charged.map((l) => l.item.deliverySurcharge));
  return amounts.size === 1
    ? ` <small>(${n} drink${n === 1 ? '' : 's'} × ${money([...amounts][0])})</small>`
    : ` <small>(${n} drink${n === 1 ? '' : 's'})</small>`;
}

function renderSummary() {
  if (!site || placed) return;
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
    ${fee ? `<div><span class="muted">Delivery${deliveryNote(lines)}</span><span>${money(fee)}</span></div>` : ''}
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

/** Delivery orders are M-Pesa only: hide "Pay at the counter" and switch to M-Pesa. */
function syncPaymentForType() {
  const delivery = values().orderType === 'delivery';
  const counter = form.querySelector('input[name="paymentMethod"][value="counter"]');
  const mpesa = form.querySelector('input[name="paymentMethod"][value="mpesa"]');
  if (counter) {
    counter.disabled = delivery;
    counter.closest('.choice').hidden = delivery;
    if (delivery && counter.checked && mpesa) mpesa.checked = true;
  }
  $('[data-delivery-pay-note]').hidden = !delivery;
}

form.addEventListener('change', (e) => {
  if (e.target.name === 'orderType') {
    $('[data-delivery]').hidden = e.target.value !== 'delivery';
    syncPaymentForType();
  }
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
  if (STATIC) return placeViaWhatsApp(v);

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
    syncPaymentForType();
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
