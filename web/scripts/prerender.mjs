// After `vite build`: writes dist/prerendered/<page>.html, the built index.html with each
// public page's HTML already in it. The server sends these to visitors who aren't signed in.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const { PAGES, render } = await import(pathToFileURL(here('../dist-ssr/prerender.js')).href);
const shell = readFileSync(here('../dist/index.html'), 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

mkdirSync(here('../dist/prerendered'), { recursive: true });
for (const p of PAGES) {
  const html = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>\n    <meta name="description" content="${esc(p.description)}" />`)
    .replace('<div id="root"></div>', `<div id="prerender">${render(p.path)}</div><div id="root"></div>`);
  const name = p.path === '/' ? 'index' : p.path.slice(1);
  writeFileSync(here(`../dist/prerendered/${name}.html`), html);
  console.log(`prerendered ${p.path}`);
}
rmSync(here('../dist-ssr'), { recursive: true, force: true });
