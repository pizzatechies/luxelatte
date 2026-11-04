// Copies the GitHub Pages build (dist/) to the top of the repo.
//
// Why: while the repo's Pages setting is "Deploy from a branch", GitHub serves the raw branch files,
// so the built site has to live at the repo root for visitors to see it. Once Pages is switched to
// "GitHub Actions" these root copies are no longer needed and can be deleted.
//
//   npm run build:pages
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const ENTRIES = ['.nojekyll', '404.html', 'index.html', 'manifest.webmanifest', 'checkout', 'eatery', 'css', 'js', 'img', 'data'];

for (const name of fs.readdirSync(dist)) {
  if (!ENTRIES.includes(name)) throw new Error(`Unexpected file in dist/: ${name}`);
}
for (const name of ENTRIES) {
  const from = path.join(dist, name);
  if (!fs.existsSync(from)) continue;
  const to = path.join(root, name);
  // data/ is the real source of the menu; it is copied byte-for-byte so nothing changes there.
  if (name !== 'data') fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}
console.log('Copied the Pages build to the repo root.');
