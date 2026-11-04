import { $, $$, esc, money, art, cart, getMenu, getSite, initChrome, initNotifyForms, toast, bumpCartButton, icons, link } from './lib.js';

initChrome();
initNotifyForms();

const boardsEl = $('[data-boards]');
const navEl = $('[data-menu-nav]');

function renderMenu(menu) {
  navEl.innerHTML = menu.categories
    .map((c, i) => `<a href="#cat-${esc(c.id)}" class="${i === 0 ? 'is-active' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</a>`)
    .join('');

  boardsEl.innerHTML = menu.categories.map((cat) => `
    <section class="board ${cat.layout ? `board--${esc(cat.layout)}` : ''}" id="cat-${esc(cat.id)}" aria-labelledby="cat-${esc(cat.id)}-title">
      <div class="board__badge"><img src="${link('/img/logo-mark.png')}" alt="" width="50" height="50"></div>
      <header class="board__head">
        <h3 id="cat-${esc(cat.id)}-title">${esc(cat.name)}</h3>
        <p>${esc(cat.tagline || '')}</p>
      </header>
      <ul class="board__list">
        ${cat.items.map((item) => `
          <li class="row ${item.available ? '' : 'is-soldout'}">
            <div class="row__art" style="--c:${esc(item.color)}">${art(item)}</div>
            <div class="row__text">
              <div class="row__name">${esc(item.name)}
                ${item.available ? (item.featured ? '<span class="tag tag--fav">Fan fave</span>' : '') : '<span class="tag tag--soldout">Sold out</span>'}
              </div>
              <p class="row__desc">${esc(item.description || '')}</p>
            </div>
            <div class="row__prices">
              ${item.sizes.map((s) => `
                <button type="button" class="price-btn" data-add data-item="${esc(item.id)}" data-size="${esc(s.id)}"
                  ${item.available ? '' : 'disabled'} aria-label="Add ${esc(s.label)} ${esc(item.name)}, ${money(s.price)}">
                  <small>${esc(s.label)}</small><strong>${s.price}</strong>
                </button>`).join('')}
            </div>
          </li>`).join('')}
      </ul>
      <p class="board__hint">${icons.info}<span>Prices in KES. Tap a price to add.${cat.deliverySurcharge ? ` Delivered ${esc(cat.name.toLowerCase())} +${cat.deliverySurcharge} each.` : ''}</span></p>
    </section>`).join('');

  syncBadges();
  watchCategories();
}

/** Small count badges on price buttons that are already in the cart. */
function syncBadges() {
  $$('[data-add]').forEach((btn) => {
    const qty = cart.qtyOf(btn.dataset.item, btn.dataset.size);
    let badge = btn.querySelector('.qty-badge');
    if (qty > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'qty-badge';
        btn.appendChild(badge);
      }
      badge.textContent = `×${qty}`;
    } else badge?.remove();
  });
}

let menuIndex = new Map();

boardsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-add]');
  if (!btn || btn.disabled) return;
  const { item: itemId, size: sizeId } = btn.dataset;
  cart.add(itemId, sizeId);
  btn.classList.remove('added');
  void btn.offsetWidth;
  btn.classList.add('added');
  bumpCartButton();
  const item = menuIndex.get(itemId);
  const size = item?.sizes.find((s) => s.id === sizeId);
  if (item && size) toast(`Added ${size.label} ${item.name}`);
});

cart.onChange(syncBadges);

function watchCategories() {
  const links = $$('[data-cat]', navEl);
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const id = entry.target.id.replace('cat-', '');
      links.forEach((a) => a.classList.toggle('is-active', a.dataset.cat === id));
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('.board', boardsEl).forEach((b) => io.observe(b));
}

getMenu()
  .then((menu) => {
    menuIndex = new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.id, i])));
    renderMenu(menu);
  })
  .catch(() => {
    boardsEl.innerHTML = '<div class="form-error">We couldn’t load the menu. Please refresh the page.</div>';
  });

getSite().then((site) => {
  if (!site.acceptingOrders) {
    const banner = $('[data-closed-banner]');
    banner.innerHTML = `${icons.clock}<span>${esc(site.closedMessage || 'We’re not taking online orders right now, but you can still order at the counter.')}</span>`;
    banner.hidden = false;
  }
}).catch(() => {});
