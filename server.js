import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './src/db.js';
import { createCatalog, loadJson } from './src/catalog.js';
import { createApp } from './src/app.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
const storageDir = process.env.STORAGE_DIR || path.join(root, 'storage');

const site = loadJson(dataDir, 'site.json');
const catalog = createCatalog(loadJson(dataDir, 'menu.json'));
const store = openDatabase(path.join(storageDir, 'luxelatte.db'));

let adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  adminPassword = crypto.randomBytes(6).toString('base64url');
  console.warn(`\n  ADMIN_PASSWORD is not set. Temporary dashboard password for this run: ${adminPassword}\n`);
}

const app = createApp({
  store,
  catalog,
  site,
  publicDir: path.join(root, 'public'),
  viewsDir: path.join(root, 'views'),
  cachePages: process.env.NODE_ENV === 'production',
  adminPassword,
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  tzOffsetMinutes: Number(process.env.TZ_OFFSET_MINUTES ?? 180),
  trustProxy: process.env.TRUST_PROXY ? (Number.isNaN(Number(process.env.TRUST_PROXY)) ? process.env.TRUST_PROXY : Number(process.env.TRUST_PROXY)) : false,
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Luxe Latte is brewing on http://localhost:${port}  (dashboard: /admin)`);
});
