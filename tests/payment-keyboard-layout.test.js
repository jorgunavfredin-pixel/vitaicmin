const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPaymentButtonRows } = require('../src/utils/keyboard');

const gateways = (count) => Array.from({ length: count }, (_, i) => ({
  id: `GW-${i + 1}`,
  provider: i === 0 ? 'pakasir' : 'wijayapay'
}));

const labels = (rows) => rows.map(row => row.map(button => button.text));

test('1 gateway: QRIS 1 dan Saldo satu baris', () => {
  const rows = buildPaymentButtonRows('ORD-1', gateways(1), true, '▣ QRIS', '💰 Saldo', 'pay_saldo_ORD-1');
  assert.deepEqual(labels(rows), [['▣ QRIS 1', '💰 Saldo']]);
});

test('2 gateway: QRIS sebaris, Saldo di baris berikutnya', () => {
  const rows = buildPaymentButtonRows('ORD-1', gateways(2), true, '▣ QRIS', '💰 Saldo', 'pay_saldo_ORD-1');
  assert.deepEqual(labels(rows), [
    ['▣ QRIS 1', '▣ QRIS 2'],
    ['💰 Saldo']
  ]);
});

test('3 gateway: QRIS 3 ditemani Saldo', () => {
  const rows = buildPaymentButtonRows('ORD-1', gateways(3), true, '▣ QRIS', '💰 Saldo', 'pay_saldo_ORD-1');
  assert.deepEqual(labels(rows), [
    ['▣ QRIS 1', '▣ QRIS 2'],
    ['▣ QRIS 3', '💰 Saldo']
  ]);
});

test('callback QRIS langsung menunjuk gateway yang dipilih', () => {
  const rows = buildPaymentButtonRows('VTC-20260728-0005', gateways(2), true, '▣ QRIS', '💰 Saldo', 'pay_saldo_x');
  assert.equal(rows[0][0].callback, 'pay_qgw_GW-1_VTC-20260728-0005');
  assert.equal(rows[0][1].callback, 'pay_qgw_GW-2_VTC-20260728-0005');
});
