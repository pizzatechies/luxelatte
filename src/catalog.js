import fs from 'node:fs';
import path from 'node:path';

export function loadJson(dir, name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
}

/** Indexes the menu so orders can be priced on the server, never trusting client prices. */
export function createCatalog(menu) {
  const items = new Map();
  for (const cat of menu.categories) {
    for (const item of cat.items) {
      if (items.has(item.id)) throw new Error(`Duplicate menu item id: ${item.id}`);
      items.set(item.id, { ...item, category: cat.id, deliverySurcharge: Number(cat.deliverySurcharge) || 0 });
    }
  }
  return {
    menu,
    get: (id) => items.get(id),
    ids: () => [...items.keys()],
    /** Menu with live availability (sold-out toggles from the dashboard) merged in. */
    withAvailability(availability) {
      return {
        currency: menu.currency,
        categories: menu.categories.map((cat) => ({
          ...cat,
          items: cat.items.map((item) => ({ ...item, available: availability[item.id] ?? true })),
        })),
      };
    },
  };
}
