const test = require('node:test');
const assert = require('node:assert/strict');

const makeKeyboard = () => ({ reply_markup: { inline_keyboard: [] } });

test('checkout banner pendek mengedit caption yang sama', async () => {
  const { updateCheckoutMessage } = require('../src/handlers/menu');
  const calls = [];
  const ctx = {
    callbackQuery: { message: { message_id: 10, photo: [{}], caption: 'list' } },
    editMessageCaption: async (...a) => calls.push(['caption', ...a]),
    editMessageText: async (...a) => calls.push(['text', ...a]),
    deleteMessage: async () => calls.push(['delete']),
    reply: async () => calls.push(['reply'])
  };
  await updateCheckoutMessage(ctx, '<b>checkout</b>', makeKeyboard());
  assert.deepEqual(calls.map(x => x[0]), ['caption']);
});

test('checkout banner terlalu panjang fallback menjadi text', async () => {
  const { updateCheckoutMessage, CHECKOUT_CAPTION_LIMIT } = require('../src/handlers/menu');
  const calls = [];
  const ctx = {
    callbackQuery: { message: { message_id: 10, photo: [{}], caption: 'list' } },
    deleteMessage: async () => calls.push(['delete']),
    reply: async (...a) => { calls.push(['reply', ...a]); return { message_id: 11 }; }
  };
  await updateCheckoutMessage(ctx, 'x'.repeat(CHECKOUT_CAPTION_LIMIT + 1), makeKeyboard());
  assert.deepEqual(calls.map(x => x[0]), ['delete', 'reply']);
});

test('checkout tanpa banner mengedit text yang sama', async () => {
  const { updateCheckoutMessage } = require('../src/handlers/menu');
  const calls = [];
  const ctx = {
    callbackQuery: { message: { message_id: 10, text: 'list' } },
    editMessageText: async (...a) => calls.push(['text', ...a]),
    deleteMessage: async () => calls.push(['delete']),
    reply: async () => calls.push(['reply'])
  };
  await updateCheckoutMessage(ctx, '<b>checkout</b>', makeKeyboard());
  assert.deepEqual(calls.map(x => x[0]), ['text']);
});

const fs = require('node:fs');
const path = require('node:path');
test('konfirmasi menghapus media checkout tetapi mengedit checkout text', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/handlers/menu.js'), 'utf8');
  assert.match(source, /sendPaymentConfirmation/);
  assert.match(source, /message\?\.photo/);
  assert.match(source, /editMessageCaption/);
  assert.match(source, /editMessageText/);
  assert.match(source, /editMessageCaption\(state\.chatId/);
});
