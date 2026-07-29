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
