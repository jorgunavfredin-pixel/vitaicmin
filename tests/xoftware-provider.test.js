const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');

const adapterPath = require.resolve('../src/payments/providers/xoftware');
function load(fakeAxios) {
  delete require.cache[adapterPath];
  const old = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'axios') return fakeAxios;
    return old.call(this, request, parent, isMain);
  };
  try { return require(adapterPath); } finally { Module._load = old; }
}

test('request signature = Base64 HMAC canonical 4 baris', () => {
  const x = load({});
  const message = '1785230000\nPOST\n/v1/api/transactions\n{"a":1}';
  const expected = crypto.createHmac('sha256', 'KEY').update(message).digest('base64');
  assert.equal(x.signRequest('KEY', '1785230000', 'POST', '/v1/api/transactions', '{"a":1}'), expected);
});

test('create QRIS mengirim fee dan expiry toko dalam body yang sama dengan signature', async () => {
  let req;
  const x = load({ request: async (config) => {
    req = config;
    return { data: { transaction_id:'TRX-1', ref_id:'ORD-1', amount:4000, status:'PENDING', expires_at:'2026-01-01T00:15:00Z', qris_text:'000201TEST', fee_preview:{ gross:4000, bank:28, app:100 } } };
  }});
  const result = await x.createQRIS('ORD-1', 4000, { api_key:'KEY', merchant_id:'123', webhook_secret:'WH', registered_notify_url:'https://t.me/approved_bot', fee_direction:'merchant' }, { timeout_minutes:15, metadata:{ customer:{id:'1',name:'A'} } });
  const body = JSON.parse(req.data);
  assert.equal(body.fee_direction, 'merchant');
  assert.equal(body.expires_in_minutes, 15);
  assert.equal(body.notify_url, 'https://t.me/approved_bot');
  const expected = x.signRequest('KEY', req.headers['X-Timestamp'], 'POST', '/v1/api/transactions', req.data);
  assert.equal(req.headers['X-Signature'], expected);
  assert.equal(result.data.qris_string, '000201TEST');
});

test('webhook signature memakai HMAC hex raw body dan status dinormalisasi', () => {
  const x = load({});
  const raw = Buffer.from('{"event_id":"E1","order_id":"ORD-1","status":"SUCCESS"}');
  const sig = crypto.createHmac('sha256','SECRET').update(raw).digest('hex');
  assert.equal(x.verifyWebhookSignature(raw, sig, 'SECRET'), true);
  assert.equal(x.verifyWebhookSignature(raw, 'bad', 'SECRET'), false);
  assert.equal(x.parseCallback({event_id:'E1',order_id:'ORD-1',status:'SUCCESS',amount:4000}).status, 'completed');
});

test('fee buyer hanya dipakai bila setting eksplisit user', async () => {
  let body;
  const x = load({ request: async c => { body=JSON.parse(c.data); return {data:{qris_text:'QR',ref_id:'O',amount:1000,status:'PENDING'}}; } });
  await x.createQRIS('O',1000,{api_key:'K',merchant_id:'1',webhook_secret:'W',registered_notify_url:'https://approved.example/callback',fee_direction:'user'},{timeout_minutes:20,metadata:{customer:{id:'1'}}});
  assert.equal(body.fee_direction,'user');
  assert.equal(body.expires_in_minutes,20);
});

test('notify URL admin menang atas env dan dikirim tanpa modifikasi', async () => {
  const before = process.env.XOWFTWARE_NOTIFY_URL;
  process.env.XOWFTWARE_NOTIFY_URL = 'https://env.example/approved';
  let body;
  try {
    const x = load({ request: async c => { body=JSON.parse(c.data); return {data:{qris_text:'QR',ref_id:'O',amount:1000,status:'PENDING'}}; } });
    await x.createQRIS('O',1000,{api_key:'K',merchant_id:'1',registered_notify_url:'https://t.me/admin_approved'},{timeout_minutes:15});
    assert.equal(body.notify_url, 'https://t.me/admin_approved');
  } finally {
    if (before === undefined) delete process.env.XOWFTWARE_NOTIFY_URL; else process.env.XOWFTWARE_NOTIFY_URL = before;
  }
});

test('notify URL env menjadi fallback; kosong atau invalid ditolak sebelum API call', async () => {
  const before = process.env.XOWFTWARE_NOTIFY_URL;
  let calls = 0;
  try {
    process.env.XOWFTWARE_NOTIFY_URL = 'https://t.me/env_approved';
    let body;
    let x = load({ request: async c => { calls++; body=JSON.parse(c.data); return {data:{qris_text:'QR',ref_id:'O',amount:1000,status:'PENDING'}}; } });
    const ok = await x.createQRIS('O',1000,{api_key:'K',merchant_id:'1'},{timeout_minutes:15});
    assert.equal(ok.success, true);
    assert.equal(body.notify_url, 'https://t.me/env_approved');

    delete process.env.XOWFTWARE_NOTIFY_URL;
    x = load({ request: async () => { calls++; throw new Error('should not call'); } });
    const missing = await x.createQRIS('O2',1000,{api_key:'K',merchant_id:'1'},{timeout_minutes:15});
    const invalid = await x.createQRIS('O3',1000,{api_key:'K',merchant_id:'1',registered_notify_url:'t.me/no-scheme'},{timeout_minutes:15});
    assert.equal(missing.success, false);
    assert.equal(invalid.success, false);
    assert.match(missing.error, /Notify URL/);
    assert.equal(calls, 1);
  } finally {
    if (before === undefined) delete process.env.XOWFTWARE_NOTIFY_URL; else process.env.XOWFTWARE_NOTIFY_URL = before;
  }
});
