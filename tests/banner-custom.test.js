const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('runtime banner mendukung toggle dan reset cache', () => {
  const source = fs.readFileSync(path.join(root, 'src/utils/banner.js'), 'utf8');
  assert.match(source, /banner_enabled/);
  assert.match(source, /isBannerEnabled/);
  assert.match(source, /resetBannerCache/);
  assert.match(source, /if \(!isBannerEnabled\(\)\) return null/);
});

test('admin banner memvalidasi upload, replace file, preview, toggle, dan delete', () => {
  const route = fs.readFileSync(path.join(root, 'src/web/routes/settings.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'admin-web/src/pages/Settings.jsx'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'admin-web/src/api.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'admin-web/src/styles.css'), 'utf8');

  assert.match(route, /BANNER_MAX_BYTES = 5 \* 1024 \* 1024/);
  assert.match(route, /sharp\(bytes\)\.metadata\(\)/);
  assert.match(route, /\.banner-upload-/);
  assert.match(route, /banner\$\{oldExt\}/);
  assert.match(route, /settings\/banner\/toggle/);
  assert.match(route, /settings\/banner\/file/);
  assert.match(api, /fetchBannerBlob/);
  assert.match(page, /function BannerManager/);
  assert.match(page, /Ganti Banner/);
  assert.match(page, /File aktif:/);
  assert.match(css, /\.settings-store-grid[^}]*grid-template-columns/);
  assert.match(css, /\.banner-preview img[^}]*object-fit: contain/);
  assert.match(css, /\.banner-actions[^}]*grid-template-columns/);
  assert.match(css, /\.banner-actions \.btn-primary, \.banner-actions \.btn-ghost[^}]*min-height: 38px/);
  assert.doesNotMatch(css, /\.banner-preview[^}]*aspect-ratio/);
});
