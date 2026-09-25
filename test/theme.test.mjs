import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('observatory defaults to the Avalanche charcoal and red identity', async () => {
  const [styles, html] = await Promise.all([
    read('src/styles.css'),
    read('index.html'),
  ]);
  assert.match(styles, /--bg:\s*#0b0d10/);
  assert.match(styles, /--red:\s*#ef3b42/);
  assert.match(styles, /:root\[data-cd-theme="light"\][\s\S]*--red:\s*#c92831/);
  assert.match(html, /<html lang="en" data-cd-theme="dark">/);
  assert.doesNotMatch(styles, /--red:\s*var\(--cd-accent\)/);
});

test('catalog fleet owns one theme controller and one toggle surface', async () => {
  const [html, app, adapter] = await Promise.all([
    read('index.html'),
    read('src/App.jsx'),
    read('src/cd-theme-overrides.css'),
  ]);
  assert.doesNotMatch(html, /cd-theme-(?:bootstrap|controller)\.js/);
  assert.doesNotMatch(html, /cd-ui\/v1\.1\.0/);
  assert.doesNotMatch(app, /data-cd-theme-slot/);
  assert.match(adapter, /catalog owns the one canonical v1\.3 theme controller/);
});

test('light theme adapter covers analytical controls, charts, tables and dialogs', async () => {
  const adapter = await read('src/cd-theme-overrides.css');
  for (const selector of ['.segmented button.active', '.chart-menu', '.recharts-cartesian-axis-tick text', 'th', 'td', '.table-footer button', '.empty-state strong', '.timeframe', '.method-dialog dd']) {
    assert.match(adapter, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('observatory brand uses the official two-part Avalanche mark', async () => {
  const [app, styles] = await Promise.all([read('src/App.jsx'), read('src/styles.css')]);
  assert.match(app, /className="brand-mark" aria-hidden="true"/);
  assert.match(app, /className="avalanche-logo" viewBox="0 0 32 32"/);
  assert.equal((app.match(/<path d=/g) || []).length, 2);
  assert.doesNotMatch(app, /className="brand-mark">A<\/span>/);
  assert.match(styles, /\.avalanche-logo\s*\{[^}]*fill:\s*currentColor/);
});
