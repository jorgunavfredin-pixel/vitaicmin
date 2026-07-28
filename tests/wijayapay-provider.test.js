const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const adapterPath = require.resolve('../src/payments/providers/wijayapay');

function loadWithAxios(fakeAxios) {
  delete require.cache[adapterPath];
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'axios') return fakeAxios;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(adapterPath);
  } finally {
    Module._load = originalLoad;
  }
}

test('signature WijayaPay = md5(code_merchant + api_key + ref_id) tanpa pemisah', () => {
  const wp = loadWithAxios({});
  assert.equal(
    wp.buildSignature('WP123', '7575', '6969'),
    '6964f312ef93641b935e9743824755bf'
  );
});

test('parse callback menangani field WijayaPay yang berbeda dari API response', () => {
  const wp = loadWithAxios({});
  const parsed = wp.parseCallback({
    data: {
      payment_methode: 'QRIS',
      total_dibayar: 83302,
      amount_received: 82623,
      trx_reference: 'WP750872',
      ref_id: 'ORD-Q7SH8NXHLX'
    },
    status: 'paid'
  });
  assert.deepEqual(parsed, {
    success: true,
    orderId: 'ORD-Q7SH8NXHLX',
    status: 'completed',
    amount: 83302,
    trxReference: 'WP750872'
  });
});

test('create QRIS mengirim form, callback_url, dan X-Signature sesuai dokumentasi', async () => {
  let captured;
  const fakeAxios = {
    post: async (url, body, options) => {
      captured = { url, body, options };
      return {
        data: {
          success: true,
          data: {
            ref_id: 'ORD-123',
            qr_string: '000201TEST',
            qr_image: 'https://example.test/qr.png',
            total_bayar: 10000,
            total_fee: 100,
            trx_reference: 'WPTRX1',
            expired: '2026-01-01 00:00:00'
          }
        }
      };
    }
  };
  const oldWebhook = process.env.WEBHOOK_URL;
  process.env.WEBHOOK_URL = 'https://store.example.com/';
  try {
    const wp = loadWithAxios(fakeAxios);
    const result = await wp.createQRIS('ORD-123', 10000, {
      code_merchant: 'WP123', api_key: 'SECRET'
    });
    assert.equal(result.success, true);
    assert.equal(captured.url, 'https://gateway.wijayapay.com/api/transaction/create');
    assert.equal(captured.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(captured.options.headers['X-Signature'], wp.buildSignature('WP123', 'SECRET', 'ORD-123'));
    const form = new URLSearchParams(captured.body);
    assert.equal(form.get('code_payment'), 'QRIS');
    assert.equal(form.get('nominal'), '10000');
    assert.equal(form.get('callback_url'), 'https://store.example.com/webhook/wijayapay');
    assert.equal(result.data.qris_string, '000201TEST');
  } finally {
    if (oldWebhook === undefined) delete process.env.WEBHOOK_URL;
    else process.env.WEBHOOK_URL = oldWebhook;
  }
});

test('status paid dinormalisasi menjadi completed', async () => {
  const wp = loadWithAxios({
    get: async () => ({ data: { data: { ref_id: 'ORD-1' }, status_pembayaran: 'paid' } })
  });
  const result = await wp.checkStatus('ORD-1', 1000, { code_merchant: 'WP1', api_key: 'KEY' });
  assert.deepEqual(result, { success: true, status: 'completed' });
});
