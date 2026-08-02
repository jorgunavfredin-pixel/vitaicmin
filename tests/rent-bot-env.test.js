const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mainMenuKeyboard } = require('../src/utils/keyboard');
const { isRentBotEnabled } = require('../src/utils/features');
const { registerSewaBotHandler } = require('../src/handlers/sewabot');

const withFlag = async (value, fn) => {
  const previous = process.env.RENT_BOT_ENABLED;
  if (value === undefined) delete process.env.RENT_BOT_ENABLED;
  else process.env.RENT_BOT_ENABLED = value;
  try { return await fn(); }
  finally {
    if (previous === undefined) delete process.env.RENT_BOT_ENABLED;
    else process.env.RENT_BOT_ENABLED = previous;
  }
};

const menuTexts = () => mainMenuKeyboard('id').reply_markup.keyboard.flat().map(button => button.text);

test('RENT_BOT_ENABLED hanya aktif untuk nilai true dan default false', async () => {
  await withFlag(undefined, () => {
    assert.equal(isRentBotEnabled(), false);
    assert.equal(menuTexts().includes('◇ Sewa Bot'), false);
  });
  await withFlag('false', () => {
    assert.equal(isRentBotEnabled(), false);
    assert.equal(menuTexts().includes('◇ Sewa Bot'), false);
  });
  await withFlag('TRUE', () => {
    assert.equal(isRentBotEnabled(), true);
    assert.equal(menuTexts().includes('◇ Sewa Bot'), true);
  });
});

test('saat disabled tombol cached ditolak dan keyboard utama diperbarui', async () => {
  const hears = [];
  const bot = { hears: (labels, handler) => hears.push({ labels, handler }), action: () => {} };
  registerSewaBotHandler(bot);
  const entry = hears.find(item => item.labels.includes('◇ Sewa Bot'));
  const replies = [];
  await withFlag('false', () => entry.handler({
    from: { id: 123 },
    reply: async (text, extra) => replies.push({ text, extra })
  }));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, 'Fitur Sewa Bot sedang tidak tersedia.');
  assert.equal(replies[0].extra.reply_markup.keyboard.flat().some(button => button.text === '◇ Sewa Bot'), false);
});

test('.env.example mendokumentasikan flag restart-bound tanpa admin-web setting', () => {
  const env = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '../admin-web/src/pages/Settings.jsx'), 'utf8');
  assert.match(env, /^RENT_BOT_ENABLED=false$/m);
  assert.match(env, /perubahan wajib restart\/recreate/);
  assert.doesNotMatch(admin, /RENT_BOT_ENABLED|rent_bot_enabled|Tampilkan Menu Sewa Bot/);
});
