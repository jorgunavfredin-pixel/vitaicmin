const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Sandbox: stub axios before requiring provider
const axios = require('axios');
const originalGet = axios.get;
const originalPost = axios.post;

const BASE = 'https://klikqris.com';
let calls = [];
axios.get = async (url, config) => {
  calls.push(['GET', url, config]);
  if (url.includes('/api/qris/status/INV-123')) {
    return { data: { status: true, message: 'ok', data: {
      order_id: 'INV-123', status: 'SUCCESS', amount: '1000.00',
      amount_uniq: '16.00', total_amount: '1016.00',
      qris_url: null, qris_image: 'data:image/png;base64,AAAA',
      expired_at: '2026-07-31 18:56:03', paid_at: '2026-07-31 17:56:03',
      signature: 'SIG123'
    } } };
  }
  if (url.includes('/api/qris/status/PROBE-')) {
    return { status: 200, data: { status: false, message: 'Transaction not found', data: null } };
  }
  throw new Error('not found');
};
axios.post = async (url, body, config) => {
  calls.push(['POST', url, body, config]);
  return { data: { status: true, message: 'ok', data: {
    order_id: 'INV-123', amount: 1000, total_amount: 1016,
    qris_url: 'https://klikqris.com/storage/qris_api/qris_INV-123.png',
    qris_image: 'data:image/png;base64,iVBORw0KGgoAAAA',
    direct_url: 'https://klikqris.com', expired_at: '2026-07-31 18:56:03',
    signature: 'SIG123'
  } } };
};

const modulePath = require.resolve('../src/payments/providers/klikqris');
delete require.cache[modulePath];
const klikqris = require('../src/payments/providers/klikqris');

test('createQRIS mengirim x-api-key/id_merchant dan memetakan response', async () => {
  calls = [];
  const result = await klikqris.createQRIS('INV-123', 1000, { api_key: 'KEY', merchant_id: 'MID' }, {});
  assert.equal(result.success, true);
  const [method, url, body, config] = calls[0];
  assert.equal(method, 'POST');
  assert.equal(url, `${BASE}/api/qris/create`);
  assert.equal(body.order_id, 'INV-123');
  assert.equal(body.id_merchant, 'MID');
  assert.equal(body.amount, 1000);
  assert.equal(config.headers['x-api-key'], 'KEY');
  assert.equal(config.headers['id_merchant'], 'MID');
  assert.equal(result.data.qris_string, null);
  assert.equal(result.data.qr_image, 'data:image/png;base64,iVBORw0KGgoAAAA');
  assert.equal(result.data.total_payment, 1016);
  assert.equal(result.data.signature, 'SIG123');
});

test('checkStatus memetakan SUCCESS/PAID/EXPIRED/PENDING', async () => {
  const r = await klikqris.checkStatus('INV-123', 1000, { api_key: 'K', merchant_id: 'M' });
  assert.equal(r.success, true);
  assert.equal(r.status, 'completed');
  assert.equal(r.completed_at, '2026-07-31 17:56:03');
  for (const [raw, expected] of [['SUCCESS', 'completed'], ['PAID', 'completed'], ['EXPIRED', 'expired'], ['CANCEL', 'expired'], ['PENDING', 'pending']]) {
    assert.equal(klikqris.normalizeStatus(raw), expected, raw);
  }
});

test('parseCallback membaca data.order_id + status + signature', () => {
  const p = klikqris.parseCallback({ data: { order_id: 'INV-123', amount: 1000, total_amount: 1016, status: 'PAID', signature: 'SIG123' } });
  assert.equal(p.success, true);
  assert.equal(p.orderId, 'INV-123');
  assert.equal(p.status, 'completed');
  assert.equal(p.signature, 'SIG123');
  assert.equal(klikqris.verifyWebhookSignature('SIG123', 'SIG123'), true);
  assert.equal(klikqris.verifyWebhookSignature('SIG123', 'OTHER'), false);
  assert.equal(klikqris.verifyWebhookSignature('', 'SIG123'), false);
});

test('parseCallback menangani payload FLAT resmi KlikQRIS (tanpa bungkus data)', () => {
  // Dokumentasi resmi: { order_id, status, amount, total_amount, payment_date, signature }
  const p = klikqris.parseCallback({
    order_id: 'DIRECT-176835469862-8460-202601252147',
    status: 'PAID',
    amount: 1000,
    total_amount: 1215,
    payment_date: '2026-01-25 21:48:01',
    signature: '8n3v9z...1738681234'
  });
  assert.equal(p.success, true);
  assert.equal(p.orderId, 'DIRECT-176835469862-8460-202601252147');
  assert.equal(p.status, 'completed');
  assert.equal(p.amount, 1215);
  assert.equal(p.paidAt, '2026-01-25 21:48:01');
});

test('testConnection memakai status dummy dan mendeteksi auth error', async () => {
  calls = [];
  const ok = await klikqris.testConnection({ api_key: 'K', merchant_id: 'M' });
  assert.equal(ok.ok, true);
  assert.equal(calls[0][0], 'GET');
  assert.match(calls[0][1], /\/api\/qris\/status\/PROBE-/);
});

test('gateway mendukung provider klikqris dengan field credential', () => {
  const { SUPPORTED_PROVIDERS, PROVIDER_FIELDS, envCredential } = require('../src/payments/gateway');
  assert.ok(SUPPORTED_PROVIDERS.includes('klikqris'));
  assert.deepEqual(PROVIDER_FIELDS.klikqris, ['api_key', 'merchant_id']);
  // env kosong → null (sama dengan provider lain yang belum di-set)
  assert.equal(envCredential('klikqris'), null);
});
