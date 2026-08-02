const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/models/db');
const bannerPath = require.resolve('../src/utils/banner');
const originalBanner = require(bannerPath);
const bannerCalls = [];
require.cache[bannerPath].exports = {
  ...originalBanner,
  replyWithBanner: async (...args) => { bannerCalls.push(args); }
};
delete require.cache[require.resolve('../src/handlers/keyboard')];
const { registerKeyboardHandler } = require('../src/handlers/keyboard');
require.cache[bannerPath].exports = originalBanner;

const actions = [];
const hears = [];
const bot = {
  action: (trigger, handler) => actions.push({ trigger, handler }),
  hears: (trigger, handler) => hears.push({ trigger, handler }),
  on: () => {}
};
registerKeyboardHandler(bot);

const actionFor = (data) => {
  for (const item of actions) {
    if (typeof item.trigger === 'string' && item.trigger === data) return { handler: item.handler, match: null };
    if (item.trigger instanceof RegExp) {
      const match = data.match(item.trigger);
      if (match) return { handler: item.handler, match };
    }
  }
  throw new Error(`action not registered: ${data}`);
};

const stockHears = hears.find(item => Array.isArray(item.trigger) && item.trigger.includes('▤ Cek Stok')).handler;
const originals = {};
const mockDb = (readyCount) => {
  for (const key of ['getUserLanguage', 'getCategories', 'getProductsByCategory', 'getAvailableStockCount', 'getConfig', 'getActiveFlashSales']) {
    originals[key] = db[key];
  }
  const categories = Array.from({ length: readyCount + 1 }, (_, i) => ({
    id: `cat-${i + 1}`,
    name_id: i === readyCount ? 'Kosong' : `Kategori ${String(i + 1).padStart(2, '0')}`,
    name_en: i === readyCount ? 'Empty' : `Category ${String(i + 1).padStart(2, '0')}`,
    active: true
  }));
  db.getUserLanguage = () => 'id';
  db.getCategories = () => categories;
  db.getProductsByCategory = id => [{
    id: `prod-${id}`,
    name_id: id === 'cat-1' ? 'A&B <Tools>' : `Produk ${id}`,
    name_en: `Product ${id}`,
    active: true
  }];
  db.getAvailableStockCount = id => id === `prod-cat-${readyCount + 1}` ? 0 : Number(id.split('-').at(-1));
  db.getConfig = () => 'Store';
  db.getActiveFlashSales = () => [];
};
const restoreDb = () => Object.assign(db, originals);

const makeCtx = (match = null) => {
  const calls = { replies: [], edits: [], deletes: 0, answers: [] };
  return {
    from: { id: 7 }, chat: { id: 8 }, match,
    callbackQuery: { message: { message_id: 9 } },
    answerCbQuery: async text => calls.answers.push(text),
    reply: async (text, extra) => calls.replies.push({ text, extra }),
    editMessageText: async (text, extra) => calls.edits.push({ text, extra }),
    deleteMessage: async () => { calls.deletes += 1; },
    calls
  };
};

test('cek stok memakai layout compact, menyembunyikan stok nol, dan case admin tetap utuh', async () => {
  mockDb(7);
  try {
    const ctx = makeCtx();
    await stockHears(ctx);
    assert.equal(ctx.calls.replies.length, 1);
    const { text, extra } = ctx.calls.replies[0];
    assert.match(text, /^<blockquote>📦 <b>Status Stok<\/b>\n7 Kategori • 7 Produk Ready<\/blockquote>\n/);
    assert.match(text, /<b>Kategori 01<\/b>\n└ A&amp;B &lt;Tools&gt; · 1 pcs/);
    assert.doesNotMatch(text, /<b>Kosong<\/b>|↳|━━━━━━━━|●|○/);
    assert.match(text, /<blockquote>⟲ Diperbarui .+ WIB<\/blockquote>$/);
    assert.equal(extra.parse_mode, 'HTML');
    assert.deepEqual(extra.reply_markup.inline_keyboard[0].map(b => b.text), ['⟲ Refresh']);
    assert.equal(extra.reply_markup.inline_keyboard[1][0].text, '⌂ Kembali ke Kategori');
  } finally { restoreDb(); }
});

test('pagination stok maksimal 10 kategori dan tombolnya kondisional', async () => {
  mockDb(21);
  try {
    for (const [data, expected] of [
      ['stock_page_0', ['⟲ Refresh (1/3)', 'Selanjutnya ›']],
      ['stock_page_1', ['‹ Sebelumnya', '⟲ Refresh (2/3)', 'Selanjutnya ›']],
      ['stock_page_2', ['‹ Sebelumnya', '⟲ Refresh (3/3)']]
    ]) {
      const found = actionFor(data);
      const ctx = makeCtx(found.match);
      await found.handler(ctx);
      const row = ctx.calls.edits[0].extra.reply_markup.inline_keyboard[0];
      assert.deepEqual(row.map(b => b.text), expected);
      const categoryCount = (ctx.calls.edits[0].text.match(/<b>Kategori \d+<\/b>/g) || []).length;
      assert.equal(categoryCount, data.endsWith('_2') ? 1 : 10);
    }
  } finally { restoreDb(); }
});

test('refresh mempertahankan halaman aktif dan kembali mengirim builder kategori baru tanpa delete', async () => {
  mockDb(21);
  bannerCalls.length = 0;
  try {
    const refresh = actionFor('stock_refresh_1');
    const refreshCtx = makeCtx(refresh.match);
    await refresh.handler(refreshCtx);
    assert.equal(refreshCtx.calls.edits.length, 1);
    assert.equal(refreshCtx.calls.edits[0].extra.reply_markup.inline_keyboard[0][1].text, '⟲ Refresh (2/3)');

    const back = actionFor('stock_back_categories');
    const backCtx = makeCtx();
    await back.handler(backCtx);
    assert.equal(backCtx.calls.deletes, 0);
    assert.equal(backCtx.calls.edits.length, 0);
    assert.equal(bannerCalls.length, 1);
    assert.match(bannerCalls[0][1], /Welcome to <b>Store<\/b>/);
  } finally { restoreDb(); }
});
