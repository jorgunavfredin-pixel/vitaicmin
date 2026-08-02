const db = require('../models/db');

const validationError = (message) => Object.assign(new Error(message), { status: 400 });

const normalizeVoucherInput = ({ code, type, value }) => {
  const normalizedCode = String(code || '').trim().toUpperCase();
  const normalizedType = String(type || '').trim().toLowerCase();
  const normalizedValue = Number(value);
  if (!normalizedCode || !/^[A-Z0-9_-]+$/.test(normalizedCode)) throw validationError('Kode hanya boleh berisi huruf, angka, _ dan -');
  if (!['percent', 'fixed'].includes(normalizedType)) throw validationError('Tipe voucher tidak valid');
  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) throw validationError('Nilai diskon harus berupa angka bulat positif');
  if (normalizedType === 'percent' && normalizedValue > 100) throw validationError('Diskon persen tidak boleh lebih dari 100%');
  return { code: normalizedCode, type: normalizedType, value: normalizedValue };
};

const createVoucher = (input) => {
  const data = normalizeVoucherInput(input);
  if (db.getVoucherByCode(data.code)) throw Object.assign(new Error('Kode voucher sudah ada'), { status: 409 });
  return db.createVoucher(data);
};

const deleteVoucherSafely = (voucherId) => db.deleteVoucher(voucherId);

module.exports = { normalizeVoucherInput, createVoucher, deleteVoucherSafely };
