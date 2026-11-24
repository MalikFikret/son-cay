// Game UI: static checks of the source files (no browser): no npm firebase import, no
// innerHTML-style markup injection, no storage of the Şifre, a strict CSP in index.html, and the
// real Firebase web config only in src/ui/firebase.js (task 4.5a).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);

function uiFiles(dir = new URL('src/ui/', root)) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) files.push(...uiFiles(url));
    else if (entry.name.endsWith('.js')) files.push(url);
  }
  return files;
}

// The code without comments (comments may name what the code must not use).
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const sources = uiFiles().map((url) => ({
  name: url.pathname.split('/src/ui/')[1],
  text: stripComments(readFileSync(url, 'utf8')),
}));

describe('game UI sources', () => {
  test('there are UI modules to check', () => {
    assert.ok(sources.length >= 10);
  });

  test('only the CDN SDK is imported, never the npm "firebase" package', () => {
    for (const { name, text } of sources) {
      assert.doesNotMatch(text, /from\s+['"](firebase|@firebase\/[^'"]*)(\/[^'"]*)?['"]/, name);
      for (const [, spec] of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        assert.ok(spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('https://www.gstatic.com/firebasejs/13.4.0/'), `${name}: ${spec}`);
      }
    }
  });

  test('no innerHTML / outerHTML / insertAdjacentHTML / document.write', () => {
    for (const { name, text } of sources) {
      assert.doesNotMatch(text, /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/, name);
    }
  });

  test('only memory.js (the table code) and i18n/i18n.js (the language) touch browser storage', () => {
    for (const { name, text } of sources) {
      if (name === 'memory.js' || name === 'i18n/i18n.js') continue;
      assert.doesNotMatch(text, /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/, name);
    }
    const memory = sources.find((s) => s.name === 'memory.js').text;
    assert.equal([...memory.matchAll(/setItem\(/g)].length, 1);
    assert.match(memory, /setItem\(KEY, code\)/);
    // The language choice: one localStorage entry, nothing else.
    const i18n = sources.find((s) => s.name === 'i18n/i18n.js').text;
    assert.equal([...i18n.matchAll(/setItem\(/g)].length, 1);
    assert.match(i18n, /localStorage\?\.setItem\(STORAGE_KEY, lang\)/);
    assert.doesNotMatch(i18n, /\b(sessionStorage|indexedDB|document\.cookie)\b/);
  });
});

describe('index.html', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  const directives = Object.fromEntries((csp ?? '').split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));

  test('has a strict Content-Security-Policy', () => {
    assert.ok(csp, 'CSP meta tag');
    assert.deepEqual(directives['default-src'], ["'none'"]);
    assert.deepEqual(directives['script-src'], ["'self'", 'https://www.gstatic.com']);
    assert.deepEqual(directives['style-src'], ["'self'", 'https://fonts.googleapis.com']);
    assert.deepEqual(directives['font-src'], ["'self'", 'https://fonts.gstatic.com']);
    assert.deepEqual(directives['img-src'], ["'self'"]);
    assert.deepEqual(directives['base-uri'], ["'none'"]);
    assert.deepEqual(directives['form-action'], ["'none'"]);
    assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
  });

  test('connects only to the local emulators and to what the real project needs, each host once', () => {
    assert.deepEqual(directives['connect-src'], [
      // localhost: the emulators
      'http://127.0.0.1:9099',
      'http://127.0.0.1:9000',
      'ws://127.0.0.1:9000',
      // production: anonymous sign-in (sign-up / lookup, token refresh)
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
      // production: the Realtime Database (HTTPS, its WebSocket, the server the handshake names)
      'https://son-cay-default-rtdb.europe-west1.firebasedatabase.app',
      'wss://son-cay-default-rtdb.europe-west1.firebasedatabase.app',
      'wss://*.europe-west1.firebasedatabase.app',
    ]);
    // Every added host is explained in the comment above the tag.
    const comment = html.match(/<!-- Content-Security-Policy:([\s\S]*?)-->/)?.[1] ?? '';
    for (const source of directives['connect-src'].slice(3)) assert.ok(comment.includes(source), `${source} is explained`);
  });

  test('sends only the origin as referrer (the API key is restricted to the website)', () => {
    const tags = html.match(/<meta name="referrer"[^>]*>/g) ?? [];
    assert.deepEqual(tags, ['<meta name="referrer" content="strict-origin">']);
  });

  test('uses only relative paths (the site lives under /son-cay/, not at the domain root)', () => {
    for (const [, attr, value] of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
      assert.ok(!value.startsWith('/'), `${attr}="${value}" is root-absolute`);
      assert.ok(value.startsWith('https://') || !value.includes(':'), `${attr}="${value}"`);
    }
  });

  test('is Turkish, left to right, and loads the UI entry module', () => {
    assert.match(html, /<html lang="tr" dir="ltr">/);
    assert.match(html, /<script type="module" src="src\/ui\/app\.js"><\/script>/);
    assert.doesNotMatch(html, /\sstyle="/);
  });
});

describe('the real Firebase web config', () => {
  // Patterns, not values: this test must not contain the config itself.
  const API_KEY = /AIza[0-9A-Za-z_-]{30,}/;
  const APP_ID = /\d+:\d{6,}:web:[0-9a-f]+/;
  const SKIP = new Set(['node_modules', '.git', 'docs', '.firebase', '.claude']);
  function repoFiles(dir = root) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) files.push(...repoFiles(url));
      else if (/\.(js|mjs|json|html|md|css|svg|txt|yml|yaml|rules)$/.test(entry.name) || entry.name.startsWith('.')) files.push(url);
    }
    return files;
  }

  test('lives only in src/ui/firebase.js', () => {
    const found = repoFiles()
      .filter((url) => {
        const text = readFileSync(url, 'utf8');
        return API_KEY.test(text) || APP_ID.test(text);
      })
      .map((url) => url.pathname.slice(root.pathname.length));
    assert.deepEqual(found, ['src/ui/firebase.js']);
  });

  test('production uses the real project and its database; localhost a demo- project', () => {
    const text = readFileSync(new URL('src/ui/firebase.js', root), 'utf8');
    assert.match(text, /const PRODUCTION_PROJECT_ID = 'son-cay';/);
    assert.match(text, /const PRODUCTION_DATABASE_URL = 'https:\/\/son-cay-default-rtdb\.europe-west1\.firebasedatabase\.app';/);
    assert.match(text, /const EMULATOR_PROJECT_ID = 'demo-mosul-roulette';/);
    assert.match(text, /forceWebSockets\(\);/);
    assert.match(text, /export const REMEMBER_PER_TAB = IS_EMULATOR;/);
    // The emulators are connected only for the emulator target.
    assert.match(text, /if \(IS_EMULATOR\) connectAuthEmulator\(/);
    assert.match(text, /if \(IS_EMULATOR\) connectDatabaseEmulator\(/);
  });
});

describe('paths under a sub-path (GitHub Pages serves the game at /son-cay/)', () => {
  // Every module, stylesheet and asset the browser loads lives under src/ and is reached with a
  // relative path; a root-absolute "/..." would point outside /son-cay/.
  function files(dir, ext) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) out.push(...files(url, ext));
      else if (ext.test(entry.name)) out.push(url);
    }
    return out;
  }

  test('no module import or dynamic import starts with "/"', () => {
    for (const url of files(new URL('src/', root), /\.js$/)) {
      const text = readFileSync(url, 'utf8');
      for (const [, spec] of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        assert.ok(!spec.startsWith('/'), `${url.pathname}: import "${spec}"`);
        assert.ok(spec.startsWith('.') || spec.startsWith('https://www.gstatic.com/'), `${url.pathname}: import "${spec}"`);
      }
      assert.doesNotMatch(text, /\b(fetch|navigate|pushState|replaceState)\([^)]*['"`]\//, `${url.pathname}: a root-absolute address`);
    }
  });

  test('no stylesheet url() starts with "/"', () => {
    for (const url of files(new URL('src/', root), /\.css$/)) {
      for (const [, value] of readFileSync(url, 'utf8').matchAll(/url\(\s*['"]?([^'")]+)/g)) {
        assert.ok(!value.startsWith('/'), `${url.pathname}: url(${value})`);
      }
    }
  });
});

describe('Hakkında', async () => {
  const text = readFileSync(new URL('src/ui/screens/about.js', root), 'utf8');
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const { default: tr } = await import('../src/ui/i18n/tr.js');

  test('shows the version number only (no commit hash) and no "Kaynak kodu" button', () => {
    assert.match(text, /import \{ VERSION \} from '\.\.\/version\.js';/);
    assert.doesNotMatch(stripComments(text), /\bCOMMIT\b/);
    assert.doesNotMatch(text, /Kaynak kodu|SOURCE_URL/);
  });

  test('the description and the meta description', () => {
    assert.equal(tr.about.intro, 'Arkadaşlarınla çevrimiçi oynanan bir taktik ve biraz da şans oyunu. Tabanca masanın ortasında döner, malzemeler oyunu değiştirir, son çay kimde kalırsa o kazanır.');
    assert.match(text, /text: t\('about\.intro'\)/);
    assert.ok(html.includes('<meta name="description" content="Son Çay: arkadaşlarınla çevrimiçi oynanan bir taktik ve biraz da şans oyunu.">'));
    // The page sets the same description from the locale at start (i18n.js).
    assert.ok(html.includes(`<meta name="description" content="${tr.meta.description}">`));
    assert.ok(html.includes(`<title>${tr.app.name}</title>`));
    assert.match(html, new RegExp(`<html lang="${tr.meta.language}"`));
  });
});
