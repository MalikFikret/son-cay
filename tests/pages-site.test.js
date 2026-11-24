// The GitHub Pages site (task 4.5b): tools/pages-site.js publishes ONLY index.html + src/, its
// check fails when anything else slips in (dev/, tests/, config files), and the workflow
// .github/workflows/pages.yml is wired as required. The version stamp (step 4.4c follow-up): every
// same-site URL of the published copy carries ?v=<commit>, absolute URLs never, the sources stay
// unchanged, and a walk of the built module graph fails on any unstamped reference. No network;
// builds into a temp folder.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  FORBIDDEN, PUBLISHED, buildSite, checkSite, checkStamps, isRelativeUrl, jsReferences, siteStamp, stampCss,
  stampHtml, stampJs, withStamp,
} from '../tools/pages-site.js';

const root = new URL('../', import.meta.url);

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, base));
    else out.push(path.slice(base.length + 1).replaceAll('\\', '/'));
  }
  return out;
}

describe('the published folder', () => {
  test('contains exactly index.html and src/ (every file under src/), nothing else', () => {
    const out = mkdtempSync(join(tmpdir(), 'son-cay-site-'));
    try {
      assert.deepEqual(buildSite(out), []);
      assert.deepEqual(readdirSync(out).sort(), ['index.html', 'src']);
      const published = walk(out).sort();
      const source = walk(fileURLToPath(new URL('src', root))).map((p) => `src/${p}`);
      assert.deepEqual(published, ['index.html', ...source].sort());
      for (const path of published) assert.ok(path === 'index.html' || /^src\/.+\.(js|css|svg|mp3)$/.test(path), path);
      assert.ok(published.includes('src/ui/app.js'));
      assert.ok(published.includes('src/engine/index.js'));
      assert.ok(published.includes('src/rooms/index.js'));
      // The shot sounds (decision Q78), fetched by src/ui/sounds.js.
      assert.ok(published.includes('src/ui/audio/shot-loaded.mp3'));
      assert.ok(published.includes('src/ui/audio/shot-empty.mp3'));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test('the check fails if dev/, tests/ or a config file slips in', () => {
    const out = mkdtempSync(join(tmpdir(), 'son-cay-site-'));
    try {
      assert.deepEqual(buildSite(out), []);
      mkdirSync(join(out, 'dev'));
      writeFileSync(join(out, 'dev', 'rooms.js'), '');
      assert.ok(checkSite(out).some((p) => p.includes('dev')));
      rmSync(join(out, 'dev'), { recursive: true });
      mkdirSync(join(out, 'src', 'tests'));
      assert.ok(checkSite(out).some((p) => p.includes('tests')));
      rmSync(join(out, 'src', 'tests'), { recursive: true });
      for (const name of ['firebase.json', 'database.rules.json', 'package.json', '.env', 'CLAUDE.md']) {
        writeFileSync(join(out, 'src', name), '');
        assert.ok(checkSite(out).length > 0, `${name} is refused`);
        rmSync(join(out, 'src', name));
      }
      writeFileSync(join(out, 'src', 'notes.md'), '');
      assert.ok(checkSite(out).some((p) => p.includes('unexpected file type')));
      rmSync(join(out, 'src', 'notes.md'));
      assert.deepEqual(checkSite(out), []);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test('the lists say what is published and what never is', () => {
    assert.deepEqual([...PUBLISHED], ['index.html', 'src']);
    for (const name of ['dev', 'tests', 'tests-firebase', 'tools', 'docs', 'node_modules', 'database.rules.json', 'firebase.json', 'package.json', 'CLAUDE.md']) {
      assert.ok(FORBIDDEN.includes(name), name);
    }
  });
});

/** A hash of index.html + every file under src/ in the repository. */
function sourceHash() {
  const hash = createHash('sha256');
  const files = ['index.html', ...walk(fileURLToPath(new URL('src', root))).map((p) => `src/${p}`)].sort();
  for (const rel of files) hash.update(rel).update(readFileSync(new URL(rel, root)));
  return hash.digest('hex');
}

describe('the version stamp', () => {
  const STAMP = 'abc1234';

  test('every same-site URL of the built site is stamped; CDN URLs are not; the sources are unchanged', () => {
    const before = sourceHash();
    const out = mkdtempSync(join(tmpdir(), 'son-cay-site-'));
    try {
      assert.deepEqual(buildSite(out, { stamp: STAMP }), []);
      assert.equal(sourceHash(), before, 'the repository sources are untouched');
      const html = readFileSync(join(out, 'index.html'), 'utf8');
      assert.ok(html.includes('<script type="module" src="src/ui/app.js?v=abc1234"></script>'));
      assert.ok(html.includes('href="src/ui/style.css?v=abc1234"'));
      assert.ok(html.includes('href="src/ui/icon.svg?v=abc1234"'));
      assert.ok(html.includes('href="https://fonts.googleapis.com/css2?family=Rakkas'), 'Google Fonts untouched');
      assert.ok(html.includes('href="https://fonts.gstatic.com" crossorigin'));
      assert.doesNotMatch(html, /https:[^"]*v=abc1234/);
      const css = readFileSync(join(out, 'src', 'ui', 'style.css'), 'utf8');
      assert.ok(css.includes("url('pattern.svg?v=abc1234')"));
      const sounds = readFileSync(join(out, 'src', 'ui', 'sounds.js'), 'utf8');
      assert.ok(sounds.includes("new URL('./audio/shot-loaded.mp3?v=abc1234', import.meta.url)"));
      assert.ok(sounds.includes("new URL('./audio/shot-empty.mp3?v=abc1234', import.meta.url)"));
      const firebase = readFileSync(join(out, 'src', 'ui', 'firebase.js'), 'utf8');
      assert.ok(firebase.includes("from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';"), 'CDN untouched');
      assert.doesNotMatch(firebase, /gstatic[^'"]*v=/);
      // Every module's relative imports, across the whole published src/.
      let count = 0;
      for (const rel of walk(join(out, 'src')).filter((p) => p.endsWith('.js'))) {
        for (const ref of jsReferences(readFileSync(join(out, 'src', rel), 'utf8'))) {
          count += 1;
          assert.ok(ref.endsWith('?v=abc1234'), `${ref} in src/${rel}`);
        }
      }
      assert.ok(count > 100, `found ${count} relative references`);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test('the graph walk fails on a reference without the stamp, a wrong stamp or a missing file', () => {
    const out = mkdtempSync(join(tmpdir(), 'son-cay-site-'));
    try {
      assert.deepEqual(buildSite(out, { stamp: STAMP }), []);
      assert.deepEqual(checkStamps(out, STAMP), []);
      assert.ok(checkStamps(out, 'other99').length > 0, 'another stamp is refused');
      const settings = join(out, 'src', 'ui', 'device-settings.js');
      const text = readFileSync(settings, 'utf8');
      writeFileSync(settings, text.replace("from './revolvers.js?v=abc1234'", "from './revolvers.js'"));
      assert.ok(checkStamps(out, STAMP).some((p) => p.includes('./revolvers.js in src/ui/device-settings.js')));
      writeFileSync(settings, text);
      const html = join(out, 'index.html');
      const page = readFileSync(html, 'utf8');
      writeFileSync(html, page.replace('src/ui/style.css?v=abc1234', 'src/ui/style.css'));
      assert.ok(checkStamps(out, STAMP).some((p) => p.includes('src/ui/style.css in index.html')));
      writeFileSync(html, page);
      // A module nothing imports yet is checked too (a later dynamic import would mix versions).
      writeFileSync(join(out, 'src', 'ui', 'later.js'), "export { t } from './i18n/i18n.js';\n");
      assert.ok(checkStamps(out, STAMP).some((p) => p.includes('later.js')));
      writeFileSync(join(out, 'src', 'ui', 'later.js'), "export { t } from './nothing.js?v=abc1234';\nimport('./i18n/i18n.js?v=abc1234');\n");
      assert.deepEqual(checkStamps(out, STAMP), [], 'unreached files are scanned, not followed');
      const app = join(out, 'src', 'ui', 'app.js');
      writeFileSync(app, `${readFileSync(app, 'utf8')}\nimport './gone.js?v=abc1234';\n`);
      assert.ok(checkStamps(out, STAMP).some((p) => p.includes('missing file') && p.includes('src/ui/gone.js')));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test('stampJs: static, multi-line, re-export, side-effect and dynamic imports, import.meta.url assets', () => {
    const src = [
      "import { a } from './a.js';",
      'import {\n  b,\n  c,\n} from "../b/c.js";',
      "export * from './d.js';",
      "export { e } from './e.js';",
      "import './side.js';",
      "const m = await import( './lazy.js' );",
      "const u = new URL('./audio/x.mp3', import.meta.url);",
      "import { f } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';",
      "const g = new URL('https://example.com/x.js');",
      'const h = new URL(pageHref);',
      "const text = 'move from here';",
    ].join('\n');
    const out = stampJs(src, 'v1x2');
    for (const spec of ['./a.js', '../b/c.js', './d.js', './e.js', './side.js', './lazy.js', './audio/x.mp3']) {
      assert.ok(out.includes(`${spec}?v=v1x2`), spec);
    }
    assert.ok(out.includes("from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js'"));
    assert.ok(out.includes("new URL('https://example.com/x.js')"));
    assert.ok(out.includes('new URL(pageHref)'));
    assert.ok(out.includes("'move from here'"));
    assert.equal(stampJs(out, 'v1x2'), out, 'stamping twice changes nothing');
    assert.equal(jsReferences(out).length, 7);
  });

  test('stampHtml / stampCss: only same-site relative URLs', () => {
    const html = '<link rel="icon" href="src/i.svg"><link href="https://fonts.googleapis.com/x?y=1">'
      + '<script type="module" src="src/app.js"></script><a href="src/not-a-tag.html">x</a>'
      + '<link href="//cdn.example/x.css"><link href="/abs.css"><link href="#top">';
    assert.equal(stampHtml(html, 'ab12'), '<link rel="icon" href="src/i.svg?v=ab12"><link href="https://fonts.googleapis.com/x?y=1">'
      + '<script type="module" src="src/app.js?v=ab12"></script><a href="src/not-a-tag.html">x</a>'
      + '<link href="//cdn.example/x.css"><link href="/abs.css"><link href="#top">');
    const css = "a{background:url('p.svg')} b{background:url(\"../q.svg\")} c{background:url(r.svg)} "
      + "d{background:url('data:image/svg+xml,abc')} e{background:url(https://x.example/y.png)}";
    assert.equal(stampCss(css, 'ab12'), "a{background:url('p.svg?v=ab12')} b{background:url(\"../q.svg?v=ab12\")} "
      + "c{background:url(r.svg?v=ab12)} d{background:url('data:image/svg+xml,abc')} e{background:url(https://x.example/y.png)}");
    assert.equal(withStamp('a.svg#frag', 'ab12'), 'a.svg?v=ab12#frag');
    assert.equal(withStamp('a.css?x=1', 'ab12'), 'a.css?x=1&v=ab12');
    for (const url of ['https://a', 'http://a', '//a', '/a', '#a', 'data:x', 'blob:x', '']) assert.equal(isRelativeUrl(url), false, url);
    for (const url of ['a.js', './a.js', '../a.js', 'src/ui/app.js']) assert.equal(isRelativeUrl(url), true, url);
  });

  test('the stamp is the commit from src/ui/version.js, else a content hash', () => {
    const version = readFileSync(new URL('src/ui/version.js', root), 'utf8');
    const commit = version.match(/export const COMMIT = "([0-9a-f]+)";/)?.[1];
    if (commit) assert.equal(siteStamp(), commit);
    const tmp = mkdtempSync(join(tmpdir(), 'son-cay-stamp-'));
    try {
      writeFileSync(join(tmp, 'index.html'), '<p>x</p>');
      mkdirSync(join(tmp, 'src', 'ui'), { recursive: true });
      writeFileSync(join(tmp, 'src', 'ui', 'version.js'), 'export const VERSION = "0.1.0";\nexport const COMMIT = null;\n');
      const first = siteStamp(tmp);
      assert.match(first, /^h[0-9a-f]{12}$/);
      writeFileSync(join(tmp, 'src', 'ui', 'a.js'), 'export const a = 1;\n');
      assert.notEqual(siteStamp(tmp), first, 'another build, another stamp');
      writeFileSync(join(tmp, 'src', 'ui', 'version.js'), 'export const COMMIT = "deadbee";\n');
      assert.equal(siteStamp(tmp), 'deadbee');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    assert.throws(() => buildSite(join(tmpdir(), 'son-cay-bad-stamp'), { stamp: 'a b' }), /invalid version stamp/);
  });
});

describe('the Pages workflow', () => {
  const yml = readFileSync(new URL('.github/workflows/pages.yml', root), 'utf8');

  test('runs on push to main and on a manual run', () => {
    assert.match(yml, /\non:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:\n/);
  });

  test('every action is pinned to a full commit SHA with its version in a comment', () => {
    const uses = [...yml.matchAll(/uses: (\S+)/g)].map((m) => m[0]);
    assert.ok(uses.length >= 4);
    for (const line of yml.split('\n').filter((l) => l.includes('uses: '))) {
      assert.match(line, /uses: actions\/[a-z-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, line.trim());
    }
    for (const action of ['checkout', 'setup-node', 'upload-pages-artifact', 'deploy-pages']) {
      assert.ok(yml.includes(`uses: actions/${action}@`), action);
    }
  });

  test('least permissions and one deploy at a time', () => {
    assert.match(yml, /\npermissions:\n {2}contents: read\n/);
    assert.match(yml, /\n {4}permissions:\n {6}pages: write\n {6}id-token: write\n/);
    assert.doesNotMatch(yml, /: write-all|contents: write/);
    assert.match(yml, /\nconcurrency:\n {2}group: pages\n {2}cancel-in-progress: false\n/);
  });

  test('tests first, then builds and checks the site, and uploads only that folder', () => {
    // version:write first: the build stamps every same-site URL with the commit it writes.
    const order = ['run: npm test', 'run: npm run version:write', 'run: node tools/pages-site.js _site', 'find _site',
      "grep -q 'src/ui/app.js?v=' _site/index.html", 'path: _site', 'actions/deploy-pages@'];
    let at = -1;
    for (const step of order) {
      const next = yml.indexOf(step);
      assert.ok(next > at, `${step} comes after the previous step`);
      at = next;
    }
    assert.doesNotMatch(yml, /npm (ci|install)/, 'npm test needs no dependencies');
    assert.match(yml, /persist-credentials: false/);
  });
});
