const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runStockFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vita-stock-phase2-'));
  const models = path.join(root, 'src/models');
  fs.mkdirSync(models, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../src/models/db.js'), path.join(models, 'db.js'));
  const runner = path.join(root, 'run.js');
  fs.writeFileSync(runner, `
    const db = require('./src/models/db');
    db._db.prepare("INSERT INTO categories (id,name_id,name_en,created_at) VALUES ('C','Cat','Cat','now')").run();
    db._db.prepare("INSERT INTO products (id,category_id,name_id,name_en,price_idr,stock_type,stock_mode,active,created_at) VALUES ('P','C','Prod','Prod',1000,'code','limited',1,'now')").run();
    const ins = db._db.prepare('INSERT INTO stock (id,product_id,data,sold,reserved_by,added_at) VALUES (?,?,?,?,?,?)');
    ins.run('READY','P','ready-data',0,null,'1');
    ins.run('RESERVED','P','reserved-data',0,'ORDER-1','2');
    ins.run('SOLD','P','sold-data',1,null,'3');
    const events=[]; db.dbEvents.on('product_change', e => events.push(e));
    const reservedDelete = db.deleteStock('RESERVED');
    const readyDelete = db.deleteStock('READY');
    ins.run('READY2','P','ready-2',0,null,'4');
    const clear = db.clearProductStock('P');
    console.log(JSON.stringify({ reservedDelete, readyDelete, clear, summary: db.getStockSummary('P'), reservedStill: !!db._db.prepare("SELECT 1 FROM stock WHERE id='RESERVED'").get(), events }));
  `);
  try {
    const r = spawnSync(process.execPath, [runner], { cwd: root, env: { ...process.env, NODE_PATH: path.join(__dirname, '../node_modules') }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return JSON.parse(r.stdout.trim().split('\n').at(-1));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('writer stok melindungi reserved dan Clear All hanya menghapus ready', () => {
  const r = runStockFixture();
  assert.equal(r.reservedDelete, false);
  assert.equal(r.readyDelete, true);
  assert.deepEqual(r.clear, { removed: 1, reserved: 1 });
  assert.deepEqual(r.summary, { ready: 0, reserved: 1, sold: 1 });
  assert.equal(r.reservedStill, true);
  assert.equal(r.events.length, 2);
});

test('chat stok menampilkan counter, menghapus N-terakhir, dan memakai Clear All Ready', () => {
  const products = fs.readFileSync(path.join(__dirname, '../src/admin/products.js'), 'utf8');
  const keyboard = fs.readFileSync(path.join(__dirname, '../src/utils/keyboard.js'), 'utf8');
  assert.match(products, /<b>Ready:<\/b> \$\{summary\.ready\}/);
  assert.match(products, /<b>Reserved:<\/b> \$\{summary\.reserved\}/);
  assert.match(products, /<b>Terjual:<\/b> \$\{summary\.sold\}/);
  assert.match(products, /db\.getUnsoldUnreservedStock\(state\.prodId\)/);
  assert.doesNotMatch(products, /rm_stock_count|handleRemoveStockCount/);
  assert.doesNotMatch(keyboard, /adm_stock_rm_count|hapus X terakhir/);
  assert.match(products, /Clear All Ready selesai/);
  assert.match(products, /adm_stock_prod_\$\{p\.id\}_sc/);
  assert.match(keyboard, /adm_stock_prod_\$\{productId\}_pv/);
  assert.match(products, /stockBackContext/);
});

test('backup chat memakai online backup bersama dan selalu membersihkan temporary file', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/admin/settings.js'), 'utf8');
  assert.match(source, /await db\.backupDatabase\(backupPath\)/);
  assert.match(source, /finally/);
  assert.doesNotMatch(source, /wal_checkpoint|copyFileSync|new Database/);
});

test('mutasi stok menerbitkan product_change untuk refresh web', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/models/db.js'), 'utf8');
  assert.match(source, /dbEvents\.emit\('product_change'/);
  assert.match(source, /stock_clear_ready/);
  assert.match(source, /stock_delete/);
});
