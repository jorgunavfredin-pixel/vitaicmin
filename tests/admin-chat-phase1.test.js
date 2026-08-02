const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { AdminStateManager, ADMIN_STATE_TTL_MS } = require('../src/admin/state');
const { categoryListKeyboard, categoryViewKeyboard, productListKeyboard } = require('../src/utils/keyboard');

const ctx = (adminId = 1, chatId = 10) => ({ from: { id: adminId }, chat: { id: chatId } });

test('admin state TTL 10 menit, terikat admin/chat, dan clear eksplisit', () => {
  let now = 1000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const manager = new AdminStateManager();
    const owner = ctx(1, 10);
    manager.setFor(owner, { action: 'edit_prod', prodId: 'P1' });
    assert.equal(manager.getFor(owner).prodId, 'P1');
    assert.equal(manager.getFor(ctx(1, 11)), null, 'chat berbeda harus menolak sekaligus membersihkan state');

    manager.setFor(owner, { action: 'add_product' });
    now += ADMIN_STATE_TTL_MS + 1;
    assert.equal(manager.getFor(owner), null, 'state expired tidak boleh diproses');

    manager.setFor(owner, { action: 'add_category' });
    manager.clearFor(owner);
    assert.equal(manager.getFor(owner), null);
  } finally { Date.now = originalNow; }
});

test('kategori dan produk diurutkan A-Z dengan back hierarchy yang benar', () => {
  const categories = [
    { id: 'z', name_id: 'Zulu' },
    { id: 'a', name_id: 'Apple' },
    { id: 'g', name_id: 'Gemini' }
  ];
  const catButtons = categoryListKeyboard(categories, 1).reply_markup.inline_keyboard.flat();
  assert.deepEqual(catButtons.filter(b => b.callback_data?.startsWith('adm_cat_view_')).map(b => b.text), ['📁 Apple', '📁 Gemini', '📁 Zulu']);
  assert.equal(catButtons.some(b => b.callback_data === 'adm_cat_search'), false);

  const products = [
    { id: 'z', name_id: 'Zulu', active: true, stockCount: 1 },
    { id: 'a', name_id: 'Apple', active: true, stockCount: 2 }
  ];
  const prodRows = productListKeyboard(products, 'cat1').reply_markup.inline_keyboard;
  assert.deepEqual(prodRows.filter(row => row[0]?.callback_data?.startsWith('adm_prod_view_')).map(row => row[0].text), ['✅ Apple | 2 stok', '✅ Zulu | 1 stok']);
  assert.equal(prodRows.flat().some(b => b.callback_data?.startsWith('adm_prod_search_')), false);
  assert.equal(prodRows.at(-1)[0].callback_data, 'adm_prod');
});

test('kategori tidak lagi menawarkan emoji, toggle, search, atau hapus beserta produk', () => {
  const detail = categoryViewKeyboard('C1').reply_markup.inline_keyboard.flat();
  const callbacks = detail.map(b => b.callback_data);
  assert.equal(callbacks.some(v => /emoji|toggle/.test(v || '')), false);

  const keyboard = fs.readFileSync(path.join(__dirname, '../src/utils/keyboard.js'), 'utf8');
  const products = fs.readFileSync(path.join(__dirname, '../src/admin/products.js'), 'utf8');
  const panel = fs.readFileSync(path.join(__dirname, '../src/admin/panel.js'), 'utf8');
  assert.doesNotMatch(keyboard, /adm_cat_search|adm_prod_search|adm_cat_fixdel_all|adm_cat_edit_emoji|adm_cat_toggle/);
  assert.doesNotMatch(products, /adm_cat_edit_emoji|adm_cat_toggle|handleEditCatEmoji|step = 'emoji'/);
  assert.doesNotMatch(panel, /handleEditCatEmoji|case 'edit_cat_emoji'/);
});

test('create/edit produk memvalidasi harga dan tipe stok lalu membuka Product View', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/admin/products.js'), 'utf8');
  assert.match(source, /Number\.parseInt\(text\.replace\(\/\\D\/g, ''\), 10\)/);
  assert.match(source, /if \(!types\[choice\]\)/);
  assert.match(source, /state\.data\.stock_mode = 'limited'/);
  assert.doesNotMatch(source, /types\[text\] \|\| 'email_pass'|stock_mode = 'stocked'/);
  assert.match(source, /Produk berhasil dibuat[\s\S]{0,220}productViewKeyboard\(prod\.id, prod\.category_id, prod\)/);
});

test('admin submenu yang disentuh memakai HTML escaping untuk data dinamis', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/admin/products.js'), 'utf8');
  assert.match(source, /<blockquote>📁 <b>\$\{escapeHtml\(cat\.name_id/);
  assert.match(source, /const renderProductSummary/);
  assert.match(source, /parse_mode: 'HTML'/);
});
