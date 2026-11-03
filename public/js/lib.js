// Shared storefront code: API helpers, cart, header/drawer chrome, toasts, illustrations.

// ---------- Small helpers ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE')}`;

// Static mode = the GitHub Pages build: no server, orders are sent over WhatsApp.
export const STATIC = document.documentElement.dataset.static === '1';
export const BASE = document.documentElement.dataset.base || '';
export const link = (p) => BASE + p;

async function staticApi(path) {
  const get = async (f) => (await fetch(link(`/data/${f}`))).json();
  if (path === '/site') return { ...(await get('site.json')), acceptingOrders: true, closedMessage: '' };
  if (path === '/menu') {
    const menu = await get('menu.json');
    menu.categories.forEach((c) => c.items.forEach((i) => { i.available = i.available !== false; }));
    return menu;
  }
  throw Object.assign(new Error('Not available on this version of the site.'), { status: 404 });
}

/** wa.me link for the shop's WhatsApp number (Kenyan 07/01 numbers become 2547/2541). */
export function whatsappLink(site, text) {
  let n = String(site.contact?.whatsapp || '').replace(/\D/g, '');
  if (n.startsWith('0')) n = '254' + n.slice(1);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

export async function api(path, { method = 'GET', body } = {}) {
  if (STATIC) return staticApi(path);
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.fields = data?.fields;
    throw err;
  }
  return data;
}

const storage = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};
export { storage };

export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

export const clock = (iso) => new Date(iso).toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' });

// ---------- Icons ----------
const ic = (d, extra = '') => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const icons = {
  bag: ic('<path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/>'),
  close: ic('<path d="M6 6l12 12M18 6 6 18"/>'),
  menu: ic('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
  minus: ic('<path d="M5 12h14"/>'),
  check: ic('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  copy: ic('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  arrowLeft: ic('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  arrowRight: ic('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  info: ic('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  clock: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  phone: ic('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
  pin: ic('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  bell: ic('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  party: ic('<path d="M4 20 9 7l8 8-13 5Z"/><path d="M14 4v2M19 9h2M17.5 5.5 16 7M15 2.5l.5.5M21 13l-.5-.5"/>'),
  mpesa: ic('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18.5h4"/><path d="M9 8.5h6M9 12h4"/>'),
};

// ---------- Menu illustrations (inline SVG, tinted per item) ----------
const B = '#8a5d3a';
export function art(item) {
  const c = esc(item?.color || B);
  switch (item?.art) {
    case 'juice':
      return `<svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M17 20 Q32 5 47 20 Z" fill="#fff" fill-opacity=".9" stroke="${B}" stroke-width="2" stroke-linejoin="round"/>
        <path d="M18 23 L46 23 L42.6 57.5 Q42.3 60 39.8 60 L24.2 60 Q21.7 60 21.4 57.5 Z" fill="#fff" stroke="${B}" stroke-width="2" stroke-linejoin="round"/>
        <path d="M19.7 29 L44.3 29 L42 56 Q41.8 57.8 40.2 57.8 L23.8 57.8 Q22.2 57.8 22 56 Z" fill="${c}"/>
        <path d="M24.5 33 L26 52" stroke="#fff" stroke-opacity=".55" stroke-width="2.6" stroke-linecap="round"/>
        <circle cx="36" cy="40" r="1.6" fill="#fff" fill-opacity=".5"/><circle cx="33" cy="47" r="1.1" fill="#fff" fill-opacity=".5"/>
        <path d="M38.5 2.5 L34.5 21" stroke="${B}" stroke-width="3.4" stroke-linecap="round"/>
        <rect x="15" y="19" width="34" height="5" rx="2.5" fill="${B}"/>
      </svg>`;
    case 'espresso':
      return `<svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M28 14 q-2.5 3.5 0 7 q2.5 3.5 0 7" stroke="${B}" stroke-opacity=".45" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <path d="M36 12 q-2.5 3.5 0 7 q2.5 3.5 0 7" stroke="${B}" stroke-opacity=".45" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <ellipse cx="32" cy="54" rx="20" ry="4.8" fill="#ead6c3" stroke="${B}" stroke-width="2"/>
        <path d="M43 40 q8 -1 7.5 5 q-.5 5.5 -9 4.5" fill="none" stroke="${B}" stroke-width="3" stroke-linecap="round"/>
        <path d="M18.5 37 L45.5 37 Q45 52.5 32 52.5 Q19 52.5 18.5 37 Z" fill="#fffaf2" stroke="${B}" stroke-width="2.2" stroke-linejoin="round"/>
        <ellipse cx="32" cy="37" rx="13.5" ry="3.8" fill="${c}" stroke="${B}" stroke-width="2.2"/>
      </svg>`;
    default: {
      const heart = item?.art === 'black' ? '' :
        '<path d="M32 34.2 C26.8 31.7 25.8 29.6 28.2 28.6 C29.8 28 31.2 28.7 32 29.8 C32.8 28.7 34.2 28 35.8 28.6 C38.2 29.6 37.2 31.7 32 34.2Z" fill="#fff8ef"/>';
      return `<svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M25 6 q-3 4 0 8 q3 4 0 8" stroke="${B}" stroke-opacity=".45" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <path d="M34 4 q-3 4 0 8 q3 4 0 8" stroke="${B}" stroke-opacity=".45" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <ellipse cx="32" cy="55" rx="26" ry="5.5" fill="#ead6c3" stroke="${B}" stroke-width="2"/>
        <path d="M50 35 q10 -1 9 7 q-1 7 -12 6" fill="none" stroke="${B}" stroke-width="3.2" stroke-linecap="round"/>
        <path d="M10.5 31 L53.5 31 Q52.5 53.5 32 53.5 Q11.5 53.5 10.5 31 Z" fill="#fffaf2" stroke="${B}" stroke-width="2.2" stroke-linejoin="round"/>
        <path d="M13 40.5 Q32 45 51 40.5" fill="none" stroke="${B}" stroke-opacity=".25" stroke-width="3"/>
        <ellipse cx="32" cy="31" rx="21.5" ry="5.6" fill="${c}" stroke="${B}" stroke-width="2.2"/>
        ${heart}
      </svg>`;
    }
  }
}

// ---------- Site + menu data ----------
let sitePromise;
let menuPromise;
export const getSite = () => (sitePromise ??= api('/site'));
export const getMenu = (fresh = false) => {
  if (fresh || !menuPromise) menuPromise = api('/menu');
  return menuPromise;
};
export function indexMenu(menu) {
  const map = new Map();
  for (const cat of menu.categories) {
    for (const item of cat.items) map.set(item.id, { ...item, category: cat.id, deliverySurcharge: Number(cat.deliverySurcharge) || 0 });
  }
  return map;
}

// ---------- Cart (persisted in localStorage) ----------
const CART_KEY = 'll_cart_v1';
const listeners = new Set();
export const cart = {
  lines: storage.get(CART_KEY, []),
  save() {
    storage.set(CART_KEY, this.lines);
    listeners.forEach((fn) => fn(this.lines));
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  add(itemId, sizeId, qty = 1) {
    const line = this.lines.find((l) => l.itemId === itemId && l.sizeId === sizeId);
    if (line) line.qty = Math.min(20, line.qty + qty);
    else this.lines.push({ itemId, sizeId, qty });
    this.save();
  },
  setQty(itemId, sizeId, qty) {
    this.lines = this.lines
      .map((l) => (l.itemId === itemId && l.sizeId === sizeId ? { ...l, qty: Math.min(20, qty) } : l))
      .filter((l) => l.qty > 0);
    this.save();
  },
  qtyOf(itemId, sizeId) {
    return this.lines.find((l) => l.itemId === itemId && l.sizeId === sizeId)?.qty ?? 0;
  },
  count() { return this.lines.reduce((n, l) => n + l.qty, 0); },
  clear() { this.lines = []; this.save(); },
  /** Joins cart lines with the live menu; drops anything no longer on it. */
  resolve(menuIndex) {
    const out = [];
    for (const l of this.lines) {
      const item = menuIndex.get(l.itemId);
      const size = item?.sizes.find((s) => s.id === l.sizeId);
      if (!item || !size) continue;
      out.push({ ...l, item, size, available: item.available !== false, lineTotal: size.price * l.qty });
    }
    return out;
  },
};
// Keep tabs in sync.
window.addEventListener('storage', (e) => {
  if (e.key === CART_KEY) { cart.lines = storage.get(CART_KEY, []); listeners.forEach((fn) => fn(cart.lines)); }
});

// ---------- Orders placed on this device ----------
const ORDERS_KEY = 'll_orders_v1';
export const myOrders = {
  all: () => storage.get(ORDERS_KEY, []),
  add(order) {
    const list = this.all().filter((o) => o.token !== order.token);
    list.unshift({ token: order.token, number: order.number, total: order.total, createdAt: order.createdAt });
    storage.set(ORDERS_KEY, list.slice(0, 10));
  },
};

// ---------- Toasts ----------
let toastRoot;
export function toast(message, { icon = icons.check, timeout = 2600 } = {}) {
  toastRoot ??= Object.assign(document.body.appendChild(document.createElement('div')), { className: 'toasts' });
  toastRoot.setAttribute('role', 'status');
  toastRoot.setAttribute('aria-live', 'polite');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${icon}<span>${esc(message)}</span>`;
  toastRoot.appendChild(el);
  setTimeout(() => { el.classList.add('out'); el.addEventListener('animationend', () => el.remove(), { once: true }); }, timeout);
}

// ---------- Copy-to-clipboard buttons: <button class="copy" data-copy="714777"> ----------
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: btn.dataset.copy });
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  btn.classList.add('copied');
  const label = btn.querySelector('span');
  const before = label?.textContent;
  if (label) label.textContent = 'Copied';
  setTimeout(() => { btn.classList.remove('copied'); if (label) label.textContent = before; }, 1600);
});

export const copyBtn = (value, label = 'Copy') =>
  `<button type="button" class="copy" data-copy="${esc(value)}" aria-label="Copy ${esc(value)}">${icons.copy}<span>${esc(label)}</span></button>`;

// ---------- Header, nav, cart drawer, footer ----------
export async function initChrome({ cartDrawer = true } = {}) {
  const header = $('.site-header');
  const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const nav = $('#nav');
  const toggle = $('.menu-toggle');
  toggle?.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.innerHTML = open ? icons.close : icons.menu;
  });
  nav?.addEventListener('click', (e) => {
    if (e.target.closest('a')) { nav.classList.remove('is-open'); toggle?.setAttribute('aria-expanded', 'false'); if (toggle) toggle.innerHTML = icons.menu; }
  });

  const year = $('[data-year]');
  if (year) year.textContent = new Date().getFullYear();

  markNav();
  getSite().then(fillFooter).catch(() => {});
  if (cartDrawer) setupDrawer();
}

function fillFooter(site) {
  const contact = $('[data-footer-contact]');
  if (contact) {
    const c = site.contact || {};
    const items = [];
    if (c.address) items.push(c.mapUrl ? `<a href="${esc(c.mapUrl)}" target="_blank" rel="noopener">${esc(c.address)}</a>` : esc(c.address));
    if (c.phone) items.push(`<a href="tel:${esc(c.phone.replace(/\s/g, ''))}">${esc(c.phone)}</a>`);
    if (c.whatsapp) items.push(`<a href="https://wa.me/${esc(c.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp us</a>`);
    if (c.email) items.push(`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`);
    if (c.instagram) items.push(`<a href="https://instagram.com/${esc(c.instagram.replace(/^@/, ''))}" target="_blank" rel="noopener">Instagram</a>`);
    if (c.tiktok) items.push(`<a href="https://www.tiktok.com/@${esc(c.tiktok.replace(/^@/, ''))}" target="_blank" rel="noopener">TikTok</a>`);
    if (items.length) {
      contact.innerHTML = `<h3>Find us</h3><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
      contact.hidden = false;
    }
  }
  const hours = $('[data-footer-hours]');
  if (hours && site.hours?.length) {
    hours.innerHTML = `<h3>Hours</h3><ul>${site.hours.map((h) => `<li>${esc(h.days)}: ${esc(h.time)}</li>`).join('')}</ul>`;
    hours.hidden = false;
  }
  $$('[data-paybill]').forEach((el) => { el.textContent = site.payment.paybill; });
  $$('[data-account]').forEach((el) => { el.textContent = site.payment.account; });
}

function setupDrawer() {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="drawer-backdrop" data-close-cart></div>
    <aside class="drawer" id="cart" role="dialog" aria-modal="true" aria-labelledby="cart-title" tabindex="-1">
      <div class="drawer__head">
        <h2 id="cart-title">Your order</h2>
        <button class="icon-btn" data-close-cart aria-label="Close cart">${icons.close}</button>
      </div>
      <div class="drawer__body" data-cart-body></div>
      <div class="drawer__foot" data-cart-foot></div>
    </aside>
    <button class="cart-bar" data-open-cart aria-label="View cart">
      <span data-cart-bar-text></span><span class="cart-bar__go">View cart</span>
    </button>`);

  const drawer = $('#cart');
  const backdrop = $('.drawer-backdrop');
  let lastFocus = null;

  const open = () => {
    lastFocus = document.activeElement;
    drawer.classList.add('is-open');
    backdrop.classList.add('is-open');
    document.body.classList.add('no-scroll');
    setTimeout(() => drawer.focus(), 50);
  };
  const close = () => {
    drawer.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
    lastFocus?.focus?.();
  };
  window.openCart = open;

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-cart]')) open();
    else if (e.target.closest('[data-close-cart]')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) close();
    if (e.key === 'Tab' && drawer.classList.contains('is-open')) {
      const f = $$('button, a[href], input, [tabindex]:not([tabindex="-1"])', drawer).filter((el) => !el.disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  });

  $('[data-cart-body]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-qty]');
    if (!b) return;
    const { item, size } = b.dataset;
    cart.setQty(item, size, cart.qtyOf(item, size) + Number(b.dataset.qty));
  });

  let menuIndex = new Map();
  const render = () => {
    const lines = cart.resolve(menuIndex);
    const count = lines.reduce((n, l) => n + l.qty, 0);
    const total = lines.reduce((s, l) => s + l.lineTotal, 0);
    $$('[data-cart-count]').forEach((el) => { el.textContent = count; });
    const bar = $('.cart-bar');
    $('[data-cart-bar-text]').textContent = `${count} item${count === 1 ? '' : 's'} · ${money(total)}`;
    const showBar = count > 0 && !document.body.dataset.hideCartBar;
    bar.classList.toggle('is-visible', showBar);
    document.body.classList.toggle('has-cart-bar', showBar);

    const body = $('[data-cart-body]');
    const foot = $('[data-cart-foot]');
    if (!lines.length) {
      body.innerHTML = `<div class="cart-empty">${art({ art: 'milk', color: '#dcc1ae' })}<strong>Your cart is empty</strong><p>Pick a coffee or a Luxe juice to get started.</p><a class="btn btn--ghost btn--sm" href="${link('/#menu')}" data-close-cart>Browse the menu</a></div>`;
      foot.innerHTML = '';
      return;
    }
    body.innerHTML = lines.map((l) => `
      <div class="line">
        <div class="line__art" style="--c:${esc(l.item.color)}">${art(l.item)}</div>
        <div>
          <div class="line__name">${esc(l.item.name)}</div>
          <div class="line__meta">${esc(l.size.label)} · ${money(l.size.price)}${l.available ? '' : ' · <span class="tag tag--soldout">Sold out</span>'}</div>
        </div>
        <div class="line__right">
          <div class="line__total">${money(l.lineTotal)}</div>
          <div class="stepper" role="group" aria-label="Quantity of ${esc(l.item.name)}">
            <button type="button" data-qty="-1" data-item="${esc(l.itemId)}" data-size="${esc(l.sizeId)}" aria-label="Remove one">${l.qty === 1 ? '×' : '−'}</button>
            <span aria-live="polite">${l.qty}</span>
            <button type="button" data-qty="1" data-item="${esc(l.itemId)}" data-size="${esc(l.sizeId)}" aria-label="Add one">+</button>
          </div>
        </div>
      </div>`).join('');
    const blocked = lines.some((l) => !l.available);
    foot.innerHTML = `
      <div class="drawer__total"><span>Subtotal</span><strong>${money(total)}</strong></div>
      ${blocked ? '<p class="form-error" style="margin-bottom:12px">Remove sold-out items to continue.</p>' : ''}
      <a class="btn btn--block btn--lg" href="${link('/checkout')}" ${blocked ? 'aria-disabled="true" style="pointer-events:none;opacity:.5"' : ''}>Checkout ${icons.arrowRight}</a>`;
  };

  cart.onChange(render);
  render();
  getMenu().then((menu) => { menuIndex = indexMenu(menu); render(); }).catch(() => {});
}

export function bumpCartButton() {
  $$('.cart-btn').forEach((b) => { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); });
}

// ---------- "Notify me" forms for the eatery waitlist ----------
export function initNotifyForms() {
  $$('form[data-notify]').forEach((form) => {
    if (STATIC) {
      form.querySelector('.field').hidden = true;
      form.querySelector('button[type="submit"]').textContent = 'Notify me on WhatsApp';
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (STATIC) {
        const site = await getSite();
        window.open(whatsappLink(site, 'Hi Luxe Latte! Please let me know when Burgers & Fries opens.'), '_blank', 'noopener');
        return;
      }
      const input = form.querySelector('input[name="contact"]');
      const btn = form.querySelector('button[type="submit"]');
      const errorEl = form.parentElement.querySelector('[data-notify-error]');
      if (errorEl) errorEl.hidden = true;
      btn.classList.add('is-loading');
      try {
        await api('/waitlist', { method: 'POST', body: { contact: input.value, name: form.querySelector('input[name="name"]')?.value } });
        const done = document.createElement('div');
        done.className = 'notify-done';
        done.setAttribute('role', 'status');
        done.innerHTML = `${icons.check}<span>You’re on the list! We’ll let you know the moment the grill is fired up.</span>`;
        form.replaceWith(done);
      } catch (err) {
        if (errorEl) { errorEl.textContent = err.message; errorEl.hidden = false; } else toast(err.message, { icon: icons.info });
      } finally {
        btn.classList.remove('is-loading');
      }
    });
  });
}

/** Marks the current page's nav link. */
function markNav() {
  const path = location.pathname.slice(BASE.length).replace(/\/$/, '') || '/';
  $$('#nav a').forEach((a) => {
    const href = a.getAttribute('href').slice(BASE.length);
    if (href === path || (href !== '/' && !href.startsWith('/#') && path.startsWith(href))) a.setAttribute('aria-current', 'page');
  });
}
