const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runFixture(script) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vita-admin3-'));
  for (const dir of ['src/models','src/services','src/payments','src/utils']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of ['src/models/db.js','src/services/adminOrders.js','src/services/adminBalance.js','src/payments/balance.js']) {
    fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
  }
  fs.writeFileSync(path.join(root, 'run.js'), script);
  try {
    const r = spawnSync(process.execPath, ['run.js'], { cwd: root, env: { ...process.env, NODE_PATH: path.join(__dirname, '../node_modules') }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return JSON.parse(r.stdout.trim().split('\n').at(-1));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

const seed = `
const db=require('./src/models/db');
const sql=db._db;
sql.prepare("INSERT INTO categories(id,name_id,name_en,created_at) VALUES('C','Cat','Cat','now')").run();
sql.prepare("INSERT INTO products(id,category_id,name_id,name_en,price_idr,stock_type,stock_mode,active,created_at) VALUES('P','C','Prod','Prod',1000,'code','limited',1,'now')").run();
sql.prepare("INSERT INTO users(id,username,first_name,language,banned,created_at) VALUES('U','u','User','id',0,'now')").run();
sql.prepare("INSERT INTO orders(id,user_id,chat_id,product_id,quantity,total_idr,status,stock_ids,delivered_data,delivery_message_id,delivery_terms_message_id,delivery_file_message_id,created_at) VALUES('O','U','U','P',1,1000,'delivered','[]','[]','11','12','13','now')").run();
sql.prepare("INSERT INTO stock(id,product_id,data,sold,added_at) VALUES('S','P','CODE-X',0,'now')").run();
`;

test('replace gagal kirim mengembalikan stok ke ready', () => {
  const r=runFixture(seed+`
const {replaceOrderAccount}=require('./src/services/adminOrders');
(async()=>{ try { await replaceOrderAccount({telegram:{sendMessage:async()=>{throw new Error('network')}},orderId:'O'}); } catch(e) {}
console.log(JSON.stringify({summary:db.getStockSummary('P'), order:db.getOrderById('O')})); })();`);
  assert.deepEqual(r.summary,{ready:1,reserved:0,sold:0});
  assert.deepEqual(r.order.stock_ids,[]);
});

test('replace sukses lalu refund membersihkan data dan idempoten', () => {
  const r=runFixture(seed+`
const {replaceOrderAccount,refundOrder}=require('./src/services/adminOrders');
const deleted=[]; const telegram={sendMessage:async()=>({message_id:1}),deleteMessage:async(c,m)=>deleted.push(m)};
(async()=>{ await replaceOrderAccount({telegram,orderId:'O',count:1}); const replaced=db.getOrderById('O'); const refund=await refundOrder({telegram,orderId:'O'}); let second=''; try{await refundOrder({telegram,orderId:'O'})}catch(e){second=e.message}
console.log(JSON.stringify({replacedIds:replaced.stock_ids,final:refund.order,summary:db.getStockSummary('P'),deleted,second})); })();`);
  assert.deepEqual(r.replacedIds,['S']);
  assert.equal(r.final.status,'refunded');
  assert.deepEqual(r.final.stock_ids,[]); assert.deepEqual(r.final.delivered_data,[]);
  assert.deepEqual(r.summary,{ready:1,reserved:0,sold:0});
  assert.deepEqual(r.deleted,[11,12,13]);
  assert.match(r.second,/sudah di-refund/);
});

test('shared saldo mewajibkan note dan menolak overdraft untuk web/chat', () => {
  const r=runFixture(seed+`
const {adjustUserBalance}=require('./src/services/adminBalance');
const add=adjustUserBalance({userId:'U',action:'add',amount:100,note:'bonus',actorId:'A',channel:'telegram'}); let overdraft='',empty='';
try{adjustUserBalance({userId:'U',action:'deduct',amount:101,note:'x',actorId:'A',channel:'web'})}catch(e){overdraft=e.message}
const emptyResult=adjustUserBalance({userId:'U',action:'set',amount:0,note:'',actorId:'A',channel:'web'});
const notes=require('./src/payments/balance').getBalanceHistory('U',10).map(h=>h.note); console.log(JSON.stringify({balance:add.balance,overdraft,emptyBalance:emptyResult.balance,notes}));`);
  assert.equal(r.balance,100); assert.equal(r.overdraft,'Saldo tidak cukup'); assert.equal(r.emptyBalance,0);
  assert.ok(r.notes.includes('[admin]')); assert.ok(r.notes.includes('[admin] bonus'));
});

test('chat/web memakai shared order service, hard delete chat hilang, CSV aman', () => {
  const chat=fs.readFileSync(path.join(__dirname,'../src/admin/orders.js'),'utf8');
  const web=fs.readFileSync(path.join(__dirname,'../src/web/routes/orders.js'),'utf8');
  const keyboard=fs.readFileSync(path.join(__dirname,'../src/utils/keyboard.js'),'utf8');
  assert.match(chat,/replaceOrderAccount/); assert.match(web,/replaceOrderAccount/);
  assert.doesNotMatch(chat,/adm_order_confirm_delete|db\.deleteOrder/);
  assert.doesNotMatch(keyboard,/adm_order_delete_/);
  const {safeCsvCell}=require('../src/utils/csv');
  assert.equal(safeCsvCell('=CMD()'),"\"'=CMD()\""); assert.equal(safeCsvCell('normal'),'"normal"');
});


test('chat saldo meminta catatan dan web memakai shared adjustment',()=>{
 const panel=fs.readFileSync(path.join(__dirname,'../src/admin/panel.js'),'utf8');
 const users=fs.readFileSync(path.join(__dirname,'../src/web/routes/users.js'),'utf8');
 assert.match(panel,/case 'saldo_note'/); assert.match(panel,/catatan penyesuaian saldo \(opsional\)/);
 assert.match(users,/adjustUserBalance/); assert.doesNotMatch(users,/Math\.max\(0, cur - amount\)/);
 const ui=fs.readFileSync(path.join(__dirname,'../admin-web/src/pages/Users.jsx'),'utf8');
 assert.match(ui,/Catatan \(opsional\)/); assert.match(ui,/if \(insufficient\)/);
 assert.doesNotMatch(ui,/Catatan \(wajib\)|Math\.max\(0, user\.balance - amt\)/);
 const buyer=fs.readFileSync(path.join(__dirname,'../src/handlers/keyboard.js'),'utf8');
 assert.match(buyer,/if \(isAdminAdjustment\)[^\n]*\[admin\]/);
 assert.match(buyer,/telegram:\|web:/);
});
