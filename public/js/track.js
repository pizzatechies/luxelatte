import { $, esc, money, api, initChrome, myOrders, timeAgo } from './lib.js';

initChrome();

const LABEL = { received: 'Received', preparing: 'Preparing', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' };

async function renderRecent() {
  const mine = myOrders.all();
  if (!mine.length) return;
  $('[data-recent-card]').hidden = false;
  const list = $('[data-recent]');
  list.innerHTML = mine.map((o) => `
    <li><a href="/order/${encodeURIComponent(o.token)}" data-token="${esc(o.token)}">
      <div><div class="n">#${o.number}</div><div class="m">${esc(timeAgo(o.createdAt))} · ${money(o.total)}</div></div>
      <span class="status-pill st-received" data-status>Checking…</span>
    </a></li>`).join('');

  await Promise.all(mine.map(async (o) => {
    const pill = list.querySelector(`[data-token="${CSS.escape(o.token)}"] [data-status]`);
    try {
      const { order } = await api(`/orders/${encodeURIComponent(o.token)}`);
      pill.className = `status-pill st-${order.status}`;
      pill.textContent = LABEL[order.status] || order.status;
    } catch {
      pill.closest('li').remove();
    }
  }));
  if (!list.children.length) $('[data-recent-card]').hidden = true;
}

$('[data-lookup]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const err = $('[data-lookup-error]');
  err.hidden = true;
  const btn = form.querySelector('button');
  btn.classList.add('is-loading');
  try {
    const { token } = await api('/orders/lookup', { method: 'POST', body: { number: form.number.value, phone: form.phone.value } });
    location.href = `/order/${encodeURIComponent(token)}`;
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    btn.classList.remove('is-loading');
  }
});

renderRecent();
