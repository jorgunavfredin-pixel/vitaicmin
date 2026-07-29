const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isPrivateChat, isOwnedOrder, privateChatOnly } = require('../src/utils/buyerSecurity');

test('buyer transaction hanya mengizinkan private chat', async () => {
  assert.equal(isPrivateChat({ chat: { type: 'private' } }), true);
  assert.equal(isPrivateChat({ chat: { type: 'group' } }), false);
  let nextCalled = false;
  await privateChatOnly({ chat: { type: 'private' } }, async () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  let alert = '';
  await privateChatOnly({
    chat: { type: 'supergroup' }, callbackQuery: {},
    answerCbQuery: async (text) => { alert = text; }
  }, async () => { throw new Error('tidak boleh lanjut'); });
  assert.match(alert, /chat pribadi/i);
});

test('ownership guard memvalidasi user, tipe order, dan status', () => {
  const ctx = { from: { id: 123 } };
  const order = { user_id: '123', product_id: 'TOPUP', status: 'pending' };
  assert.equal(isOwnedOrder(order, ctx, { statuses: ['pending'], productId: 'TOPUP' }), true);
  assert.equal(isOwnedOrder(order, { from: { id: 999 } }, { statuses: ['pending'] }), false);
  assert.equal(isOwnedOrder(order, ctx, { statuses: ['delivered'] }), false);
  assert.equal(isOwnedOrder(order, ctx, { productId: 'PROD-1' }), false);
});

test('callback sensitif memakai centralized ownership guard dan quantity validation', () => {
  const root = path.join(__dirname, '..');
  const order = fs.readFileSync(path.join(root, 'src/handlers/order.js'), 'utf8');
  const keyboard = fs.readFileSync(path.join(root, 'src/handlers/keyboard.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
  assert.match(index, /bot\.use\(privateChatOnly\)/);
  for (const callback of ['pay_select_', 'pay_qris_', 'pay_qgw_', 'pay_check_', 'pay_cancel_', 'pay_saldo_']) {
    const at = order.indexOf(callback);
    assert.ok(at >= 0, `${callback} harus ada`);
    assert.match(order.slice(at, at + 1800), /getOwnedOrder\(ctx, orderId/);
  }
  for (const callback of ['topup_check_', 'topup_cancel_order_']) {
    const at = keyboard.indexOf(callback);
    assert.ok(at >= 0, `${callback} harus ada`);
    assert.match(keyboard.slice(at, at + 900), /getOwnedOrder\(ctx, topupId/);
  }
  assert.match(order, /Number\.isInteger\(quantity\).*quantity < 1.*quantity > 999/s);
});

test('input state memiliki TTL/chat binding dan payment callback punya cooldown', () => {
  const root = path.join(__dirname, '..');
  const menu = fs.readFileSync(path.join(root, 'src/handlers/menu.js'), 'utf8');
  const order = fs.readFileSync(path.join(root, 'src/handlers/order.js'), 'utf8');
  const keyboard = fs.readFileSync(path.join(root, 'src/handlers/keyboard.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
  assert.match(menu, /expiresAt: Date\.now\(\) \+ 10 \* 60 \* 1000/);
  assert.match(menu, /reply_to_message\?\.message_id === state\.promptMessageId/);
  assert.match(order, /voucherStates\.set\(userId, \{[\s\S]*chatId:[\s\S]*expiresAt:/);
  assert.match(keyboard, /setTopupInputState[\s\S]*expiresAt:/);
  assert.match(index, /PAYMENT_ACTION_COOLDOWN/);
  assert.match(index, /ctx\.answerCbQuery\(msg, \{ show_alert: true \}\)/);
});

test('buyer UX memakai live settings, HTML aman, WIB, statistik produk, dan fee aktual', () => {
  const root = path.join(__dirname, '..');
  const start = fs.readFileSync(path.join(root, 'src/handlers/start.js'), 'utf8');
  const keyboard = fs.readFileSync(path.join(root, 'src/handlers/keyboard.js'), 'utf8');
  const order = fs.readFileSync(path.join(root, 'src/handlers/order.js'), 'utf8');
  const support = fs.readFileSync(path.join(root, 'src/handlers/support.js'), 'utf8');
  const security = fs.readFileSync(path.join(root, 'src/utils/buyerSecurity.js'), 'utf8');
  assert.match(start, /o\.product_id !== 'TOPUP'/);
  assert.match(start, /timeZone: 'Asia\/Jakarta'/);
  assert.match(keyboard, /getLiveStoreName = \(\) => escapeHtml\(db\.getConfig/);
  assert.match(keyboard, /filter\(o => o\.status !== 'init'\)/);
  assert.match(keyboard, /buyerFee = Math\.max\(0, totalPayment - amount\)/);
  assert.match(order, /buyerFee = Math\.max\(0, totalAmount - order\.total_idr\)/);
  assert.match(order, /caption: message, parse_mode: 'HTML'/);
  assert.match(support, /db\.getConfig\('support_username'/);
  assert.match(support, /escapeHtml\(supportHours\)/);
  assert.match(security, /settings\.maintenance/);
  assert.match(security, /user\?\.banned/);
});

test('runtime category renderer mengimpor escapeHtml dan aman untuk karakter HTML', () => {
  const { generateCategoryListMsg } = require('../src/handlers/keyboard');
  const msg = generateCategoryListMsg([{ id: 'C1', name_id: 'A&B <Promo>', name_en: 'A&B <Promo>' }], 0, 'id');
  assert.match(msg, /A&amp;B &lt;PROMO&gt;/i);
  assert.doesNotMatch(msg, /A&B <Promo>/i);
});

test('daftar kategori A-Z sinkron dengan tombol dan label multibahasa', () => {
  const { generateCategoryListMsg, generateCategoryButtons, sortCategoriesAZ } = require('../src/handlers/keyboard');
  const categories = [
    { id: 'z', name_id: 'Zulu', name_en: 'Alpha' },
    { id: 'a', name_id: 'Alfa', name_en: 'Zulu' },
    { id: 'e', name_id: 'Éclair', name_en: 'Echo' }
  ];
  assert.deepEqual(sortCategoriesAZ(categories, 'id').map(c => c.id), ['a', 'e', 'z']);
  assert.deepEqual(sortCategoriesAZ(categories, 'en').map(c => c.id), ['z', 'e', 'a']);
  const idMsg = generateCategoryListMsg(categories, 0, 'id');
  assert.match(idMsg, /1\. <b>ALFA<\/b>[\s\S]*2\. <b>ÉCLAIR<\/b>[\s\S]*3\. <b>ZULU<\/b>/);
  const markup = generateCategoryButtons(categories, 0, 'id');
  assert.deepEqual(markup.reply_markup.inline_keyboard[0].map(b => b.callback_data), ['catnum_a', 'catnum_e', 'catnum_z']);

  const keyboardSource = fs.readFileSync(path.join(__dirname, '../src/handlers/keyboard.js'), 'utf8');
  const orderSource = fs.readFileSync(path.join(__dirname, '../src/handlers/order.js'), 'utf8');
  assert.match(keyboardSource, /bulkLabel = lang === 'en' \? 'Bulk' : 'Grosir'/);
  assert.match(keyboardSource, /<b>Fee:<\/b>/);
  assert.doesNotMatch(keyboardSource, /Minbel\.|Biaya Gateway|Gateway Fee/);
  assert.doesNotMatch(orderSource, /Biaya Gateway|Gateway Fee/);
});
