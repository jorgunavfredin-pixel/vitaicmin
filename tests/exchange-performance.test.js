const test = require('node:test');
const assert = require('node:assert/strict');

test('fetch kurs paralel berbagi satu network request', async () => {
  const axios = require('axios');
  const original = axios.get;
  let calls = 0;
  axios.get = async () => {
    calls++;
    await new Promise(r => setTimeout(r, 20));
    return { data: { rates: { IDR: 16000 } } };
  };
  const modulePath = require.resolve('../src/payments/exchange');
  delete require.cache[modulePath];
  try {
    const { convertIDRtoUSD } = require('../src/payments/exchange');
    const values = await Promise.all([1000, 2000, 3000, 4000].map(convertIDRtoUSD));
    assert.deepEqual(values, [0.0625, 0.125, 0.1875, 0.25]);
    assert.equal(calls, 1);
  } finally {
    axios.get = original;
    delete require.cache[modulePath];
  }
});

const fs = require('node:fs');
const path = require('node:path');
test('renderer kategori memakai agregat dan layout baru tanpa scan semua order', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/handlers/keyboard.js'), 'utf8');
  assert.match(source, /getSoldQtyByProducts/);
  assert.doesNotMatch(source, /const allOrders = db\.getOrders\(\)/);
  assert.match(source, /<blockquote><b>\$\{labels\.category\}:/);
  assert.match(source, /Detail produk di halaman checkout/);
  assert.match(source, /┊╰➤/);
  assert.match(source, /hasBanner\(\)/);
  assert.match(source, /else if \(hasBanner\(\)\)/);
  assert.match(source, /else \{\s*await editBannerCaption\(ctx, msg/s);
});
