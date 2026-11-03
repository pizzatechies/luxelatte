import { $, esc, money, api, getSite, initChrome, myOrders, copyBtn, icons, clock, toast } from './lib.js';

initChrome();

const root = $('[data-order-root]');
const token = decodeURIComponent(location.pathname.split('/')[2] || '');
const isNew = new URLSearchParams(location.search).has('new');
if (isNew) history.replaceState(null, '', location.pathname);

let site;
let current;
let pollTimer;
let showPayAnyway = false;
let editingCode = false;

const DONE_LABEL = { pickup: 'Collected', dinein: 'Served', delivery: 'Delivered' };
const TYPE_LABEL = { pickup: 'Pick up', dinein: 'Dine in', delivery: 'Delivery' };
const STEPS = ['received', 'preparing', 'ready', 'completed'];

const headline = (o) => ({
  received: isNew ? `Thanks, ${o.customer.name.split(' ')[0]}! Your order is in.` : 'We’ve got your order.',
  preparing: 'We’re making your order now.',
  ready: o.orderType === 'delivery' ? 'Your order is on its way!' : 'Your order is ready!',
  completed: 'All done. Enjoy every sip!',
  cancelled: 'This order was cancelled.',
}[o.status]);

const statusLabel = (o) => ({
  received: 'Received', preparing: 'Preparing', ready: o.orderType === 'delivery' ? 'On its way' : 'Ready',
  completed: DONE_LABEL[o.orderType] || 'Completed', cancelled: 'Cancelled',
}[o.status]);

function whenText(o) {
  if (o.status === 'completed' || o.status === 'cancelled') return `Placed ${new Date(o.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}`;
  if (!o.readyIn) return `Placed at ${clock(o.createdAt)} · We’ll start on it right away`;
  const ready = new Date(new Date(o.createdAt).getTime() + o.readyIn * 60_000);
  return `Placed at ${clock(o.createdAt)} · Requested for around ${clock(ready.toISOString())}`;
}

function tracker(o) {
  if (o.status === 'cancelled') return '';
  const idx = STEPS.indexOf(o.status);
  const labels = ['Received', 'Preparing', o.orderType === 'delivery' ? 'On its way' : 'Ready', DONE_LABEL[o.orderType] || 'Done'];
  return `<ol class="tracker" aria-label="Order progress">
    ${STEPS.map((s, i) => {
      const cls = i < idx || o.status === 'completed' ? 'done' : i === idx ? 'current' : '';
      return `<li class="${cls}" ${i === idx ? 'aria-current="step"' : ''}><span class="dot">${icons.check}</span>${labels[i]}</li>`;
    }).join('')}
  </ol>`;
}

function codeForm(o) {
  return `
    <form class="code-form" data-code-form novalidate>
      <label class="sr-only" for="mpesa-code">M-Pesa confirmation code</label>
      <input class="input" id="mpesa-code" name="code" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false"
        placeholder="M-Pesa code, e.g. SJK3H7X9QW" value="${esc(o.payment.mpesaCode || '')}" required>
      <button class="btn" type="submit">Submit code</button>
    </form>
    <p class="error" data-code-error hidden style="color:var(--danger);font-size:14px;margin-top:8px"></p>`;
}

function payInstructions(o) {
  return `
    <ol class="pay-steps">
      <li><div><span class="lbl">Open M-Pesa</span><span class="val">Lipa na M-Pesa → Pay Bill</span></div></li>
      <li><div><span class="lbl">Business number</span><span class="val">${esc(site.payment.paybill)}</span></div>${copyBtn(site.payment.paybill)}</li>
      <li><div><span class="lbl">Account number</span><span class="val">${esc(site.payment.account)}</span></div>${copyBtn(site.payment.account)}</li>
      <li><div><span class="lbl">Amount</span><span class="val">${money(o.total)}</span></div>${copyBtn(String(o.total))}</li>
      <li><div><span class="lbl">Enter your PIN and send</span><span class="val">Then paste the code from your M-Pesa SMS below</span></div></li>
    </ol>
    ${codeForm(o)}`;
}

function paymentCard(o) {
  const p = o.payment;
  if (o.status === 'cancelled') return '';
  if (p.status === 'paid') {
    return `<div class="card"><div class="notice notice--ok">${icons.check}<div><strong>Payment received.</strong> Thank you!${p.mpesaCode ? ` <span style="opacity:.8">(M-Pesa ${esc(p.mpesaCode)})</span>` : ''}</div></div></div>`;
  }
  if (p.status === 'pending_verification' && !editingCode) {
    return `<div class="card">
      <h2>Payment</h2>
      <div class="notice notice--warn" style="margin-top:12px">${icons.clock}<div><strong>Confirming your payment…</strong><br>We’ve received your M-Pesa code <strong>${esc(p.mpesaCode)}</strong> and will confirm it shortly. This page updates automatically.</div></div>
      <p style="margin-top:14px;font-size:14px"><button type="button" class="copy" data-edit-code>Entered the wrong code?</button></p>
    </div>`;
  }
  if (p.method === 'counter' && !showPayAnyway && !editingCode) {
    return `<div class="card">
      <h2>Payment</h2>
      <div class="notice notice--info" style="margin-top:12px">${icons.info}<div>Pay <strong>${money(o.total)}</strong> at the counter when you collect, by cash or M-Pesa.</div></div>
      <p style="margin-top:14px;font-size:14px"><button type="button" class="copy" data-pay-now>Prefer to pay now with M-Pesa?</button></p>
    </div>`;
  }
  return `<div class="card">
    <h2>Pay with M-Pesa</h2>
    <p class="card__sub">Complete payment so we can get started. It takes less than a minute.</p>
    ${payInstructions(o)}
  </div>`;
}

function details(o) {
  const rows = [
    ['Type', TYPE_LABEL[o.orderType] || o.orderType],
    ['Name', o.customer.name],
    ['Phone', o.customer.phone],
    o.deliveryLocation ? ['Deliver to', o.deliveryLocation] : null,
    o.notes ? ['Notes', o.notes] : null,
  ].filter(Boolean);
  return `<div class="card">
    <h2 style="margin-bottom:12px">Order details</h2>
    <div class="summary__lines">
      ${o.items.map((l) => `
        <div class="line" style="grid-template-columns:minmax(0,1fr) auto">
          <div><div class="line__name">${l.qty} × ${esc(l.name)}</div><div class="line__meta">${esc(l.size)} · ${money(l.unitPrice)} each</div></div>
          <div class="line__total">${money(l.lineTotal)}</div>
        </div>`).join('')}
    </div>
    <div class="totals">
      <div><span class="muted">Subtotal</span><span>${money(o.subtotal)}</span></div>
      ${o.deliveryFee ? `<div><span class="muted">Delivery</span><span>${money(o.deliveryFee)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${money(o.total)}</span></div>
    </div>
    <dl class="kv" style="margin-top:20px;padding-top:16px;border-top:1.5px solid var(--line)">
      ${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
    </dl>
  </div>`;
}

function render(o) {
  const live = ['received', 'preparing', 'ready'].includes(o.status);
  const canNotify = live && o.status !== 'ready' && 'Notification' in window && Notification.permission === 'default';
  root.innerHTML = `
    ${o.status === 'ready' ? `<div class="ready-banner" role="status">${icons.party}<div><strong>${esc(headline(o))}</strong>${o.orderType === 'pickup' ? 'Come grab it at the counter. Show your order number.' : o.orderType === 'dinein' ? 'We’ll bring it right over.' : 'Hang tight, it’s nearly there.'}</div></div>` : ''}
    <div class="card order-hero">
      <span class="eyebrow">Order</span>
      <div class="num">#${o.number}</div>
      <span class="status-pill st-${o.status} ${live ? 'live' : ''}">${esc(statusLabel(o))}</span>
      <p class="lead">${esc(headline(o))}</p>
      <p class="muted" style="font-size:14px;margin-top:6px">${esc(whenText(o))}</p>
      ${tracker(o)}
      ${live ? '<p class="muted" style="font-size:13px;margin-top:16px">This page updates automatically. Bookmark it to check back later.</p>' : ''}
    </div>
    ${paymentCard(o)}
    ${details(o)}
    <div class="order-actions">
      ${canNotify ? `<button type="button" class="btn btn--ghost" data-notify-me>${icons.bell} Notify me when it’s ready</button>` : ''}
      <a class="btn" href="/#menu">Order something else</a>
      <a class="btn btn--ghost" href="/track">All my orders</a>
    </div>`;
  document.title = `Order #${o.number} · ${statusLabel(o)} | Luxe Latte`;
}

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1175, 1568].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.16 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.16);
      osc.stop(ctx.currentTime + i * 0.16 + 0.55);
    });
  } catch { /* audio not allowed */ }
}

function announceReady(o) {
  chime();
  navigator.vibrate?.([200, 100, 200]);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(`Order #${o.number} is ready!`, { body: 'Your Luxe Latte order is ready.', icon: '/img/icon-192.png' }); } catch { /* ignore */ }
  }
}

function apply(order) {
  const prev = current;
  current = order;
  if (prev && prev.updatedAt === order.updatedAt) return;
  const typed = $('#mpesa-code')?.value;
  render(order);
  if (typed && $('#mpesa-code') && order.payment.status !== 'paid') $('#mpesa-code').value = typed;
  if (prev && prev.status !== 'ready' && order.status === 'ready') announceReady(order);
  if (prev && prev.payment.status !== 'paid' && order.payment.status === 'paid') toast('Payment confirmed. Thank you!');
}

async function refresh() {
  try {
    const { order } = await api(`/orders/${encodeURIComponent(token)}`);
    apply(order);
  } catch (err) {
    if (err.status === 404) {
      root.innerHTML = `<div class="card" style="text-align:center"><h2>We couldn’t find that order</h2><p class="muted" style="margin:8px 0 20px">Check the link, or look it up with your order number and phone.</p><a class="btn" href="/track">Find my order</a></div>`;
      stopPolling();
    }
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (!current || ['completed', 'cancelled'].includes(current.status)) return stopPolling();
    refresh();
  }, 8000);
}
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPolling();
  else if (current && !['completed', 'cancelled'].includes(current.status)) { refresh(); startPolling(); }
});

root.addEventListener('click', async (e) => {
  if (e.target.closest('[data-pay-now]')) { showPayAnyway = true; render(current); $('#mpesa-code')?.focus(); }
  if (e.target.closest('[data-edit-code]')) { editingCode = true; render(current); $('#mpesa-code')?.select(); }
  if (e.target.closest('[data-notify-me]')) {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') toast('We’ll notify you when it’s ready.', { icon: icons.bell });
    render(current);
  }
});

root.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-code-form]');
  if (!form) return;
  e.preventDefault();
  const btn = form.querySelector('button');
  const errEl = $('[data-code-error]');
  errEl.hidden = true;
  btn.classList.add('is-loading');
  try {
    const { order } = await api(`/orders/${encodeURIComponent(token)}/mpesa`, { method: 'POST', body: { code: form.code.value } });
    editingCode = false;
    showPayAnyway = false;
    current = null; // force a re-render
    apply(order);
    toast('Code received. We’re confirming your payment.');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
    btn.classList.remove('is-loading');
  }
});

(async () => {
  const failed = `<div class="card" style="text-align:center"><h2>Couldn’t load your order</h2><p class="muted" style="margin:8px 0 20px">Check your connection and refresh the page.</p><a class="btn" href="${esc(location.pathname)}">Try again</a></div>`;
  try { site = await getSite(); } catch { root.innerHTML = failed; return; }
  await refresh();
  if (current) {
    myOrders.add(current);
    startPolling();
  } else if (!root.querySelector('h2')) root.innerHTML = failed;
})();
