// The GitHub Pages site (task 4.5b): tools/pages-site.js publishes ONLY index.html + src/, its
// check fails when anything else slips in (dev/, tests/, config files), and the workflow
// .github/workflows/pages.yml is wired as required. No network; builds into a temp folder.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN, PUBLISHED, buildSite, checkSite } from '../tools/pages-site.js';

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
      for (const path of published) assert.ok(path === 'index.html' || /^src\/.+\.(js|css|svg)$/.test(path), path);
      assert.ok(published.includes('src/ui/app.js'));
      assert.ok(published.includes('src/engine/index.js'));
      assert.ok(published.includes('src/rooms/index.js'));
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
    const order = ['run: npm test', 'run: node tools/pages-site.js _site', 'find _site', 'path: _site', 'actions/deploy-pages@'];
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
