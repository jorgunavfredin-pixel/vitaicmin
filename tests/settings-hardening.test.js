const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runScenario(script) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vitaicmin-settings-'));
  fs.mkdirSync(path.join(root, 'src/models'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/utils'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/web'), { recursive: true });
  try {
    fs.copyFileSync(path.join(__dirname, '../src/models/db.js'), path.join(root, 'src/models/db.js'));
    fs.copyFileSync(path.join(__dirname, '../src/web/auth.js'), path.join(root, 'src/web/auth.js'));
    fs.writeFileSync(path.join(root, 'src/utils/helpers.js'), `exports.getWIBDateRange=()=>({todayStart:'2000-01-01',weekStart:'2000-01-01',monthStart:'2000-01-01'});`);
    fs.writeFileSync(path.join(root, 'runner.js'), `const db=require('./src/models/db'); (async()=>{${script}})().catch(e=>{console.error(e);process.exit(1)});`);
    const env = { ...process.env, NODE_PATH: path.join(__dirname, '../node_modules'), ADMIN_PANEL_PASSWORD: 'old-password' };
    delete env.ADMIN_JWT_SECRET;
    for (const key of ['PAKASIR_API_KEY','PAKASIR_SLUG','WIJAYAPAY_CODE_MERCHANT','WIJAYAPAY_API_KEY','XOWFTWARE_API_KEY','XOWFTWARE_MERCHANT_ID','XOWFTWARE_WEBHOOK_SECRET']) delete env[key];
    const out = spawnSync(process.execPath, ['runner.js'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr || out.stdout);
    return JSON.parse(out.stdout.trim().split('\n').at(-1));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('legacy garansi digabung aman ke SnK dan semua delivery message id tersimpan', () => {
  const out = runScenario(`
    const p=db.addProduct({category_id:'c',name_id:'P',name_en:'P',price_idr:1000,warranty_id:'Garansi lama',terms_id:'Aturan lama',warranty_en:'Old warranty',terms_en:''});
    db.mergeLegacyWarrantyTerms();
    const merged=db.getProductById(p.id);
    const o=db.createOrder({user_id:'1',product_id:p.id,quantity:1,total_idr:1000,status:'delivered'});
    db.updateOrder(o.id,{delivery_message_id:11,delivery_terms_message_id:12,delivery_file_message_id:13});
    const saved=db.getOrderById(o.id);
    console.log(JSON.stringify({terms_id:merged.terms_id,terms_en:merged.terms_en,ids:[saved.delivery_message_id,saved.delivery_terms_message_id,saved.delivery_file_message_id]}));
  `);
  assert.equal(out.terms_id, 'Garansi lama\n\nAturan lama');
  assert.equal(out.terms_en, 'Old warranty');
  assert.deepEqual(out.ids, [11, 12, 13]);
});

test('gateway dengan order pending/processing terdeteksi dan tidak dianggap kosong', () => {
  const out = runScenario(`
    const gw=db.createPaymentGateway({provider:'pakasir',label:'A',credentials:{api_key:'k',slug:'s'}});
    const pending=db.createOrder({user_id:'1',product_id:'P',quantity:1,total_idr:1000,status:'pending',gateway_id:gw.id});
    const done=db.createOrder({user_id:'1',product_id:'P',quantity:1,total_idr:1000,status:'delivered',gateway_id:gw.id});
    console.log(JSON.stringify({active:db.getActiveOrderCountByGateway(gw.id)}));
  `);
  assert.equal(out.active, 1);
});

test('online backup menghasilkan satu SQLite snapshot lengkap dan valid', () => {
  const out = runScenario(`
    const Database=require('better-sqlite3'); const fs=require('fs');
    const dest='./snapshot.db'; await db.backupDatabase(dest);
    const snap=new Database(dest,{readonly:true});
    const integrity=snap.pragma('integrity_check',{simple:true});
    const tables=snap.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('orders','settings','payment_gateways','webhook_events')").get().n;
    snap.close(); console.log(JSON.stringify({integrity,tables,size:fs.statSync(dest).size}));
  `);
  assert.equal(out.integrity, 'ok');
  assert.equal(out.tables, 4);
  assert.ok(out.size > 0);
});

test('login memakai secret otomatis persisten, TTL 24 jam, dan password baru mencabut sesi lama', () => {
  const out = runScenario(`
    const jwt=require('jsonwebtoken'); const auth=require('./src/web/auth');
    let response;
    auth.login({body:{password:'old-password'}},{json:v=>{response=v;return v},status:()=>({json:v=>{throw Error(JSON.stringify(v))}})});
    const oldPayload=jwt.verify(response.token,auth.getSecret());
    const before=auth.getSessionVersion();
    auth.changePassword('old-password','new-password-123');
    const after=auth.getSessionVersion();
    console.log(JSON.stringify({ttl:oldPayload.exp-oldPayload.iat,tokenVersion:oldPayload.sv,before,after,secretLength:auth.getSecret().length}));
  `);
  assert.equal(out.ttl, 86400);
  assert.equal(out.tokenVersion, out.before);
  assert.equal(out.after, out.before + 1);
  assert.equal(out.secretLength, 64);
});

test('recovery key .env menghapus password custom dan mencabut sesi lama', () => {
  const out = runScenario(`
    const auth=require('./src/web/auth');
    auth.changePassword('old-password','custom-password');
    const customValid=auth.verifyPassword('custom-password');
    const before=auth.getSessionVersion();
    auth.resetPasswordToEnv('old-password');
    console.log(JSON.stringify({customValid,envValid:auth.verifyPassword('old-password'),customStillValid:auth.verifyPassword('custom-password'),before,after:auth.getSessionVersion()}));
  `);
  assert.equal(out.customValid, true);
  assert.equal(out.envValid, true);
  assert.equal(out.customStillValid, false);
  assert.equal(out.after, out.before + 1);
});

test('forgot-password dibatasi 5 percobaan per IP per 15 menit', () => {
  const out = runScenario(`
    const auth=require('./src/web/auth'); const codes=[];
    for(let i=0;i<6;i++){
      let code=200;
      const res={status:c=>{code=c;return res},json:()=>{codes.push(code)}};
      auth.forgotPassword({ip:'203.0.113.10',body:{recoveryPassword:'wrong',newPassword:'valid-password'}},res);
    }
    console.log(JSON.stringify({codes}));
  `);
  assert.deepEqual(out.codes, [400,400,400,400,400,429]);
});

test('delivery claim atomik: hanya satu dari callback/polling/manual yang menang', () => {
  const out = runScenario(`
    const o=db.createOrder({user_id:'1',product_id:'TOPUP',quantity:1,total_idr:1000,payment_method:'qris',status:'pending',gateway_id:'gw'});
    console.log(JSON.stringify({first:db.claimOrderForDelivery(o.id),second:db.claimOrderForDelivery(o.id),status:db.getOrderById(o.id).status}));
  `);
  assert.deepEqual(out, { first: true, second: false, status: 'processing_delivery' });
});

test('expiry dan delivery memakai claim terminal yang saling eksklusif', () => {
  const out = runScenario(`
    const a=db.createOrder({user_id:'1',product_id:'P',quantity:1,total_idr:1000,payment_method:'qris',status:'pending',gateway_id:'gw'});
    const delivery=db.claimOrderForDelivery(a.id); const expiryAfter=db.claimOrderForExpiry(a.id);
    const b=db.createOrder({user_id:'1',product_id:'P',quantity:1,total_idr:1000,payment_method:'qris',status:'pending',gateway_id:'gw'});
    const expiry=db.claimOrderForExpiry(b.id); const deliveryAfter=db.claimOrderForDelivery(b.id);
    console.log(JSON.stringify({delivery,expiryAfter,expiry,deliveryAfter}));
  `);
  assert.deepEqual(out, { delivery: true, expiryAfter: false, expiry: true, deliveryAfter: false });
});

test('TOPUP settlement exactly-once meski dipanggil ulang', () => {
  const out = runScenario(`
    const o=db.createOrder({user_id:'7',product_id:'TOPUP',quantity:1,total_idr:2500,payment_method:'qris',status:'pending',gateway_id:'gw'});
    db.claimOrderForDelivery(o.id); const first=db.completeTopupOrder(o.id); const second=db.completeTopupOrder(o.id);
    const bal=db._db.prepare('SELECT balance FROM balances WHERE user_id=?').get('7').balance;
    const hist=db._db.prepare('SELECT COUNT(*) n FROM balance_history WHERE order_id=?').get(o.id).n;
    console.log(JSON.stringify({first,second,bal,hist,status:db.getOrderById(o.id).status}));
  `);
  assert.deepEqual(out, { first: true, second: false, bal: 2500, hist: 1, status: 'delivered' });
});

test('polling queue hanya QRIS pending valid dan terikat gateway', () => {
  const out = runScenario(`
    const future=new Date(Date.now()+60000).toISOString(), past=new Date(Date.now()-60000).toISOString();
    const good=db.createOrder({user_id:'1',product_id:'P',quantity:1,total_idr:1000,payment_method:'qris',status:'pending',gateway_id:'gw',expires_at:future});
    db.createOrder({user_id:'1',product_id:'P',quantity:1,total_idr:1000,payment_method:'saldo',status:'pending',gateway_id:'gw',expires_at:future});
    db.createOrder({user_id:'1',product_id:'P',quantity:1,total_idr:1000,payment_method:'qris',status:'pending',expires_at:future});
    db.createOrder({user_id:'1',product_id:'P',quantity:1,total_idr:1000,payment_method:'qris',status:'pending',gateway_id:'gw',expires_at:past});
    console.log(JSON.stringify({ids:db.getPendingQRISOrders().map(x=>x.id),good:good.id}));
  `);
  assert.deepEqual(out.ids, [out.good]);
});

test('reservasi stok atomik dan idempotent per order', () => {
  const out = runScenario(`
    db._db.prepare("INSERT INTO products (id,name_id,stock_mode,active,created_at) VALUES ('P','Produk','limited',1,?)").run(new Date().toISOString());
    db._db.prepare("INSERT INTO stock (id,product_id,data,sold,added_at) VALUES ('S1','P','a',0,?),('S2','P','b',0,?)").run(new Date().toISOString(),new Date().toISOString());
    const a=db.reserveStock('P',2,'ORDER-A'); const again=db.reserveStock('P',2,'ORDER-A'); const b=db.reserveStock('P',1,'ORDER-B');
    console.log(JSON.stringify({a,again,b,reserved:db.getReservedStock('ORDER-A').length}));
  `);
  assert.equal(out.a.length, 2);
  assert.deepEqual(out.again, out.a);
  assert.equal(out.b, null);
  assert.equal(out.reserved, 2);
});

test('product settlement mengubah stok dan order dalam satu transaksi', () => {
  const out = runScenario(`
    db._db.prepare("INSERT INTO products (id,name_id,stock_mode,active,created_at) VALUES ('P','Produk','limited',1,?)").run(new Date().toISOString());
    db._db.prepare("INSERT INTO stock (id,product_id,data,sold,added_at) VALUES ('S1','P','credential',0,?)").run(new Date().toISOString());
    const order=db.createOrder({user_id:'1',product_id:'P',quantity:1,total_idr:1000,status:'pending'});
    db.reserveStock('P',1,order.id); db.claimOrderForDelivery(order.id);
    const before=db.getOrderById(order.id).status; const ok=db.completeProductOrder(order.id,['S1'],['credential'],'TX');
    const after=db.getOrderById(order.id); const stock=db._db.prepare("SELECT sold,order_id FROM stock WHERE id='S1'").get();
    console.log(JSON.stringify({before,ok,status:after.status,proof:after.payment_proof,sold:stock.sold,stockOrder:stock.order_id,orderId:order.id}));
  `);
  assert.equal(out.before, 'processing_delivery');
  assert.equal(out.ok, true);
  assert.equal(out.status, 'delivered');
  assert.equal(out.proof, 'TX');
  assert.equal(out.sold, 1);
  assert.equal(out.stockOrder, out.orderId);
});

test('cleanup QRIS processing expired dan active topup detection', () => {
  const out = runScenario(`
    db._db.prepare("INSERT INTO products (id,name_id,stock_mode,active,created_at) VALUES ('P','Produk','limited',1,?)").run(new Date().toISOString());
    db._db.prepare("INSERT INTO stock (id,product_id,data,sold,added_at) VALUES ('S1','P','a',0,?)").run(new Date().toISOString());
    const stale=db.createOrder({user_id:'1',product_id:'P',quantity:1,total_idr:1000,status:'processing',payment_method:'qris',expires_at:'2000-01-01T00:00:00.000Z'});
    db.reserveStock('P',1,stale.id);
    const topup=db.createOrder({user_id:'2',product_id:'TOPUP',quantity:1,total_idr:5000,status:'pending',payment_method:'qris'});
    const recovered=db.recoverStaleQrisProcessing();
    console.log(JSON.stringify({recovered,status:db.getOrderById(stale.id).status,reserved:db.getReservedStock(stale.id).length,active:db.getActiveTopupOrderByUser('2').id===topup.id}));
  `);
  assert.deepEqual(out, { recovered: 1, status: 'cancelled', reserved: 0, active: true });
});

test('voucher hold mencegah user memakai kode sama di dua order', () => {
  const out = runScenario(`
    db.createVoucher({code:'HEMAT',type:'percent',value:10});
    const a=db.createOrder({user_id:'1',product_id:'P',quantity:1,total_idr:1000,status:'init'});
    const b=db.createOrder({user_id:'1',product_id:'P',quantity:1,total_idr:1000,status:'init'});
    const first=db.claimVoucherHold('HEMAT','1',a.id);
    const duplicate=db.claimVoucherHold('HEMAT','1',b.id);
    const released=db.releaseVoucherHold(a.id);
    const afterRelease=db.claimVoucherHold('HEMAT','1',b.id);
    console.log(JSON.stringify({first,duplicate,released,afterRelease}));
  `);
  assert.deepEqual(out, { first: true, duplicate: false, released: true, afterRelease: true });
});

test('product settlement mengubah voucher hold menjadi redemption atomik', () => {
  const out = runScenario(`
    db._db.prepare("INSERT INTO products (id,name_id,stock_mode,active,created_at) VALUES ('PV','Produk','limited',1,?)").run(new Date().toISOString());
    db._db.prepare("INSERT INTO stock (id,product_id,data,sold,added_at) VALUES ('SV','PV','credential',0,?)").run(new Date().toISOString());
    db.createVoucher({code:'SAVE',type:'percent',value:10});
    const order=db.createOrder({user_id:'9',product_id:'PV',quantity:1,total_idr:900,status:'pending'});
    db.updateOrder(order.id,{voucher_code:'SAVE'}); db.claimVoucherHold('SAVE','9',order.id); db.reserveStock('PV',1,order.id); db.claimOrderForDelivery(order.id);
    const ok=db.completeProductOrder(order.id,['SV'],['credential']);
    const holds=db._db.prepare('SELECT COUNT(*) n FROM voucher_holds WHERE order_id=?').get(order.id).n;
    const redeemed=db.hasUserRedeemedVoucher('SAVE','9');
    console.log(JSON.stringify({ok,holds,redeemed,status:db.getOrderById(order.id).status}));
  `);
  assert.deepEqual(out, { ok: true, holds: 0, redeemed: true, status: 'delivered' });
});

test('expired voucher holds dipurge ringan', () => {
  const out = runScenario(`
    db.createVoucher({code:'OLD',type:'fixed',value:100});
    const o=db.createOrder({user_id:'3',product_id:'P',quantity:1,total_idr:1000,status:'init'});
    db.claimVoucherHold('OLD','3',o.id,'2000-01-01T00:00:00.000Z');
    const purged=db.purgeExpiredVoucherHolds();
    const left=db._db.prepare('SELECT COUNT(*) n FROM voucher_holds').get().n;
    console.log(JSON.stringify({purged,left}));
  `);
  assert.deepEqual(out, { purged: 1, left: 0 });
});

test('flash sale slot opsional menghitung transaksi sukses dan menonaktifkan harga saat habis', () => {
  const out = runScenario(`
    const now=Date.now(), start=new Date(now-60000).toISOString(), end=new Date(now+60000).toISOString();
    db._db.prepare("INSERT INTO products (id,name_id,price_idr,stock_mode,active,created_at) VALUES ('FS','Flash',1000,'unlimited',1,?)").run(new Date().toISOString());
    db.setFlashSale('FS',500,start,end,2);
    for(let i=0;i<2;i++) db.createOrder({user_id:String(i),product_id:'FS',quantity:1,total_idr:500,status:'delivered',flash_sale_applied:true});
    const p=db.getProductById('FS'), stats=db.getFlashSaleSlotStats(p);
    db._db.prepare("INSERT INTO products (id,name_id,price_idr,stock_mode,active,created_at) VALUES ('UNL','Unlimited',1000,'unlimited',1,?)").run(new Date().toISOString());
    db.setFlashSale('UNL',700,start,end,null); const unlimited=db.getFlashSaleSlotStats(db.getProductById('UNL'));
    console.log(JSON.stringify({stats,active:db.isFlashSaleActive(p),price:db.getEffectivePrice(p),unlimited}));
  `);
  assert.equal(out.stats.used, 2);
  assert.equal(out.stats.remaining, 0);
  assert.equal(out.stats.percent, 100);
  assert.equal(out.stats.filled, 10);
  assert.equal(out.active, false);
  assert.equal(out.price, 1000);
  assert.equal(out.unlimited.limited, false);
});

test('slot flash atomik: hanya satu order menang, release dapat direbut ulang, settlement consume', () => {
  const out = runScenario(`
    const now=Date.now(), start=new Date(now-60000).toISOString(), end=new Date(now+3600000).toISOString(), exp=new Date(now+900000).toISOString();
    db._db.prepare("INSERT INTO products (id,name_id,price_idr,stock_mode,active,created_at) VALUES ('RACE','Race',1000,'unlimited',1,?)").run(new Date().toISOString());
    db.setFlashSale('RACE',500,start,end,1);
    const a=db.createOrder({user_id:'A',product_id:'RACE',quantity:1,total_idr:500,status:'init',flash_sale_applied:true});
    const b=db.createOrder({user_id:'B',product_id:'RACE',quantity:1,total_idr:500,status:'init',flash_sale_applied:true});
    const aClaim=db.claimFlashSaleSlot(a.id,exp), bFirst=db.claimFlashSaleSlot(b.id,exp);
    const heldStats=db.getFlashSaleSlotStats(db.getProductById('RACE'));
    db.releaseFlashSaleSlot(a.id); const bClaim=db.claimFlashSaleSlot(b.id,exp);
    db.updateOrder(b.id,{status:'processing_delivery'}); const settled=db.completeProductOrder(b.id,[],[],null);
    const finalStats=db.getFlashSaleSlotStats(db.getProductById('RACE'));
    const hold=db._db.prepare('SELECT status FROM flash_sale_holds WHERE order_id=?').get(b.id);
    console.log(JSON.stringify({aClaim,bFirst,heldStats,bClaim,settled,finalStats,hold}));
  `);
  assert.equal(out.aClaim.ok, true);
  assert.equal(out.bFirst.ok, false);
  assert.equal(out.heldStats.held, 1);
  assert.equal(out.heldStats.remaining, 0);
  assert.equal(out.bClaim.ok, true);
  assert.equal(out.settled, true);
  assert.equal(out.finalStats.used, 1);
  assert.equal(out.finalStats.held, 0);
  assert.equal(out.hold.status, 'consumed');
});
