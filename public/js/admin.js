import { $, $$, esc, money, api, art, icons, clock, toast, storage } from './lib.js';

const POLL_MS = 5000;
const TYPE = { pickup: 'Pick up', dinein: 'Dine in', delivery: 'Delivery' };
const NEXT = {
  received: { status: 'preparing', label: 'Start preparing' },
  preparing: { status: 'ready', label: 'Mark ready' },
  ready: { status: 'completed', label: 'Complete' },
};
const STATUS = { received: 'New', preparing: 'Preparing', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' };
const PAY = { unpaid: 'Unpaid', pending_verification: 'To verify', paid: 'Paid' };

let pollTimer;
let lastSeenId = Number(storage.get('ll_admin_last_seen', 0));
let freshIds = new Set();
let audioCtx = null;
let soundOn = storage.get('ll_admin_sound', true);
let data = null;
let lastSig = '';

// ---------- Auth ----------
async function boot() {
  const { authed } = await api('/admin/session');
  if (authed) showDash();
  else showLogin();
}

function showLogin() {
  stopPolling();
  $('[data-dash]').hidden = true;
  $('[data-login]').hidden = false;
  $('#password').focus();
}

$('[data-login-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('[data-login-error]');
  const btn = e.currentTarget.querySelector('button');
  err.hidden = true;
  btn.classList.add('is-loading');
  try {
    await api('/admin/login', { method: 'POST', body: { password: $('#password').value } });
    $('#password').value = '';
    unlockAudio();
    showDash();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.classList.remove('is-loading');
  }
});

$('[data-logout]').addEventListener('click', async () => {
  await api('/admin/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

async function call(path, opts) {
  try {
    return await api(path, opts);
  } catch (err) {
    if (err.status === 401) showLogin();
    else toast(err.message, { icon: icons.info });
    throw err;
  }
}

// ---------- Dashboard ----------
async function showDash() {
  $('[data-login]').hidden = true;
  $('[data-dash]').hidden = false;
  updateSoundButton();
  updateAlertsButton();
  await Promise.all([refresh(), loadSettings(), loadWaitlist()]);
  startPolling();
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(refresh, POLL_MS);
}
function stopPolling() { clearInterval(pollTimer); }

async function refresh() {
  let next;
  try { next = await call('/admin/orders'); } catch { return; }
  const newOnes = next.active.filter((o) => o.id > lastSeenId && o.status === 'received');
  if (newOnes.length) {
    newOnes.forEach((o) => {
      freshIds.add(o.id);
      setTimeout(() => { freshIds.delete(o.id); render(); }, 60_000);
    });
    if (data) announce(newOnes); // no sound for orders that came in while the dashboard was closed
  }
  if (next.latestId > lastSeenId) {
    lastSeenId = next.latestId;
    storage.set('ll_admin_last_seen', lastSeenId);
  }
  const sig = JSON.stringify(next);
  if (sig === lastSig) return;
  lastSig = sig;
  data = next;
  render();
}

function render() {
  const { stats, active, recent } = data;
  $('[data-stat="ordersToday"]').textContent = stats.ordersToday;
  $('[data-stat="revenueToday"]').textContent = money(stats.revenueToday);
  $('[data-stat="unpaidToday"]').textContent = money(stats.unpaidToday);
  $('[data-stat="awaitingVerification"]').textContent = stats.awaitingVerification;
  $('.a-stat--alert').classList.toggle('has-items', stats.awaitingVerification > 0);
  $('[data-live-count]').textContent = active.length;

  const newCount = active.filter((o) => o.status === 'received').length;
  document.title = `${newCount ? `(${newCount}) ` : ''}Orders | Luxe Latte`;

  for (const status of ['received', 'preparing', 'ready']) {
    const col = $(`[data-col="${status}"]`);
    const list = active.filter((o) => o.status === status);
    col.querySelector('[data-col-count]').textContent = list.length;
    col.querySelector('.a-col__list').innerHTML = list.length
      ? list.map(orderCard).join('')
      : `<div class="a-empty">${status === 'received' ? 'No new orders. Time for a coffee? ☕' : 'Nothing here yet.'}</div>`;
  }

  $('[data-history]').innerHTML = `
    <thead><tr><th>#</th><th>Placed</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th></th></tr></thead>
    <tbody>${recent.length ? recent.map(historyRow).join('') : '<tr><td colspan="8" class="a-empty">No completed orders yet.</td></tr>'}</tbody>`;
}

function age(o) {
  const mins = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000);
  const late = (o.status === 'received' && mins >= 10) || (o.status === 'preparing' && mins >= 20);
  return `<span class="o-age ${late ? 'late' : ''}" title="Placed ${clock(o.createdAt)}">${clock(o.createdAt)} · ${mins < 1 ? 'now' : `${mins}m`}</span>`;
}

function payBlock(o) {
  const p = o.payment;
  if (p.status === 'paid') {
    return `<div class="o-pay o-pay--paid"><span>${icons.check} Paid${p.mpesaCode ? ` · <code>${esc(p.mpesaCode)}</code>` : ''}</span>
      <button class="btn btn--xs btn--ghost" data-act="pay" data-id="${o.id}" data-val="unpaid">Undo</button></div>`;
  }
  if (p.status === 'pending_verification') {
    return `<div class="o-pay o-pay--verify"><span>M-Pesa code <code>${esc(p.mpesaCode)}</code><br><small>Check your M-Pesa messages for ${money(o.total)}</small></span>
      <button class="btn btn--xs btn--ok" data-act="pay" data-id="${o.id}" data-val="paid">Confirm paid</button></div>`;
  }
  return `<div class="o-pay o-pay--unpaid"><span>${p.method === 'mpesa' ? 'Awaiting M-Pesa payment' : 'Pay at counter'}</span>
    <button class="btn btn--xs btn--ghost" data-act="pay" data-id="${o.id}" data-val="paid">Mark paid</button></div>`;
}

function orderCard(o) {
  const next = NEXT[o.status];
  const when = o.readyIn ? `Wanted by ${clock(new Date(new Date(o.createdAt).getTime() + o.readyIn * 60000).toISOString())}` : 'ASAP';
  return `
    <article class="o-card ${freshIds.has(o.id) ? 'is-new' : ''}" data-order="${o.id}">
      <div class="o-head">
        <span class="o-num">#${o.number}</span>
        <span class="o-badge">${esc(TYPE[o.orderType] || o.orderType)}</span>
        ${age(o)}
      </div>
      <div class="o-who"><strong>${esc(o.customer.name)}</strong><a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a></div>
      <div class="o-when">${icons.clock}<span>${esc(when)}</span></div>
      <ul class="o-items">${o.items.map((l) => `<li><b>${l.qty}×</b> ${esc(l.name)} <em>${esc(l.size)}</em></li>`).join('')}</ul>
      ${o.deliveryLocation ? `<div class="o-addr">${icons.pin} ${esc(o.deliveryLocation)}</div>` : ''}
      ${o.notes ? `<div class="o-notes">“${esc(o.notes)}”</div>` : ''}
      ${payBlock(o)}
      <div class="o-foot">
        <span class="o-total">${money(o.total)}</span>
        <button class="btn btn--xs btn--danger-ghost" data-act="cancel" data-id="${o.id}">Cancel</button>
        ${next ? `<button class="btn btn--sm" data-act="status" data-id="${o.id}" data-val="${next.status}">${next.label}</button>` : ''}
      </div>
    </article>`;
}

function historyRow(o) {
  return `<tr>
    <td class="num"><strong>#${o.number}</strong></td>
    <td class="num">${new Date(o.createdAt).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' })}</td>
    <td>${esc(o.customer.name)}<br><a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a></td>
    <td>${o.items.map((l) => `${l.qty}× ${esc(l.name)} (${esc(l.size)})`).join('<br>')}</td>
    <td class="num">${money(o.total)}</td>
    <td>${PAY[o.payment.status]}${o.payment.mpesaCode ? `<br><code>${esc(o.payment.mpesaCode)}</code>` : ''}</td>
    <td>${STATUS[o.status]}</td>
    <td>${o.status === 'cancelled' || o.payment.status !== 'paid'
      ? `<button class="btn btn--xs btn--ghost" data-act="status" data-id="${o.id}" data-val="received">Reopen</button>` : ''}
      ${o.payment.status !== 'paid' && o.status !== 'cancelled' ? `<button class="btn btn--xs btn--ghost" data-act="pay" data-id="${o.id}" data-val="paid">Mark paid</button>` : ''}</td>
  </tr>`;
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const order = [...(data?.active || []), ...(data?.recent || [])].find((o) => o.id === id);
  let body;
  if (btn.dataset.act === 'status') body = { status: btn.dataset.val };
  if (btn.dataset.act === 'pay') body = { paymentStatus: btn.dataset.val };
  if (btn.dataset.act === 'cancel') {
    if (!confirm(`Cancel order #${order?.number}? The customer will see it as cancelled.`)) return;
    body = { status: 'cancelled' };
  }
  btn.classList.add('is-loading');
  freshIds.delete(id);
  try {
    await call(`/admin/orders/${id}`, { method: 'PATCH', body });
    await refresh();
  } catch {
    btn.classList.remove('is-loading');
  }
});

// ---------- Tabs ----------
$$('[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
  $$('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
  if (tab.dataset.tab === 'menu') loadMenu();
  if (tab.dataset.tab === 'waitlist') loadWaitlist();
}));

// ---------- Settings: accepting orders ----------
async function loadSettings() {
  const s = await call('/admin/settings');
  setAccepting(s.acceptingOrders);
}
function setAccepting(on) {
  $('[data-accepting]').checked = on;
  const label = $('[data-accepting-label]');
  label.textContent = on ? 'Taking orders' : 'Online orders paused';
  label.classList.toggle('off', !on);
}
$('[data-accepting]').addEventListener('change', async (e) => {
  const on = e.target.checked;
  try {
    const s = await call('/admin/settings', { method: 'PATCH', body: { acceptingOrders: on } });
    setAccepting(s.acceptingOrders);
    toast(on ? 'Online orders are open.' : 'Online orders paused.');
  } catch {
    setAccepting(!on);
  }
});

// ---------- Menu availability ----------
async function loadMenu() {
  const menu = await call('/menu');
  $('[data-menu]').innerHTML = menu.categories.flatMap((c) => c.items).map((item) => `
    <div class="a-item ${item.available ? '' : 'is-off'}">
      <div class="row__art" style="--c:${esc(item.color)}">${art(item)}</div>
      <div class="a-item__text"><strong>${esc(item.name)}</strong><span>${item.sizes.map((s) => `${esc(s.label)} ${s.price}`).join(' · ')}</span></div>
      <label class="switch" title="Available">
        <input type="checkbox" data-avail="${esc(item.id)}" ${item.available ? 'checked' : ''}>
        <span class="switch__track" aria-hidden="true"></span>
        <span class="sr-only">${esc(item.name)} available</span>
      </label>
    </div>`).join('');
}
$('[data-menu]').addEventListener('change', async (e) => {
  const input = e.target.closest('[data-avail]');
  if (!input) return;
  try {
    await call(`/admin/menu/${encodeURIComponent(input.dataset.avail)}`, { method: 'PATCH', body: { available: input.checked } });
    input.closest('.a-item').classList.toggle('is-off', !input.checked);
  } catch {
    input.checked = !input.checked;
  }
});

// ---------- Waitlist ----------
async function loadWaitlist() {
  const { waitlist } = await call('/admin/waitlist');
  $('[data-waitlist-count]').textContent = waitlist.length;
  $('[data-waitlist]').innerHTML = `
    <thead><tr><th>Name</th><th>Phone / email</th><th>Signed up</th></tr></thead>
    <tbody>${waitlist.length ? waitlist.map((w) => `<tr><td>${esc(w.name || '—')}</td><td>${esc(w.contact)}</td><td class="num">${new Date(w.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>`).join('')
      : '<tr><td colspan="3" class="a-empty">No sign-ups yet.</td></tr>'}</tbody>`;
}

// ---------- Sound + alerts ----------
function unlockAudio() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch { /* no audio */ }
  updateSoundButton();
}
function updateSoundButton() {
  const btn = $('[data-sound]');
  const live = audioCtx && audioCtx.state === 'running';
  btn.textContent = !soundOn ? 'Sound off' : live ? 'Sound on' : 'Enable sound';
}
$('[data-sound]').addEventListener('click', () => {
  if (audioCtx?.state === 'running' && soundOn) soundOn = false;
  else { soundOn = true; unlockAudio(); ding(); }
  storage.set('ll_admin_sound', soundOn);
  updateSoundButton();
});
function updateAlertsButton() {
  const btn = $('[data-alerts]');
  btn.hidden = !('Notification' in window) || Notification.permission !== 'default';
}
$('[data-alerts]').addEventListener('click', async () => {
  await Notification.requestPermission();
  updateAlertsButton();
});

function ding() {
  if (!soundOn || !audioCtx || audioCtx.state !== 'running') return;
  const t = audioCtx.currentTime;
  [[988, 0], [1319, 0.18], [988, 0.5], [1319, 0.68]].forEach(([f, d]) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t + d);
    gain.gain.exponentialRampToValueAtTime(0.35, t + d + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.4);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t + d);
    osc.stop(t + d + 0.45);
  });
}

function announce(orders) {
  ding();
  const first = orders[0];
  toast(orders.length === 1 ? `New order #${first.number}: ${money(first.total)}` : `${orders.length} new orders`, { icon: icons.bell, timeout: 5000 });
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(orders.length === 1 ? `New order #${first.number}` : `${orders.length} new orders`, {
        body: first.items.map((l) => `${l.qty}× ${l.name} (${l.size})`).join(', '),
        icon: '/img/icon-192.png',
        tag: `order-${first.id}`,
      });
    } catch { /* ignore */ }
  }
}

// Refresh "age" labels every 30s even if nothing changed.
setInterval(() => { if (data && !$('[data-dash]').hidden) render(); }, 30000);

// Any click on the page unlocks audio (browsers require a gesture).
document.addEventListener('pointerdown', () => { if (soundOn && (!audioCtx || audioCtx.state !== 'running')) unlockAudio(); }, { once: false });

boot().catch(() => showLogin());
