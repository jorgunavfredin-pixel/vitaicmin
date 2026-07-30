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
  assert.ok(markup.reply_markup.inline_keyboard[0].every(b => b.style === 'primary'));
  const paged = generateCategoryButtons(Array.from({ length: 11 }, (_, i) => ({ id: String(i), name_id: `P${i}`, name_en: `P${i}` })), 0, 'id');
  assert.equal(paged.reply_markup.inline_keyboard.at(-1)[0].style, 'success');
  const middlePage = generateCategoryButtons(Array.from({ length: 21 }, (_, i) => ({ id: String(i), name_id: `P${i}`, name_en: `P${i}` })), 1, 'id');
  assert.ok(middlePage.reply_markup.inline_keyboard.at(-1).every(b => b.style === 'success'));

  const { mainMenuKeyboard } = require('../src/utils/keyboard');
  const menuRows = mainMenuKeyboard('id').reply_markup.keyboard;
  assert.deepEqual(menuRows.map(row => row.map(b => b.style)), [
    ['primary', 'primary'], ['success'], ['primary', 'primary'], ['danger', 'danger']
  ]);

  const keyboardSource = fs.readFileSync(path.join(__dirname, '../src/handlers/keyboard.js'), 'utf8');
  const orderSource = fs.readFileSync(path.join(__dirname, '../src/handlers/order.js'), 'utf8');
  assert.match(keyboardSource, /bulk: 'Bulk'.*bulk: 'Grosir'/s);
  assert.match(keyboardSource, /<b>Fee:<\/b>/);
  assert.doesNotMatch(keyboardSource, /Minbel\.|Biaya Gateway|Gateway Fee/);
  assert.doesNotMatch(orderSource, /Biaya Gateway|Gateway Fee/);
});

test('checkout dan payment method memakai warna sesuai aksi', () => {
  const { quantityKeyboard, paymentMethodKeyboard } = require('../src/utils/keyboard');
  const qtyRows = quantityKeyboard(20, 'P1', 2, 'C1', 'id').reply_markup.inline_keyboard;
  assert.ok(qtyRows[0].every(b => b.style === 'primary'));
  assert.ok(qtyRows[1].every(b => b.style === 'primary'));
  assert.equal(qtyRows[2][0].style, 'success');
  assert.equal(qtyRows[3][0].style, 'danger');

  const paymentRows = paymentMethodKeyboard('ORDER-STYLE', 'id').reply_markup.inline_keyboard;
  const buttons = paymentRows.flat();
  assert.ok(buttons.filter(b => b.text.includes('QRIS')).every(b => b.style === 'primary'));
  assert.equal(buttons.find(b => b.text.startsWith('● Saldo'))?.style, 'success');
  assert.equal(buttons.find(b => b.text.includes('Voucher'))?.style, 'danger');
  assert.equal(buttons.find(b => b.text.includes('Batalkan'))?.style, 'danger');

  const keyboardSource = fs.readFileSync(path.join(__dirname, '../src/handlers/keyboard.js'), 'utf8');
  assert.match(keyboardSource, /buy_btn[^\n]*[\s\S]{0,250}style: 'primary'/);
  assert.match(keyboardSource, /back_to_categories'\), style: 'success'/);
});

test('invoice saldo dan pagination history memakai warna yang diminta', () => {
  const { paymentPendingKeyboard, topupNominalKeyboard, historyKeyboard } = require('../src/utils/keyboard');
  const invoice = paymentPendingKeyboard('ORDER-1', 'id').reply_markup.inline_keyboard.flat();
  assert.equal(invoice.find(b => b.callback_data.startsWith('pay_check_')).style, 'primary');
  assert.equal(invoice.find(b => b.callback_data.startsWith('pay_cancel_')).style, 'danger');

  for (const lang of ['id', 'en']) {
    const saldo = topupNominalKeyboard(lang).reply_markup.inline_keyboard.flat();
    assert.ok(saldo.every(b => b.style === 'success'));
  }
  const legacyHistory = historyKeyboard(2, 3, 'id').reply_markup.inline_keyboard[0];
  assert.equal(legacyHistory.find(b => b.text.includes('«')).style, 'primary');
  assert.equal(legacyHistory.find(b => b.text.includes('»')).style, 'primary');

  const keyboardSource = fs.readFileSync(path.join(__dirname, '../src/handlers/keyboard.js'), 'utf8');
  assert.match(keyboardSource, /history_page_1', style: 'primary'/);
  assert.match(keyboardSource, /topup_confirm_[^\n]+style: 'success'/);
  assert.match(keyboardSource, /saldo_back_new', style: 'primary'/);
  assert.match(keyboardSource, /topup_check_[^\n]+style: 'success'/);
});

test('flash sale banner memakai quote dan progress opsional multibahasa', () => {
  const root = path.join(__dirname, '..');
  const keyboard = fs.readFileSync(path.join(root, 'src/handlers/keyboard.js'), 'utf8');
  const admin = fs.readFileSync(path.join(root, 'admin-web/src/pages/Products.jsx'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'src/web/routes/products.js'), 'utf8');
  assert.match(keyboard, /<blockquote>/);
  assert.match(keyboard, /'■'\.repeat/);
  assert.match(keyboard, /Sisa.*slot/);
  assert.match(keyboard, /slots left/);
  assert.match(admin, /Batasi jumlah transaksi flash sale/);
  assert.match(admin, /flash_limit_enabled/);
  assert.match(api, /flash_max_transactions/);
});

test('simbol buyer unicode konsisten dan keyboard lama tetap kompatibel', () => {
  const { mainMenuKeyboard, quantityKeyboard, paymentMethodKeyboard, paymentPendingKeyboard } = require('../src/utils/keyboard');
  const menu = mainMenuKeyboard('id').reply_markup.keyboard.flat().map(b => b.text);
  assert.deepEqual(menu.map(t => t.split(' ')[0]), ['▦', '▤', '●', '≡', '◎', '◇', '?']);

  const qty = quantityKeyboard(20, 'P', 2, 'C', 'id').reply_markup.inline_keyboard.flat().map(b => b.text);
  for (const label of ['−1', '＋1', '−5', '＋5', 'Lanjutkan Pembayaran ›', '‹ Kembali']) assert.ok(qty.includes(label));

  const payment = paymentMethodKeyboard('ORDER-SYMBOL', 'id').reply_markup.inline_keyboard.flat().map(b => b.text);
  assert.ok(payment.some(t => t.startsWith('▣ QRIS')));
  assert.ok(payment.includes('● Saldo'));
  assert.ok(payment.includes('＋ Pakai Voucher'));
  assert.ok(payment.includes('× Batalkan'));

  const pending = paymentPendingKeyboard('ORDER-SYMBOL', 'id').reply_markup.inline_keyboard.flat().map(b => b.text);
  assert.deepEqual(pending, ['↻ Cek Status', '× Batalkan Order']);

  const source = fs.readFileSync(path.join(__dirname, '../src/handlers/keyboard.js'), 'utf8');
  assert.match(source, /'▦ List Produk'.*'🛒 List Produk'/);
  assert.match(source, /\[●💰\]/);
});

test('compact product card dan checkout tier aktif memakai hierarchy ringkas', async () => {
  const root = path.join(__dirname, '..');
  const keyboard = fs.readFileSync(path.join(root, 'src/handlers/keyboard.js'), 'utf8');
  const menu = fs.readFileSync(path.join(root, 'src/handlers/menu.js'), 'utf8');
  const admin = fs.readFileSync(path.join(root, 'admin-web/src/pages/Products.jsx'), 'utf8');

  assert.match(keyboard, /╭─ <b>\$\{displayName\}<\/b>/);
  assert.match(keyboard, /labels\.stock.*•.*labels\.sold/);
  assert.match(keyboard, /labels\.bulk} » <b>/);
  assert.match(keyboard, /╰ <i>\$\{desc\}<\/i>/);
  assert.doesNotMatch(keyboard, /╭─〔|labels\.restock/);

  assert.match(menu, /Harga grosir/);
  assert.match(menu, /Bulk price/);
  assert.match(menu, /Hemat/);
  assert.match(menu, /Savings/);
  assert.match(menu, /<i>\$\{desc\}<\/i>/);

  assert.match(admin, /Disarankan maksimal 100 karakter/);
  assert.match(admin, /description_id\.length/);
  assert.match(admin, /description_en\.length/);

  const { generateCheckoutMessage } = require('../src/handlers/menu');
  const rendered = await generateCheckoutMessage({
    id: 'RUNTIME-COMPACT', name_id: 'Produk <A>', name_en: 'Product A',
    description_id: 'Akun private & garansi', description_en: 'Private account',
    price_idr: 1000, stock_mode: 'unlimited', active: true,
    qty_discounts: JSON.stringify([{ min_qty: 2, type: 'fixed_price', price: 750 }])
  }, 2, 'id');
  assert.match(rendered, /<b>Produk &lt;A&gt;<\/b>/);
  assert.match(rendered, /<i>Akun private &amp; garansi<\/i>/);
  assert.match(rendered, /Harga grosir\s+Rp750\/pcs/);
  assert.match(rendered, /Hemat\s+Rp500/);
  assert.match(rendered, /<pre>[\s\S]*Total\s+Rp1\.500[\s\S]*<\/pre>/);
  assert.doesNotMatch(rendered, /Harga satuan/);
});

test('judul kategori pagination produk konfirmasi dan invoice memakai layout monospace', () => {
  const root = path.join(__dirname, '..');
  const keyboard = fs.readFileSync(path.join(root, 'src/handlers/keyboard.js'), 'utf8');
  const menu = fs.readFileSync(path.join(root, 'src/handlers/menu.js'), 'utf8');
  const helpers = fs.readFileSync(path.join(root, 'src/utils/helpers.js'), 'utf8');
  const order = fs.readFileSync(path.join(root, 'src/handlers/order.js'), 'utf8');

  assert.match(keyboard, /categoryName\.toUpperCase\(\)/);
  assert.match(keyboard, /Pilih produk yang ingin dibeli/);
  assert.match(keyboard, /« Produk Sebelumnya/);
  assert.match(keyboard, /Produk Berikutnya »/);
  assert.match(menu, /<pre>\$\{rows\.join/);
  assert.match(helpers, /<pre>\$\{summaryRows\.join/);
  assert.match(helpers, /<pre>\$\{paymentRows\.join/);
  assert.doesNotMatch(order, /<pre>\$\{invoiceRows\.join/);
  assert.match(order, /<b>\$\{l\.orderId}:<\/b> <code>/);
  assert.match(order, /<b>\$\{l\.prod}:<\/b> <b>\$\{prodName}<\/b>/);
  assert.match(order, /<b>\$\{l\.total}:<\/b>     <b>\$\{totalDisplay}<\/b>/);
  assert.match(order, /Scan QRIS di atas untuk membayar/);
});

test('deskripsi fallback dan voucher tetap mengedit halaman konfirmasi yang sama', () => {
  const root = path.join(__dirname, '..');
  const keyboard = fs.readFileSync(path.join(root, 'src/handlers/keyboard.js'), 'utf8');
  const menu = fs.readFileSync(path.join(root, 'src/handlers/menu.js'), 'utf8');
  const order = fs.readFileSync(path.join(root, 'src/handlers/order.js'), 'utf8');
  assert.match(keyboard, /No description\./);
  assert.match(keyboard, /Tidak ada deskripsi\./);
  assert.match(menu, /No description\./);
  assert.match(menu, /Tidak ada deskripsi\./);
  assert.match(order, /confirmationMessageId/);
  assert.match(order, /force_reply: true/);
  assert.match(order, /reply_to_message\?\.message_id !== state\.promptMessageId/);
  assert.match(order, /editVoucherConfirmation\(ctx, state, updatedOrder, lang\)/);
  assert.match(order, /await ctx\.editMessageText\(confirmMsg/);
});
