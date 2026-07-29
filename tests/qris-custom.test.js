const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const gateway = require('../src/payments/gateway');
const custom = require('../src/services/qrisCustom');

test('layout QRIS Custom mengikuti default generator dan dibatasi aman', () => {
  assert.deepEqual(custom.normalizeLayout({}), custom.DEFAULT_LAYOUT);
  assert.deepEqual(custom.normalizeLayout({ x: 99, y: -5, size: 50 }), { x: 50, y: 0, size: 50 });
  assert.deepEqual(custom.normalizeLayout({ x: 1, y: 2, size: 99 }), { x: 1, y: 2, size: 90 });
});

test('QR lokal dapat dirender ke template square dengan Sharp', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitaicmin-qcustom-'));
  const template = path.join(dir, 'template.png');
  try {
    await sharp({ create: { width: 800, height: 800, channels: 4, background: '#14213d' } }).png().toFile(template);
    const qr = await gateway.generateQRImageBuffer('QRIS-TEST-PAYLOAD', 500);
    const result = await custom.renderWithTemplate(template, qr, custom.DEFAULT_LAYOUT);
    const meta = await sharp(result).metadata();
    assert.equal(meta.width, 800);
    assert.equal(meta.height, 800);
    assert.equal(meta.format, 'png');
    assert.ok(result.length > 1000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('template landscape tetap membatasi QR di dalam canvas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitaicmin-qcustom-wide-'));
  const template = path.join(dir, 'wide.png');
  try {
    await sharp({ create: { width: 1200, height: 400, channels: 4, background: '#222222' } }).png().toFile(template);
    const qr = await gateway.generateQRImageBuffer('QRIS-WIDE', 400);
    const result = await custom.renderWithTemplate(template, qr, { x: 46, y: 46, size: 53 });
    const meta = await sharp(result).metadata();
    assert.equal(meta.width, 1200);
    assert.equal(meta.height, 400);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('plain QR memprioritaskan qris_string dan tidak membutuhkan layanan eksternal', async () => {
  const buffer = await custom.getPlainQR({ qris_string: '000201QRISLOCALTEST' });
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.width, 600);
});
