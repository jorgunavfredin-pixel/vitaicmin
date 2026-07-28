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
