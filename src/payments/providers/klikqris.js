/**
 * KlikQRIS provider adapter (QRIS only).
 *
 * Docs/source: https://github.com/gammarinaldi/klikqris-adapter
 * Endpoint resmi (dokumen merchant): https://klikqris.com/api/qris/create
 *
 * Endpoints yang dipakai:
 *   - POST https://klikqris.com/api/qris/create  — buat transaksi QRIS
 *       body  : { order_id, id_merchant, amount, keterangan, callback_url? }
 *       header: x-api-key, id_merchant
 *       resp  : { status, message, data: { order_id, amount, total_amount, qris_url,
 *                qris_image, expired_at, paid_at, signature, ... } }
 *   - GET  https://klikqris.com/api/qris/status/{order_id} — cek status
 *       header: x-api-key, id_merchant
 *       resp  : { status, message, data: { order_id, status, amount, amount_uniq,
 *                total_amount, qris_url, qris_image, expired_at, paid_at, signature } }
 *
 * Catatan penting: JANGAN pakai /api/qrisv2/create (MY PG mode) — endpoint itu
 * butuh izin khusus "MY PG" yang tidak dimiliki semua merchant (403: MY PG mode
 * is not allowed for this merchant). Endpoint /api/qris/create adalah mode standar.
 *
 * Webhook payload:
 *   { data: { order_id, amount, total_amount, status, signature, created_at } }
 *   status: PENDING | PAID | EXPIRED | CANCEL | SUCCESS
 *
 * Signature KlikQRIS adalah nilai statis (bukan HMAC): signature dari response create
 * dibandingkan dengan signature webhook. Verifikasi diperkuat dengan mencocokkan
 * order_id + amount + status order masih pending.
 */
const axios = require('axios');
const log = require('../../utils/logger');

const BASE_URL = 'https://klikqris.com';

const normalizeStatus = (raw) => {
    const s = String(raw || '').toUpperCase();
    if (s === 'SUCCESS' || s === 'PAID' || s === 'COMPLETED') return 'completed';
    if (s === 'EXPIRED' || s === 'CANCEL' || s === 'CANCELLED' || s === 'FAILED') return 'expired';
    return 'pending';
};

const headersFor = (creds = {}) => ({
    'Content-Type': 'application/json',
    'x-api-key': String(creds.api_key || ''),
    'id_merchant': String(creds.merchant_id || ''),
    'User-Agent': 'Mozilla/5.0 (Vitaicmin Bot; Independent Service)'
});

const CREATE_ENDPOINT = '/api/qris/create';
const STATUS_ENDPOINT = '/api/qris/status';

const createQRIS = async (orderId, amount, creds = {}, options = {}) => {
    const merchantId = String(creds.merchant_id || '').trim();
    if (!creds.api_key || !merchantId) {
        return { success: false, error: 'Credential KlikQRIS belum lengkap (api_key/merchant_id)' };
    }
    try {
        const payload = {
            order_id: String(orderId),
            id_merchant: merchantId,
            amount: Math.round(amount),
            keterangan: String(options.description || `Pembayaran ${orderId}`)
        };
        // callback_url opsional: arahkan webhook KlikQRIS ke endpoint kita.
        const notifyUrl = String(options.callback_url || process.env.WEBHOOK_URL || '').trim();
        if (notifyUrl) payload.callback_url = `${notifyUrl.replace(/\/$/, '')}/webhook/klikqris`;

        const response = await axios.post(`${BASE_URL}${CREATE_ENDPOINT}`, payload, {
            headers: headersFor(creds),
            timeout: 30000
        });
        const body = response.data || {};
        const data = body.data || body;
        if (body.status !== true && !data.qris_url) {
            return { success: false, error: body.message || body.error || 'Gagal membuat QRIS KlikQRIS' };
        }
        log.info(`[PAYMENT] provider=klikqris event=create order=${data.order_id || orderId} ` +
            `amount=${data.total_amount || amount} expired=${data.expired_at || '-'}`);
        return {
            success: true,
            data: {
                order_id: data.order_id || orderId,
                qris_string: data.qris_url || null,
                qr_image: data.qris_image || null,
                amount: data.amount || amount,
                fee: Math.max(0, Number(data.total_amount || amount) - Number(data.amount || amount)),
                total_payment: data.total_amount || amount,
                trx_reference: data.order_id || null,
                expired_at: data.expired_at || null,
                signature: data.signature || null,
                // KlikQRIS tidak menyediakan qris_text mentah; gunakan URL QRIS gambar.
                // Untuk renderer, qris_url adalah PNG siap tampil.
                qris_url: data.qris_url || null
            }
        };
    } catch (error) {
        const timedOut = /timeout/i.test(error.message || '');
        log.error(`[PAYMENT] provider=klikqris event=create_failed order=${orderId} ` +
            `http=${error.response?.status || '-'} error=${error.response?.data?.message || error.message}` +
            (timedOut ? ' (timeout — transaksi mungkin ter-create; polling akan menemukannya)' : ''));
        return { success: false, error: error.response?.data?.message || error.message, timedOut };
    }
};

const checkStatus = async (orderId, amount, creds = {}, options = {}) => {
    try {
        const response = await axios.get(`${BASE_URL}${STATUS_ENDPOINT}/${encodeURIComponent(orderId)}`, {
            headers: headersFor(creds),
            timeout: 10000
        });
        const body = response.data || {};
        const data = body.data || body;
        const status = normalizeStatus(data.status);
        if (!options.silent) log.info(`[PAYMENT] provider=klikqris event=status order=${orderId} status=${status}`);
        if (data.status) return { success: true, status, completed_at: data.paid_at || null };
        return { success: false, error: 'Status tidak ditemukan' };
    } catch (error) {
        log.error('[KLIKQRIS] Status check error:', error.response?.data?.message || error.message);
        return { success: false, error: error.response?.data?.message || error.message };
    }
};

const verifyTransaction = async (orderId, amount, creds = {}) => {
    const r = await checkStatus(orderId, amount, creds);
    if (!r.success) return { valid: false, status: 'api_error', error: r.error };
    return { valid: r.status === 'completed', status: r.status };
};

const parseCallback = (body) => {
    try {
        const d = (body && body.data) || body || {};
        const orderId = d.order_id;
        if (!orderId) return { success: false, error: 'order_id tidak ada di callback' };
        return {
            success: true,
            orderId: String(orderId),
            status: normalizeStatus(d.status),
            amount: Number(d.total_amount || d.amount) || null,
            signature: d.signature || null,
            paidAt: d.payment_date || d.created_at || null
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * Verifikasi signature webhook KlikQRIS.
 *
 * Catatan: dokumentasi resmi KlikQRIS TIDAK menjelaskan skema signature webhook,
 * dan format signature webhook berbeda dengan signature response create.
 * Hard-fail pada mismatch berisiko menolak webhook SAH (order nyangkut sampai
 * polling). Oleh karena itu verifikasi signature di sini bersifat best-effort:
 *   - sama persis / keduanya ada & cocok  → true
 *   - mismatch / salah satu kosong        → false (caller boleh lanjut via polling)
 * Keamanan tetap dijaga: jalur SUCCESS wajib double-verify via polling
 * (verifyTransaction) yang memakai credential merchant asli.
 */
const verifyWebhookSignature = (incoming, stored) => {
    if (!incoming || !stored) return false;
    const a = Buffer.from(String(incoming));
    const b = Buffer.from(String(stored));
    return a.length === b.length && a.equals(b);
};

const testConnection = async (creds = {}) => {
    if (!creds.api_key || !creds.merchant_id) return { ok: false, message: 'api_key & merchant_id wajib diisi' };
    try {
        const response = await axios.get(`${BASE_URL}/api/qris/status/PROBE-${Date.now()}`, {
            headers: headersFor(creds),
            timeout: 10000,
            validateStatus: () => true
        });
        if (response.status === 401 || response.status === 403) {
            return { ok: false, message: 'Credential ditolak (api_key / merchant_id salah)' };
        }
        const body = response.data || {};
        if (typeof body === 'object' && (/unauthor|invalid|api.?key|merchant/i.test(String(body.message || body.error || '')))) {
            if (!/not\s*found|tidak\s*ditemukan|no\s*transaction/i.test(String(body.message || ''))) {
                return { ok: false, message: 'Credential ditolak: ' + (body.message || body.error) };
            }
        }
        if (response.status >= 200 && response.status < 500) {
            return { ok: true, message: 'Koneksi & credential valid' };
        }
        return { ok: false, message: `Server KlikQRIS balas status ${response.status}` };
    } catch (error) {
        return { ok: false, message: 'Gagal terhubung: ' + (error.code || error.message) };
    }
};

module.exports = {
    createQRIS,
    checkStatus,
    verifyTransaction,
    parseCallback,
    verifyWebhookSignature,
    testConnection,
    normalizeStatus
};
