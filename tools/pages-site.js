// Builds the folder GitHub Pages publishes (task 4.5b) and checks it. Plain Node, no dependencies.
//
// Usage (project root): node tools/pages-site.js [outDir]   (default: _site)
//
// The browser loads ONLY index.html and what it references under src/ (src/ui/app.js and its
// imports in src/ui/, src/rooms/, src/engine/; src/ui/style.css; the SVG icons). So the site is
// exactly index.html + src/, nothing else: never dev/, tests/, tests-firebase/, tools/, docs/,
// node_modules/, database.rules.json, firebase.json, package files, CLAUDE.md or any .env.
// The check after the copy fails (exit code 1) if anything else is in the folder, if a forbidden
// name appears anywhere in it, or if a file under src/ is not a .js, .css, .svg or .mp3 file.
//
// Version stamp (step 4.4c follow-up): the published COPY gets `?v=<stamp>` on every same-site
// URL (see "Version stamp" below); the sources in the repository never change, and local dev
// serves them with plain URLs.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

/** The only top-level entries of the published folder. */
export const PUBLISHED = Object.freeze(['index.html', 'src']);

/** Names that must never appear anywhere in the published folder (files or folders). */
export const FORBIDDEN = Object.freeze([
  'dev', 'tests', 'tests-firebase', 'tools', 'docs', 'node_modules', '.git', '.github', '.claude',
  '.firebase', 'database.rules.json', 'firebase.json', 'package.json', 'package-lock.json',
  'CLAUDE.md', 'README.md', '.firebaserc', '.gitignore', '.gitattributes',
]);

const ALLOWED_IN_SRC = /\.(js|css|svg|mp3)$/; // mp3: the shot sounds in src/ui/audio/ (Q78)

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(path, ...walk(path));
    else out.push(path);
  }
  return out;
}

/**
 * Checks a built folder. Returns the list of problems (empty when the folder is fine).
 * @param {string} outDir
 * @returns {string[]}
 */
export function checkSite(outDir) {
  const problems = [];
  const top = readdirSync(outDir).sort();
  if (JSON.stringify(top) !== JSON.stringify([...PUBLISHED].sort())) {
    problems.push(`top level must be exactly ${PUBLISHED.join(', ')}; found: ${top.join(', ')}`);
  }
  for (const path of walk(outDir)) {
    const rel = relative(outDir, path);
    const parts = rel.split(sep);
    for (const part of parts) {
      if (FORBIDDEN.includes(part) || part.startsWith('.env')) problems.push(`forbidden in the site: ${rel}`);
      else if (part.startsWith('.')) problems.push(`hidden file in the site: ${rel}`);
    }
    if (parts[0] === 'src' && statSync(path).isFile() && !ALLOWED_IN_SRC.test(path)) {
      problems.push(`unexpected file type in src/: ${rel}`);
    }
  }
  return problems;
}

// --- Version stamp -------------------------------------------------------------------------------
// Why: GitHub Pages serves every file with Cache-Control max-age=600 and no way to change it. A
// browser that had the game open before a deploy can then load a NEW module next to an OLD cached
// one (seen live after dc80963: the new sounds.js with the old device-settings.js, "does not provide
// an export named 'SOUND_IDS'", a broken game for up to ten minutes). So the published copy puts
// `?v=<stamp>` (the deployed commit, from src/ui/version.js) on every same-site URL: index.html's
// script / stylesheet / icon, every relative module specifier (static import / export ... from,
// dynamic import()), every `new URL('./...', import.meta.url)` asset (the shot sounds) and every
// CSS url(). The server ignores the query, but the browser caches by the full URL, so:
// - an old cached index.html loads app.js?v=OLD (fresh from the server: the new app.js, unless
//   that exact URL is cached), whose imports all carry the NEW stamp: one whole new module graph;
// - a fully cached old page stays fully old (all its URLs carry the old stamp).
// Only relative URLs are touched ('./', '../', or a bare same-site path in HTML / CSS); absolute
// URLs (the Firebase CDN, Google Fonts), protocol-relative, root-absolute, data: and #fragments
// never are. checkStamps() walks the built module graph and fails the build on any miss.

const STAMP_RE = /^[0-9A-Za-z._-]{4,40}$/;

/**
 * The stamp for a build: COMMIT from src/ui/version.js (written by `npm run version:write`), or,
 * without one (no git), a short hash of index.html + src/ so a changed build still gets a new one.
 * @param {string} [sourceRoot] the folder holding index.html and src/ (default: the project)
 */
export function siteStamp(sourceRoot = root) {
  try {
    const text = readFileSync(join(sourceRoot, 'src', 'ui', 'version.js'), 'utf8');
    const commit = text.match(/export const COMMIT = "([0-9a-f]{4,40})";/)?.[1];
    if (commit) return commit;
  } catch {
    // No version file: fall back to the content hash.
  }
  const hash = createHash('sha256');
  for (const path of [join(sourceRoot, 'index.html'), ...walk(join(sourceRoot, 'src')).sort()]) {
    if (statSync(path).isFile()) hash.update(relative(sourceRoot, path)).update(readFileSync(path));
  }
  return `h${hash.digest('hex').slice(0, 12)}`;
}

/** A same-site relative URL (not absolute, protocol-relative, root-absolute, data: or #...). */
export function isRelativeUrl(url) {
  return typeof url === 'string' && url.length > 0 && !/^[a-z][a-z0-9+.-]*:/i.test(url)
    && !url.startsWith('//') && !url.startsWith('/') && !url.startsWith('#');
}

/** `url` with `v=<stamp>` added to its query (before any #fragment). */
export function withStamp(url, stamp) {
  const hashAt = url.indexOf('#');
  const [base, fragment] = hashAt === -1 ? [url, ''] : [url.slice(0, hashAt), url.slice(hashAt)];
  return `${base}${base.includes('?') ? '&' : '?'}v=${stamp}${fragment}`;
}

// A relative module / asset specifier inside quotes, without a query yet.
const SPEC = String.raw`(\.{1,2}\/[^'"\n?#]*)`;
const JS_PATTERNS = [
  // import x from './a.js', import { a,\n b } from './a.js', export * from './a.js'
  new RegExp(String.raw`(\bfrom\s*)(['"])${SPEC}\2`, 'g'),
  // import './a.js' (side effect only)
  new RegExp(String.raw`(\bimport\s*)(['"])${SPEC}\2`, 'g'),
  // import('./a.js')
  new RegExp(String.raw`(\bimport\s*\(\s*)(['"])${SPEC}\2`, 'g'),
  // new URL('./audio/x.mp3', import.meta.url)
  new RegExp(String.raw`(\bnew\s+URL\(\s*)(['"])${SPEC}\2(?=\s*,\s*import\.meta\.url)`, 'g'),
];

/** A JS module's text with every relative specifier and import.meta.url asset stamped. */
export function stampJs(text, stamp) {
  let out = text;
  for (const pattern of JS_PATTERNS) {
    out = out.replace(pattern, (whole, before, quote, spec) => `${before}${quote}${withStamp(spec, stamp)}${quote}`);
  }
  return out;
}

/** index.html with the same-site src / href of its <script> and <link> tags stamped. */
export function stampHtml(text, stamp) {
  return text.replace(/<(script|link)\b[^>]*>/gi, (tag) => tag.replace(/\b(src|href)="([^"]*)"/gi,
    (whole, name, url) => (isRelativeUrl(url) ? `${name}="${withStamp(url, stamp)}"` : whole)));
}

/** A stylesheet with every same-site url(...) stamped. */
export function stampCss(text, stamp) {
  return text.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g,
    (whole, quote, url) => (isRelativeUrl(url) ? `url(${quote}${withStamp(url, stamp)}${quote})` : whole));
}

/** Stamps the built copy in place (index.html, src/**: .js and .css). */
function stampSite(outDir, stamp) {
  const edit = (path, fn) => writeFileSync(path, fn(readFileSync(path, 'utf8'), stamp));
  edit(join(outDir, 'index.html'), stampHtml);
  for (const path of walk(join(outDir, 'src'))) {
    if (path.endsWith('.js')) edit(path, stampJs);
    else if (path.endsWith('.css')) edit(path, stampCss);
  }
}

// --- The stamp check: every same-site reference, from index.html through the whole graph ------
const ANY_SPEC = String.raw`(\.{1,2}\/[^'"\n]*)`;
const JS_REFS = [
  new RegExp(String.raw`\bfrom\s*(['"])${ANY_SPEC}\1`, 'g'),
  new RegExp(String.raw`\bimport\s*(['"])${ANY_SPEC}\1`, 'g'),
  new RegExp(String.raw`\bimport\s*\(\s*(['"])${ANY_SPEC}\1`, 'g'),
  new RegExp(String.raw`\bnew\s+URL\(\s*(['"])${ANY_SPEC}\1(?=\s*,\s*import\.meta\.url)`, 'g'),
];

/** The relative references of a JS module (comment lines and blocks ignored). */
export function jsReferences(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const refs = [];
  for (const pattern of JS_REFS) for (const match of code.matchAll(pattern)) refs.push(match[2]);
  return refs;
}

function htmlReferences(text) {
  const refs = [];
  for (const tag of text.matchAll(/<(script|link)\b[^>]*>/gi)) {
    for (const attr of tag[0].matchAll(/\b(src|href)="([^"]*)"/gi)) if (isRelativeUrl(attr[2])) refs.push(attr[2]);
  }
  return refs;
}

function cssReferences(text) {
  return [...text.matchAll(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g)].map((m) => m[2]).filter(isRelativeUrl);
}

/**
 * Walks the built site from index.html through every reference (modules, stylesheets, assets)
 * and returns the problems: a reference without exactly `?v=<stamp>`, a target that does not
 * exist, or a .js / .css file under src/ with an unstamped relative reference even if nothing
 * reaches it.
 * @returns {string[]}
 */
export function checkStamps(outDir, stamp) {
  const problems = [];
  const suffix = `?v=${stamp}`;
  const seen = new Set();
  const refsOf = (rel, text) => (rel.endsWith('.html') ? htmlReferences(text)
    : rel.endsWith('.css') ? cssReferences(text) : rel.endsWith('.js') ? jsReferences(text) : []);
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const path = join(outDir, ...rel.split('/'));
    if (!existsSync(path)) {
      problems.push(`missing file referenced in the site: ${rel}`);
      return;
    }
    if (!/\.(html|js|css)$/.test(rel)) return;
    for (const ref of refsOf(rel, readFileSync(path, 'utf8'))) {
      if (!ref.endsWith(suffix) || ref.indexOf('?') !== ref.length - suffix.length) {
        problems.push(`not stamped with ${suffix}: ${ref} in ${rel}`);
        continue;
      }
      visit(posix.normalize(posix.join(posix.dirname(rel), ref.slice(0, -suffix.length))));
    }
  };
  visit('index.html');
  if (!seen.has('src/ui/app.js')) problems.push('index.html does not load src/ui/app.js');
  // Files nothing reaches yet must still be stamped (a later dynamic import would mix versions).
  for (const path of walk(join(outDir, 'src'))) {
    if (!/\.(js|css)$/.test(path)) continue;
    const rel = relative(outDir, path).split(sep).join('/');
    for (const ref of refsOf(rel, readFileSync(path, 'utf8'))) {
      if (!ref.endsWith(suffix)) problems.push(`not stamped with ${suffix}: ${ref} in ${rel}`);
    }
  }
  return [...new Set(problems)];
}

/**
 * Builds the site into outDir (emptied first), stamps the copy and checks it.
 * @param {string} outDir
 * @param {{ stamp?: string }} [options] the stamp (default: siteStamp(), the deployed commit)
 * @returns {string[]} the problems found (empty when the folder is fine)
 */
export function buildSite(outDir, { stamp = siteStamp() } = {}) {
  if (!STAMP_RE.test(stamp)) throw new Error(`invalid version stamp ${JSON.stringify(stamp)}`);
  const out = resolve(outDir);
  if (out === resolve(root) || !relative(resolve(root), out).length) throw new Error('refusing to build into the project root');
  if (existsSync(out)) rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, 'index.html'), join(out, 'index.html'));
  cpSync(join(root, 'src'), join(out, 'src'), { recursive: true });
  stampSite(out, stamp);
  return [...checkSite(out), ...checkStamps(out, stamp)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2] ?? join(root, '_site');
  const problems = buildSite(outDir);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log(`Site built in ${outDir}: ${PUBLISHED.join(' + ')}, stamped ?v=${siteStamp()}`);
}
