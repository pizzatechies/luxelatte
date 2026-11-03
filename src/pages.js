import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal HTML "templating": pages in views/ can include `{{> name}}` to pull in views/partials/name.html.
 * Rendered pages are cached in memory unless `cache` is false (handy while editing).
 */
export function createPages(viewsDir, { cache = true } = {}) {
  const read = (file) => fs.readFileSync(path.join(viewsDir, file), 'utf8');
  const render = (file) => read(file).replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => read(path.join('partials', `${name}.html`)));
  const memo = new Map();

  return function page(file, status = 200) {
    return (req, res) => {
      let html = cache ? memo.get(file) : undefined;
      if (html === undefined) {
        html = render(file);
        if (cache) memo.set(file, html);
      }
      res.status(status).type('html').set('Cache-Control', 'no-cache').send(html);
    };
  };
}
