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

test('pagination tanpa banner mengedit text, bukan delete dan kirim ulang', async () => {
  const { editBannerCaption } = require('../src/utils/banner');
  const calls = [];
  const ctx = {
    callbackQuery: { message: { text: 'halaman lama' } },
    editMessageText: async (...args) => calls.push(['text', ...args]),
    editMessageCaption: async (...args) => calls.push(['caption', ...args]),
    deleteMessage: async () => calls.push(['delete']),
    reply: async () => calls.push(['reply'])
  };
  await editBannerCaption(ctx, '<b>halaman baru</b>', { reply_markup: { inline_keyboard: [] } });
  assert.equal(calls[0][0], 'text');
  assert.equal(calls[0][1], '<b>halaman baru</b>');
  assert.equal(calls[0][2].parse_mode, 'HTML');
  assert.doesNotMatch(calls.map(c => c[0]).join(','), /delete|reply|caption/);

  const photoCalls = [];
  await editBannerCaption({
    callbackQuery: { message: { photo: [{ file_id: 'x' }], caption: 'lama' } },
    editMessageCaption: async (...args) => photoCalls.push(['caption', ...args])
  }, '<b>caption baru</b>');
  assert.equal(photoCalls[0][0], 'caption');
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
