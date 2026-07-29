const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeBulkTiers, calculateBulkPrice } = require('../src/utils/bulkPricing');

test('format legacy percent tetap kompatibel dan total tidak berubah', () => {
  const result = calculateBulkPrice(1000, 3, JSON.stringify([{ min_qty: 2, percent: 10 }]));
  assert.equal(result.tier.type, 'percent');
  assert.equal(result.total, 2700);
  assert.equal(result.discount_amount, 300);
});

test('fixed price mengubah harga per pcs dan total langsung', () => {
  const result = calculateBulkPrice(1000, 2, [{ min_qty: 2, type: 'fixed_price', price: 850 }]);
  assert.equal(result.unit_price, 850);
  assert.equal(result.total, 1700);
  assert.equal(result.discount_amount, 300);
});

test('tier minimum tertinggi yang terpenuhi menang', () => {
  const tiers = [
    { min_qty: 2, type: 'percent', percent: 10 },
    { min_qty: 5, type: 'fixed_price', price: 700 }
  ];
  assert.equal(calculateBulkPrice(1000, 4, tiers).total, 3600);
  assert.equal(calculateBulkPrice(1000, 5, tiers).total, 3500);
});

test('flash sale menonaktifkan grosir dan fixed price invalid diabaikan', () => {
  const raw = [{ min_qty: 2, type: 'fixed_price', price: 1000 }];
  assert.deepEqual(normalizeBulkTiers(raw, 1000), []);
  assert.equal(calculateBulkPrice(800, 2, [{ min_qty: 2, percent: 50 }], true).total, 1600);
});

test('admin dan buyer memakai schema percent/fixed price yang sama', () => {
  const root = path.join(__dirname, '..');
  const api = fs.readFileSync(path.join(root, 'src/web/routes/products.js'), 'utf8');
  const admin = fs.readFileSync(path.join(root, 'admin-web/src/pages/Products.jsx'), 'utf8');
  const menu = fs.readFileSync(path.join(root, 'src/handlers/menu.js'), 'utf8');
  assert.match(api, /type === 'fixed_price'/);
  assert.match(api, /price >= prod\.price_idr/);
  assert.match(admin, /Harga\/pcs/);
  assert.match(admin, /value="fixed_price"/);
  assert.match(menu, /calculateBulkPrice/);
  assert.match(menu, /Harga Grosir/);
});
