// Builds the folder GitHub Pages publishes (task 4.5b) and checks it. Plain Node, no dependencies.
//
// Usage (project root): node tools/pages-site.js [outDir]   (default: _site)
//
// The browser loads ONLY index.html and what it references under src/ (src/ui/app.js and its
// imports in src/ui/, src/rooms/, src/engine/; src/ui/style.css; the SVG icons). So the site is
// exactly index.html + src/, nothing else: never dev/, tests/, tests-firebase/, tools/, docs/,
// node_modules/, database.rules.json, firebase.json, package files, CLAUDE.md or any .env.
// The check after the copy fails (exit code 1) if anything else is in the folder, if a forbidden
// name appears anywhere in it, or if a file under src/ is not a .js, .css or .svg file.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

/** The only top-level entries of the published folder. */
export const PUBLISHED = Object.freeze(['index.html', 'src']);

/** Names that must never appear anywhere in the published folder (files or folders). */
export const FORBIDDEN = Object.freeze([
  'dev', 'tests', 'tests-firebase', 'tools', 'docs', 'node_modules', '.git', '.github', '.claude',
  '.firebase', 'database.rules.json', 'firebase.json', 'package.json', 'package-lock.json',
  'CLAUDE.md', 'README.md', '.firebaserc', '.gitignore', '.gitattributes',
]);

const ALLOWED_IN_SRC = /\.(js|css|svg)$/;

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

/**
 * Builds the site into outDir (emptied first) and checks it.
 * @param {string} outDir
 * @returns {string[]} the problems found (empty when the folder is fine)
 */
export function buildSite(outDir) {
  const out = resolve(outDir);
  if (out === resolve(root) || !relative(resolve(root), out).length) throw new Error('refusing to build into the project root');
  if (existsSync(out)) rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, 'index.html'), join(out, 'index.html'));
  cpSync(join(root, 'src'), join(out, 'src'), { recursive: true });
  return checkSite(out);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2] ?? join(root, '_site');
  const problems = buildSite(outDir);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log(`Site built in ${outDir}: ${PUBLISHED.join(' + ')}`);
}
