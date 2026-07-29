/**
 * WijayaPay provider adapter (QRIS only — sesuai kebijakan toko).
 *
 * Docs: https://docs.wijayapay.com  (base: https://gateway.wijayapay.com)
 *
 * Endpoints yang dipakai:
 *   - POST /api/transaction/create   (form-urlencoded) — buat transaksi QRIS
 *       body : code_merchant, api_key, ref_id, code_payment=QRIS, nominal
 *       header: X-Signature = md5(code_merchant + api_key + ref_id)  (digabung tanpa pemisah)
 *       resp : { success, data: { qr_string, qr_image, total_bayar, total_fee,
 *                                  total_diterima, ref_id, trx_reference, expired, ... } }
 *   - GET  /api/get-status?code_merchant=&api_key=&ref_id=  — cek status
 *       resp : { ..., status_pembayaran: 'pending'|'paid'|'expired' }  (atau { status: 'paid' })
 *
 * Callback (WijayaPay → callback_url kita) saat status berubah:
 *   { data: { updated_at, payment_methode, total_dibayar, total_fee, amount_received,
 *             trx_reference, ref_id }, status: 'paid' }
 *   ref_id = order id yang KITA kirim saat create → dipakai untuk mencocokkan order.
 *   Verifikasi kebenaran callback dilakukan dengan memanggil get-status (authoritative),
 *   meniru pola double-verify PaKasir. WijayaPay juga mengandalkan IP whitelist di dashboard.
 */
const axios = require('axios');
const crypto = require('crypto');
const log = require('../../utils/logger');

const WIJAYAPAY_BASE_URL = 'https://gateway.wijayapay.com/api';

// Signature dokumen: md5 dari code_merchant + api_key + ref_id (tanpa pemisah).
const buildSignature = (codeMerchant, apiKey, refId) =>
    crypto.createHash('md5').update(`${codeMerchant}${apiKey}${refId}`).digest('hex');

// Normalisasi status WijayaPay → status internal yang dipakai bot ('completed'/'expired'/'pending').
const normalizeStatus = (raw) => {
    const s = String(raw || '').toLowerCase();
    if (s === 'paid' || s === 'success' || s === 'completed') return 'completed';
    if (s === 'expired' || s === 'failed' || s === 'cancelled') return 'expired';
    return 'pending';
};

/**
 * Buat pembayaran QRIS via WijayaPay.
 * @param {string} orderId  - dipakai sebagai ref_id
 * @param {number} amount   - nominal IDR
 * @param {{code_merchant:string, api_key:string}} creds
 * @returns {Promise<{success:boolean, data?:object, error?:string}>}
 *          data dinormalisasi: { qris_string, qr_image, total_payment, trx_reference, expired }
 */
const createQRIS = async (orderId, amount, creds = {}) => {
    const codeMerchant = creds.code_merchant || '';
    const apiKey = creds.api_key || '';
    if (!codeMerchant || !apiKey) {
        return { success: false, error: 'Credential WijayaPay belum lengkap (code_merchant/api_key)' };
    }
    try {
        const signature = buildSignature(codeMerchant, apiKey, orderId);
        const form = new URLSearchParams({
            code_merchant: codeMerchant,
            api_key: apiKey,
            ref_id: String(orderId),
            code_payment: 'QRIS',
            nominal: String(Math.round(amount)),
            callback_url: `${String(process.env.WEBHOOK_URL || '').replace(/\/$/, '')}/webhook/wijayapay`
        });

        const response = await axios.post(`${WIJAYAPAY_BASE_URL}/transaction/create`, form.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Signature': signature
            },
            timeout: 15000
        });

        const body = response.data || {};
        const data = body.data || body;
        const qrString = data.qr_string || data.qris_string;

        log.info(`[PAYMENT] provider=wijayapay event=create order=${data.ref_id || orderId} ` +
            `amount=${data.total_bayar || amount} fee=${data.total_fee || 0} ` +
            `reference=${data.trx_reference || '-'} expired=${data.expired || '-'}`);

        if (body.success !== false && qrString) {
            return {
                success: true,
                data: {
                    order_id: data.ref_id || orderId,
                    qris_string: qrString,
                    qr_image: data.qr_image || null,
                    amount: data.total_bayar || amount,
                    fee: data.total_fee || 0,
                    total_payment: data.total_bayar || amount,
                    trx_reference: data.trx_reference || null,
                    expired_at: data.expired || null
                }
            };
        }
        return { success: false, error: body.message || body.error || 'Gagal membuat QRIS WijayaPay' };
    } catch (error) {
        log.error(`[PAYMENT] provider=wijayapay event=create_failed order=${orderId} ` +
            `http=${error.response?.status || '-'} error=${error.response?.data?.message || error.message}`);
        return { success: false, error: error.response?.data?.message || error.message };
    }
};

/**
 * Cek status transaksi via WijayaPay.
 * @returns {Promise<{success:boolean, status?:string, error?:string}>} status: completed|expired|pending
 */
const checkStatus = async (orderId, amount, creds = {}, options = {}) => {
    const codeMerchant = creds.code_merchant || '';
    const apiKey = creds.api_key || '';
    try {
        const response = await axios.get(`${WIJAYAPAY_BASE_URL}/get-status`, {
            params: { code_merchant: codeMerchant, api_key: apiKey, ref_id: String(orderId) },
            timeout: 10000
        });
        const body = response.data || {};
        const raw = body.status_pembayaran || body.status || body.data?.status_pembayaran || body.data?.status;
        if (!options.silent) log.info(`[PAYMENT] provider=wijayapay event=status order=${orderId} status=${normalizeStatus(raw)} ` +
            `reference=${body.data?.trx_reference || '-'}`);
        if (raw) return { success: true, status: normalizeStatus(raw) };
        return { success: false, error: 'Status tidak ditemukan' };
    } catch (error) {
        log.error('[WIJAYAPAY] Status check error:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Verifikasi authoritative via get-status (dipanggil saat webhook masuk),
 * meniru verifyTransactionWithAPI PaKasir.
 * @returns {Promise<{valid:boolean, status:string, error?:string}>}
 */
const verifyTransaction = async (orderId, amount, creds = {}) => {
    const r = await checkStatus(orderId, amount, creds);
    if (!r.success) return { valid: false, status: 'api_error', error: r.error };
    return { valid: r.status === 'completed', status: r.status };
};

/**
 * Parse payload callback WijayaPay menjadi bentuk seragam.
 * @param {object} body - payload webhook
 * @returns {{success:boolean, orderId?:string, status?:string, amount?:number, trxReference?:string, error?:string}}
 */
const parseCallback = (body) => {
    try {
        const d = (body && body.data) || body || {};
        const orderId = d.ref_id;
        const rawStatus = body?.status || d.status_pembayaran || d.status;
        if (!orderId) return { success: false, error: 'ref_id tidak ada di callback' };
        return {
            success: true,
            orderId: String(orderId),
            status: normalizeStatus(rawStatus),
            amount: d.total_dibayar || d.amount_received || null,
            trxReference: d.trx_reference || null
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * Test koneksi & credential TANPA membuat transaksi: panggil get-status dengan ref_id dummy.
 * Credential valid → API balas 200 (transaksi tidak ditemukan). Credential salah → auth error.
 * @returns {Promise<{ok:boolean, message:string}>}
 */
const testConnection = async (creds = {}) => {
    const codeMerchant = creds.code_merchant || '';
    const apiKey = creds.api_key || '';
    if (!codeMerchant || !apiKey) return { ok: false, message: 'code_merchant & api_key wajib diisi' };
    try {
        const response = await axios.get(`${WIJAYAPAY_BASE_URL}/get-status`, {
            params: { code_merchant: codeMerchant, api_key: apiKey, ref_id: `PROBE-${Date.now()}` },
            timeout: 10000,
            validateStatus: () => true
        });
        if (response.status === 401 || response.status === 403) {
            return { ok: false, message: 'Credential ditolak (code_merchant / api_key salah)' };
        }
        const body = response.data || {};
        if (typeof body === 'object' && (/unauthor|invalid|api.?key|signature|merchant/i.test(String(body.message || body.error || '')))) {
            // Kalau pesannya soal transaksi tidak ditemukan, itu berarti credential OK.
            if (!/not\s*found|tidak\s*ditemukan|no\s*transaction/i.test(String(body.message || ''))) {
                return { ok: false, message: 'Credential ditolak: ' + (body.message || body.error) };
            }
        }
        if (response.status >= 200 && response.status < 500) {
            return { ok: true, message: 'Koneksi & credential valid' };
        }
        return { ok: false, message: `Server WijayaPay balas status ${response.status}` };
    } catch (error) {
        return { ok: false, message: 'Gagal terhubung: ' + (error.code || error.message) };
    }
};

module.exports = {
    createQRIS,
    checkStatus,
    verifyTransaction,
    parseCallback,
    testConnection,
    buildSignature,
    normalizeStatus
};
