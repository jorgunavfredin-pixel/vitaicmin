/**
 * PaKasir provider adapter (QRIS) — membungkus endpoint PaKasir di balik
 * interface seragam yang sama dengan provider lain (createQRIS/checkStatus/
 * verifyTransaction/parseCallback/testConnection).
 *
 * Logika HTTP identik dengan implementasi lama di ../qris.js (yang tetap ada
 * demi backward-compat), hanya saja credential diterima eksplisit lewat argumen
 * `creds` = { api_key, slug } sehingga dispatcher bisa memakai gateway spesifik.
 *
 * Endpoints (base https://app.pakasir.com/api):
 *   - POST /transactioncreate/qris  { project, order_id, amount, api_key }
 *   - GET  /transactiondetail       ?project&order_id&amount&api_key
 *   - POST /transactioncancel       { project, order_id, api_key }
 * Webhook payload: { amount, order_id, project, status, payment_method, completed_at }
 * status: 'pending' | 'completed' | 'expired'
 */
const axios = require('axios');
const log = require('../../utils/logger');

const PAKASIR_BASE_URL = 'https://app.pakasir.com/api';

const normalizeStatus = (raw) => {
    const s = String(raw || '').toLowerCase();
    if (s === 'completed' || s === 'success' || s === 'paid') return 'completed';
    if (s === 'expired' || s === 'failed' || s === 'cancelled') return 'expired';
    return 'pending';
};

const createQRIS = async (orderId, amount, creds = {}) => {
    const apiKey = creds.api_key || '';
    const slug = creds.slug || '';
    if (!apiKey || !slug) return { success: false, error: 'Credential PaKasir belum lengkap (api_key/slug)' };
    try {
        const response = await axios.post(`${PAKASIR_BASE_URL}/transactioncreate/qris`, {
            project: slug, order_id: orderId, amount, api_key: apiKey
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });

        log.info('[PAKASIR] Create response:', JSON.stringify(response.data));
        const paymentData = response.data.payment || response.data;
        if (paymentData && paymentData.payment_number) {
            return {
                success: true,
                data: {
                    order_id: paymentData.order_id,
                    qris_string: paymentData.payment_number,
                    qr_image: null,
                    amount: paymentData.amount,
                    fee: paymentData.fee || 0,
                    total_payment: paymentData.total_payment || paymentData.amount,
                    trx_reference: paymentData.order_id,
                    expired_at: paymentData.expired_at
                }
            };
        }
        return { success: false, error: response.data?.message || 'Gagal membuat QRIS PaKasir' };
    } catch (error) {
        log.error('[PAKASIR] Create error:', error.response?.data || error.message);
        return { success: false, error: error.response?.data?.message || error.message };
    }
};

const checkStatus = async (orderId, amount, creds = {}) => {
    const apiKey = creds.api_key || '';
    const slug = creds.slug || '';
    try {
        const response = await axios.get(`${PAKASIR_BASE_URL}/transactiondetail`, {
            params: { project: slug, order_id: orderId, amount, api_key: apiKey },
            timeout: 10000
        });
        log.info('[PAKASIR] Status check:', JSON.stringify(response.data));
        const txData = response.data.transaction || response.data;
        if (txData && txData.status) return { success: true, status: normalizeStatus(txData.status) };
        return { success: false, error: 'Status tidak ditemukan' };
    } catch (error) {
        log.error('[PAKASIR] Status check error:', error.message);
        return { success: false, error: error.message };
    }
};

const verifyTransaction = async (orderId, amount, creds = {}) => {
    const apiKey = creds.api_key || '';
    const slug = creds.slug || '';
    try {
        const response = await axios.get(`${PAKASIR_BASE_URL}/transactiondetail`, {
            params: { project: slug, amount, order_id: orderId, api_key: apiKey },
            timeout: 10000
        });
        const tx = response.data?.transaction;
        if (tx && tx.status === 'completed' && tx.order_id === orderId) {
            log.info(`[PAKASIR] ✅ Transaction ${orderId} verified via API`);
            return { valid: true, status: 'completed' };
        }
        log.warn(`[PAKASIR] ⚠️ Transaction ${orderId} API status: ${tx?.status || 'unknown'}`);
        return { valid: false, status: normalizeStatus(tx?.status) };
    } catch (error) {
        log.error(`[PAKASIR] API verify error for ${orderId}:`, error.message);
        return { valid: false, status: 'api_error', error: error.message };
    }
};

const cancelTransaction = async (orderId, creds = {}) => {
    const apiKey = creds.api_key || '';
    const slug = creds.slug || '';
    try {
        const response = await axios.post(`${PAKASIR_BASE_URL}/transactioncancel`, {
            project: slug, order_id: orderId, api_key: apiKey
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
        return { success: true, data: response.data };
    } catch (error) {
        log.error('[PAKASIR] Cancel error:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Parse webhook PaKasir. project harus dicocokkan dengan slug credential gateway
 * oleh caller (dispatcher) karena butuh akses ke daftar gateway.
 */
const parseCallback = (body) => {
    try {
        const { order_id, status, amount, payment_method, completed_at, project } = body || {};
        if (!order_id) return { success: false, error: 'order_id tidak ada di callback' };
        return {
            success: true,
            orderId: String(order_id),
            status: normalizeStatus(status),
            amount: amount || null,
            paymentMethod: payment_method || null,
            project: project || null,
            completedAt: completed_at || null
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

const testConnection = async (creds = {}) => {
    const apiKey = creds.api_key || '';
    const slug = creds.slug || '';
    if (!apiKey || !slug) return { ok: false, message: 'API key & slug wajib diisi' };
    try {
        const probeOrderId = `PROBE-${Date.now()}`;
        const response = await axios.get(`${PAKASIR_BASE_URL}/transactiondetail`, {
            params: { project: slug, amount: 1000, order_id: probeOrderId, api_key: apiKey },
            timeout: 10000, validateStatus: () => true
        });
        if (response.status === 401 || response.status === 403) {
            return { ok: false, message: 'Credential ditolak (API key / slug salah)' };
        }
        const bodyData = response.data || {};
        if (typeof bodyData === 'object' && (bodyData.error === 'unauthorized' || /api.?key|auth/i.test(String(bodyData.message || '')))) {
            return { ok: false, message: 'Credential ditolak: ' + (bodyData.message || bodyData.error) };
        }
        if (response.status >= 200 && response.status < 500) return { ok: true, message: 'Koneksi & credential valid' };
        return { ok: false, message: `Server PaKasir balas status ${response.status}` };
    } catch (error) {
        return { ok: false, message: 'Gagal terhubung: ' + (error.code || error.message) };
    }
};

module.exports = {
    createQRIS,
    checkStatus,
    verifyTransaction,
    cancelTransaction,
    parseCallback,
    testConnection,
    normalizeStatus
};
