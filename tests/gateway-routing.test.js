const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Jalankan skenario routing di proses anak dengan DB SQLite terisolasi (temp dir),
// meniru pola stats-revenue.test.js. Setiap skenario menyuntik gateway lalu memanggil
// fungsi routing db.js dan mencetak hasilnya sebagai JSON untuk di-assert.
function runScenario(script) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vitaicmin-routing-'));
  const modelsDir = path.join(tempRoot, 'src/models');
  const utilsDir = path.join(tempRoot, 'src/utils');
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(utilsDir, { recursive: true });

  try {
    fs.copyFileSync(
      path.join(__dirname, '../src/models/db.js'),
      path.join(modelsDir, 'db.js')
    );
    // helpers.js minimal (db.js hanya butuh getWIBDateRange dari sini saat getDetailedStats).
    fs.writeFileSync(path.join(utilsDir, 'helpers.js'), `
      exports.getWIBDateRange = () => ({
        todayStart: '2000-01-01T00:00:00.000Z',
        weekStart: '2000-01-01T00:00:00.000Z',
        monthStart: '2000-01-01T00:00:00.000Z'
      });
    `);

    const runner = path.join(tempRoot, 'runner.js');
    fs.writeFileSync(runner, `
      const db = require('./src/models/db');
      ${script}
    `);

    const childEnv = { ...process.env, NODE_PATH: path.join(__dirname, '../node_modules') };
    delete childEnv.PAKASIR_API_KEY;
    delete childEnv.PAKASIR_SLUG;

    const result = spawnSync(process.execPath, [runner], {
      cwd: tempRoot, env: childEnv, encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const jsonLine = result.stdout.trim().split('\n').at(-1);
    return JSON.parse(jsonLine);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('strategi priority memilih gateway prioritas terkecil', () => {
  const out = runScenario(`
    db.createPaymentGateway({ provider: 'pakasir', label: 'A', credentials: { api_key: 'ka', slug: 'sa' }, priority: 10 });
    db.createPaymentGateway({ provider: 'pakasir', label: 'B', credentials: { api_key: 'kb', slug: 'sb' }, priority: 1 });
    db.updateSettings({ gateway_strategy: 'priority' });
    const g = db.getRoutedGateway('pakasir');
    console.log(JSON.stringify({ label: g.label, slug: g.credentials.slug }));
  `);
  assert.equal(out.label, 'B');
  assert.equal(out.slug, 'sb');
});

test('round robin bergilir merata lalu berulang', () => {
  const out = runScenario(`
    db.createPaymentGateway({ provider: 'pakasir', label: 'A', credentials: { api_key: 'ka', slug: 'sa' }, priority: 1 });
    db.createPaymentGateway({ provider: 'pakasir', label: 'B', credentials: { api_key: 'kb', slug: 'sb' }, priority: 2 });
    db.updateSettings({ gateway_strategy: 'round_robin', gateway_rr_index: 0 });
    const seq = [];
    for (let i = 0; i < 4; i++) seq.push(db.getRoutedGateway('pakasir').label);
    console.log(JSON.stringify({ seq }));
  `);
  assert.deepEqual(out.seq, ['A', 'B', 'A', 'B']);
});

test('strategi manual memakai gateway pilihan; fallback ke prioritas kalau invalid', () => {
  const out = runScenario(`
    const a = db.createPaymentGateway({ provider: 'pakasir', label: 'A', credentials: { api_key: 'ka', slug: 'sa' }, priority: 1 });
    const b = db.createPaymentGateway({ provider: 'pakasir', label: 'B', credentials: { api_key: 'kb', slug: 'sb' }, priority: 2 });
    db.updateSettings({ gateway_strategy: 'manual', gateway_manual_id: b.id });
    const picked = db.getRoutedGateway('pakasir').label;
    // Manual id invalid → fallback ke prioritas tertinggi (A)
    db.updateSettings({ gateway_manual_id: 'GW-does-not-exist' });
    const fallback = db.getRoutedGateway('pakasir').label;
    console.log(JSON.stringify({ picked, fallback }));
  `);
  assert.equal(out.picked, 'B');
  assert.equal(out.fallback, 'A');
});

test('getGatewayCredentialById mengembalikan credential gateway SPESIFIK (bukan yang aktif)', () => {
  const out = runScenario(`
    const a = db.createPaymentGateway({ provider: 'pakasir', label: 'A', credentials: { api_key: 'ka', slug: 'sa' }, priority: 1 });
    const b = db.createPaymentGateway({ provider: 'pakasir', label: 'B', credentials: { api_key: 'kb', slug: 'sb' }, priority: 2 });
    // Gateway aktif (priority) = A, tapi kita minta credential milik B secara eksplisit.
    const cred = db.getGatewayCredentialById(b.id, 'pakasir');
    console.log(JSON.stringify({ slug: cred.slug, api_key: cred.api_key }));
  `);
  assert.equal(out.slug, 'sb');
  assert.equal(out.api_key, 'kb');
});

test('gateway nonaktif tidak pernah dipilih routing', () => {
  const out = runScenario(`
    const a = db.createPaymentGateway({ provider: 'pakasir', label: 'A', credentials: { api_key: 'ka', slug: 'sa' }, priority: 1, enabled: false });
    const b = db.createPaymentGateway({ provider: 'pakasir', label: 'B', credentials: { api_key: 'kb', slug: 'sb' }, priority: 2, enabled: true });
    db.updateSettings({ gateway_strategy: 'priority' });
    const g = db.getRoutedGateway('pakasir');
    console.log(JSON.stringify({ label: g.label }));
  `);
  assert.equal(out.label, 'B');
});

test('tanpa gateway enabled, routing mengembalikan null (caller fallback ke env)', () => {
  const out = runScenario(`
    db.createPaymentGateway({ provider: 'pakasir', label: 'A', credentials: { api_key: 'ka', slug: 'sa' }, priority: 1, enabled: false });
    const g = db.getRoutedGateway('pakasir');
    console.log(JSON.stringify({ isNull: g === null }));
  `);
  assert.equal(out.isNull, true);
});
