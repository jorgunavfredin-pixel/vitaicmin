const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let cachedStats;

function getFixtureStats() {
  if (cachedStats) return cachedStats;

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vitaicmin-stats-'));
  const modelsDir = path.join(tempRoot, 'src/models');
  const utilsDir = path.join(tempRoot, 'src/utils');
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(utilsDir, { recursive: true });

  try {
    fs.copyFileSync(
      path.join(__dirname, '../src/models/db.js'),
      path.join(modelsDir, 'db.js')
    );

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
      const sqlite = db._db;
      const insert = sqlite.prepare(\`
        INSERT INTO orders
          (id, product_id, quantity, total_idr, payment_method, status, created_at, paid_at, delivered_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      \`);
      const now = '2026-01-01T00:00:00.000Z';

      insert.run('SALE-QRIS', 'PROD-A', 1, 1000, 'qris', 'delivered', now, now, now);
      insert.run('TOPUP-QRIS', 'TOPUP', 1, 500, 'qris', 'delivered', now, now, now);
      insert.run('SALE-SALDO', 'PROD-B', 1, 300, 'saldo', 'paid', now, now, null);
      insert.run('EXPIRED', 'PROD-C', 1, 999, 'qris', 'expired', now, null, null);

      console.log(JSON.stringify(db.getDetailedStats()));
    `);

    const childEnv = {
      ...process.env,
      NODE_PATH: path.join(__dirname, '../node_modules')
    };
    delete childEnv.PAKASIR_API_KEY;
    delete childEnv.PAKASIR_SLUG;

    const result = spawnSync(process.execPath, [runner], {
      cwd: tempRoot,
      env: childEnv,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const jsonLine = result.stdout.trim().split('\n').at(-1);
    cachedStats = JSON.parse(jsonLine);
    return cachedStats;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('omzet all-time hanya menghitung penjualan produk, bukan topup', () => {
  const stats = getFixtureStats();

  assert.deepEqual(stats.income.all_time, {
    total: 1300,
    qris: 1000,
    saldo: 300
  });
});

test('topup tetap dihitung sebagai transaksi sukses', () => {
  const stats = getFixtureStats();

  assert.equal(stats.transactions.success, 3);
  assert.equal(stats.transactions.total_success, 3);
});
