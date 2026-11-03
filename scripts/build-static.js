// Builds the GitHub Pages version of the site into dist/.
// There is no server on GitHub Pages, so this version sends orders to the shop over WhatsApp
// and leaves out the dashboard, live tracking and waitlist storage.
//
//   node scripts/build-static.js --base /luxelatte
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const baseArg = process.argv.indexOf('--base');
const base = (baseArg > -1 ? process.argv[baseArg + 1] : '').replace(/\/$/, '');

const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const write = (rel, content) => {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const renderPage = (file) =>
  read('views', file).replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => read('views', 'partials', `${name}.html`));

function toStatic(html) {
  return html
    .replace('<html lang="en">', `<html lang="en" data-static="1" data-base="${base}">`)
    // No server-side tracking on GitHub Pages.
    .replace(/\s*<a href="\/track">Track order<\/a>/, '')
    .replace(/\s*<li><a href="\/track">Track an order<\/a><\/li>/, '')
    .replace('Order ahead, pay with M-Pesa, and we’ll have it ready when you arrive.', 'Order ahead on WhatsApp, pay with M-Pesa, and we’ll have it ready when you arrive.')
    .replace(/then pop in your confirmation code\. Or pay at the counter\./, 'and share the M-Pesa message with us on WhatsApp. Or pay at the counter.')
    .replace('Watch your order go from received to ready on your tracking page, then come grab it.', 'We’ll message you on WhatsApp when it’s ready. Then come grab it.')
    .replace('<h3>Pick your drinks</h3>', '<h3>Pick &amp; send</h3>')
    .replace('Add a note if you like it a certain way.', 'Checkout sends your order to us on WhatsApp.')
    // Point absolute links at the GitHub Pages sub-path.
    .replace(/(href|src)="\/(?!\/)/g, `$1="${base}/`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true });

// CSS and manifest reference /img/... too.
write('css/style.css', read('public', 'css', 'style.css').replace(/url\("\/img\//g, `url("${base}/img/`));
const manifest = JSON.parse(read('public', 'manifest.webmanifest'));
manifest.start_url = `${base}/`;
manifest.icons.forEach((i) => { i.src = base + i.src; });
write('manifest.webmanifest', JSON.stringify(manifest, null, 2));

// Menu + site settings are fetched as JSON by the browser.
write('data/menu.json', read('data', 'menu.json'));
write('data/site.json', read('data', 'site.json'));

write('index.html', toStatic(renderPage('index.html')));
write('checkout/index.html', toStatic(renderPage('checkout.html')));
write('eatery/index.html', toStatic(renderPage('eatery.html')));
write('404.html', toStatic(renderPage('404.html')));
write('.nojekyll', '');

// Server-only scripts aren't needed.
for (const f of ['admin.js', 'order.js', 'track.js']) fs.rmSync(path.join(out, 'js', f), { force: true });
fs.rmSync(path.join(out, 'css', 'admin.css'), { force: true });

console.log(`Built static site in dist/ (base "${base || '/'}")`);
