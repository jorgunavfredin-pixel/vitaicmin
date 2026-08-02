const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('settings backend mengekspos live support DB-env fields dan validasi URL', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/web/routes/settings.js'), 'utf8');
  for (const key of [
    'support_text', 'support_whatsapp_url', 'support_telegram_url',
    'support_group_url', 'support_channel_url'
  ]) assert.match(source, new RegExp(`${key}: db\\.getConfig\\(\\s*'${key}'`));
  assert.match(source, /SUPPORT_TELEGRAM_URL/);
  assert.match(source, /SUPPORT_USERNAME/);
  assert.match(source, /parsed\.protocol !== 'https:'/);
  assert.match(source, /URL Telegram Admin wajib diisi/);
  assert.match(source, /db\.updateSettings\(updates\)/);
});

test('Info Toko menyediakan teks bebas dan empat URL dengan Telegram wajib', () => {
  const source = fs.readFileSync(path.join(__dirname, '../admin-web/src/pages/Settings.jsx'), 'utf8');
  for (const field of [
    'support_text', 'support_whatsapp_url', 'support_telegram_url',
    'support_group_url', 'support_channel_url'
  ]) assert.match(source, new RegExp(`form\\.${field}`));
  assert.match(source, /Teks Customer Support \(opsional\)/);
  assert.match(source, /URL Telegram Admin wajib diisi/);
  assert.match(source, /wajib memakai https:\/\//);
  assert.doesNotMatch(source, /Username Support \(Telegram\)|Jam Operasional Support/);
});
