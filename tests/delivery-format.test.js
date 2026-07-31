const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDeliveryReceipt, buildTermsMessage, buildDeliveryFile } = require('../src/services/delivery');

const product = {
  name_id: 'Gemini <Pro>', name_en: 'Gemini Pro', stock_type: 'email_pass',
  warranty_id: 'Garansi <30> hari', warranty_en: '30-day warranty', terms_format: 'text'
};
const stocks = [
  { data: 'one@example.com|pass1' },
  { data: 'two@example.com|pass2' }
];

test('delivery normal memakai quote, tap-copy, dan blank line tanpa nomor akun', () => {
  const msg = buildDeliveryReceipt({ id: 'VTC-1', quantity: 2 }, product, stocks, 'id', false);
  assert.match(msg, /^<blockquote><b>🎉 Pembayaran Berhasil<\/b><\/blockquote>/);
  assert.match(msg, /<b>Order ID:<\/b> <code>VTC-1<\/code>/);
  assert.match(msg, /<b>Produk:<\/b> <b>Gemini &lt;Pro&gt;<\/b>/);
  assert.match(msg, /<b>≡ Data Akun ━━━<\/b>/);
  assert.match(msg, /pass1<\/code>\n\n📧 Email:[\s\S]*pass2<\/code>/);
  assert.doesNotMatch(msg, /Akun 1|Akun 2|Account 1/);
  assert.match(msg, /Terima kasih atas pembeliannya!/);
});

test('delivery besar berupa receipt tanpa data, terms terpisah, dan txt tanpa nomor akun', () => {
  const receipt = buildDeliveryReceipt({ id: 'VTC-2', quantity: 21 }, product, stocks, 'id', true);
  assert.match(receipt, /Data akun dikirim melalui file TXT\./);
  assert.doesNotMatch(receipt, /one@example\.com/);
  const terms = buildTermsMessage(product, 'id');
  assert.match(terms, /^<b>≡ Garansi\/SnK:<\/b>/);
  assert.match(terms, /Garansi &lt;30&gt; hari/);
  const file = buildDeliveryFile(product, stocks, 'id');
  assert.match(file, /one@example\.com[\s\S]*\n\n[\s\S]*two@example\.com/);
  assert.doesNotMatch(file, /Akun 1|Account 1/);
});

test('terms kosong tidak menghasilkan pesan kedua dan English sinkron', () => {
  assert.equal(buildTermsMessage({ terms_id: '', warranty_id: '' }, 'id'), '');
  const msg = buildDeliveryReceipt({ id: 'VTC-3', quantity: 1 }, product, stocks.slice(0, 1), 'en', false);
  assert.match(msg, /Payment Successful/);
  assert.match(msg, /Account Data/);
  assert.match(msg, /Thank you for your purchase!/);
});

test('lima stock type existing tetap terformat pada receipt baru', () => {
  const cases = [
    ['email_pass', 'a@b.com|pass', /📧 Email:[\s\S]*🔐 Password:/],
    ['email_pass_key', 'a@b.com|pass|KEY', /🔑 Key:/],
    ['code', 'PIN-123', /🔑 Code:/],
    ['vcc', '4111|12\/29|123', /💳 Card:[\s\S]*📅 Expiry:[\s\S]*🔒 CVV:/],
    ['custom', 'baris satu|baris dua', /baris satu\nbaris dua/]
  ];
  for (const [stock_type, data, expected] of cases) {
    const msg = buildDeliveryReceipt({ id: 'VTC-TYPE', quantity: 1 }, { ...product, stock_type }, [{ data }], 'id', false);
    assert.match(msg, expected);
  }
});
