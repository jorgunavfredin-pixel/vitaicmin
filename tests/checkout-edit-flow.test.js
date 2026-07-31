const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const makeKeyboard = () => ({ reply_markup: { inline_keyboard: [] } });
const menuPath = path.join(__dirname, '../src/handlers/menu.js');

test('masuk checkout dari pesan banner: hapus banner lalu kirim text', async () => {
  const { sendPaymentConfirmation } = require('../src/handlers/menu');
  const calls = [];
  const ctx = {
    callbackQuery: { message: { message_id: 10, photo: [{}], caption: 'list' } },
    deleteMessage: async () => calls.push(['delete']),
    reply: async (...a) => { calls.push(['reply', ...a]); return { message_id: 11 }; }
  };
  await sendPaymentConfirmation(ctx, '<b>checkout</b>', makeKeyboard());
  assert.deepEqual(calls.map(x => x[0]), ['delete', 'reply']);
});

test('masuk checkout dari pesan text: edit text yang sama tanpa delete', async () => {
  const { sendPaymentConfirmation } = require('../src/handlers/menu');
  const calls = [];
  const ctx = {
    callbackQuery: { message: { message_id: 10, text: 'list' } },
    editMessageText: async (...a) => calls.push(['text', ...a]),
    deleteMessage: async () => calls.push(['delete'])
  };
  await sendPaymentConfirmation(ctx, '<b>checkout</b>', makeKeyboard());
  assert.deepEqual(calls.map(x => x[0]), ['text']);
});

test('flow hybrid: prod_ sadar media/text, quantity selalu edit text, tanpa caption fallback', () => {
  const source = fs.readFileSync(menuPath, 'utf8');
  assert.match(source, /sendPaymentConfirmation\(ctx, message, quantityKeyboard/);
  assert.doesNotMatch(source, /updateCheckoutMessage\(ctx, message/);
  assert.doesNotMatch(source, /CHECKOUT_CAPTION_LIMIT/);
  assert.doesNotMatch(source, /checkoutIsMedia/);
  const helperCalls = (source.match(/sendPaymentConfirmation\(ctx, message, quantityKeyboard/g) || []).length;
  assert.equal(helperCalls, 5); // prod_ + qty_inc, qty_dec, qty_inc5, qty_dec5
});
