const test = require('node:test');
const assert = require('node:assert/strict');
const log = require('../src/utils/logger');

test('logger mengubah payload multiline menjadi satu baris ringkas', () => {
  const original = console.log;
  let captured = '';
  console.log = (msg) => { captured = String(msg); };
  try {
    log.info('[PAYMENT]', { tutorial: 'baris 1\nbaris 2\r\nbaris 3' });
  } finally {
    console.log = original;
  }
  // Tidak ada newline fisik; newline di dalam JSON hanya tampil sebagai escape backslash-n.
  assert.equal(captured.includes('\n'), false);
  assert.equal(captured.includes('\r'), false);
  assert.equal(captured.includes('baris 1\\nbaris 2\\r\\nbaris 3'), true);
});
