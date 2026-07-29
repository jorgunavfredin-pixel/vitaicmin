const axios = require('axios');
const crypto = require('crypto');
const log = require('../../utils/logger');

const BASE_URL = 'https://payment.xoftware.id';

const normalizeStatus = (status, paymentStatus) => {
    const tx = String(status || '').toUpperCase();
    const pay = String(paymentStatus || '').toUpperCase();
    if (tx === 'SUCCESS' || pay === 'SUCCEEDED') return 'completed';
    if (pay === 'EXPIRED' || tx === 'FAILED' || pay === 'FAILED') return 'expired';
    return 'pending';
};

const signRequest = (apiKey, timestamp, method, path, rawBody = '') => {
    const message = `${timestamp}\n${String(method).toUpperCase()}\n${path}\n${rawBody}`;
    return crypto.createHmac('sha256', apiKey).update(message, 'utf8').digest('base64');
};

const signedRequest = async (method, path, body, creds) => {
    const apiKey = creds.api_key || '';
    if (!apiKey) throw new Error('API Key Xoftware belum diisi');
    const rawBody = body == null ? '' : JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    return axios.request({
        method,
        url: `${BASE_URL}${path}`,
        data: rawBody || undefined,
        headers: {
            'X-API-Key': apiKey,
            'X-Timestamp': timestamp,
            'X-Signature': signRequest(apiKey, timestamp, method, path, rawBody),
            'Content-Type': 'application/json'
        },
        timeout: 15000,
        transformRequest: [(data) => data]
    });
};

const unwrap = (response) => {
    const body = response?.data || {};
    if (body.error === true) throw new Error(body.message || 'Xoftware API error');
    return body.data !== undefined ? body.data : body;
};

const createQRIS = async (orderId, amount, creds = {}, options = {}) => {
    const merchantId = Number(creds.merchant_id);
    if (!creds.api_key || !Number.isSafeInteger(merchantId) || merchantId <= 0) {
        return { success: false, error: 'Credential Xoftware belum lengkap (api_key/merchant_id)' };
    }
    const timeout = Math.max(1, Math.min(1440, parseInt(options.timeout_minutes) || 15));
    const feeDirection = creds.fee_direction === 'user' ? 'user' : 'merchant';
    const metadata = options.metadata && typeof options.metadata === 'object'
        ? options.metadata
        : { customer: { id: String(options.user_id || merchantId), name: options.customer_name || 'Telegram Buyer' } };
    try {
        const payload = {
            merchant_id: merchantId,
            channel_code: 'QRIS',
            amount: Math.round(amount),
            ref_id: String(orderId),
            fee_direction: feeDirection,
            notify_url: `${String(process.env.WEBHOOK_URL || '').replace(/\/$/, '')}/webhook/xoftware`,
            expires_in_minutes: timeout,
            note: `Payment ${orderId}`,
            metadata
        };
        const response = await signedRequest('POST', '/v1/api/transactions', payload, creds);
        const data = unwrap(response);
        if (!data.qris_text) return { success: false, error: 'Response Xoftware tidak memiliki qris_text' };
        const gross = data.fee_preview?.gross || data.amount || amount;
        log.info(`[PAYMENT] provider=xoftware event=create order=${data.ref_id || orderId} ` +
            `amount=${gross} fee=${(data.fee_preview?.bank || 0) + (data.fee_preview?.app || 0)} ` +
            `reference=${data.transaction_id || '-'} expired=${data.expires_at || '-'}`);
        return {
            success: true,
            data: {
                order_id: data.ref_id || orderId,
                qris_string: data.qris_text,
                qr_image: null,
                amount: data.amount || amount,
                fee: (data.fee_preview?.bank || 0) + (data.fee_preview?.app || 0),
                total_payment: gross,
                trx_reference: data.transaction_id || null,
                expired_at: data.expires_at || null
            }
        };
    } catch (error) {
        log.error(`[PAYMENT] provider=xoftware event=create_failed order=${orderId} ` +
            `http=${error.response?.status || '-'} error=${error.response?.data?.message || error.message}`);
        return { success: false, error: error.response?.data?.message || error.message };
    }
};

const checkStatus = async (orderId, amount, creds = {}, options = {}) => {
    try {
        const response = await signedRequest('POST', '/v1/api/transactions/status', { ref_id: String(orderId) }, creds);
        const data = unwrap(response);
        const status = normalizeStatus(data.status, data.payment_status);
        if (!options.silent) log.info(`[PAYMENT] provider=xoftware event=status order=${orderId} status=${status} ` +
            `reference=${data.provider_ref || data.transaction_id || '-'}`);
        return { success: true, status, completed_at: data.paid_at || null };
    } catch (error) {
        log.error(`[PAYMENT] provider=xoftware event=status_failed order=${orderId} error=${error.response?.data?.message || error.message}`);
        return { success: false, error: error.response?.data?.message || error.message };
    }
};

const verifyTransaction = async (orderId, amount, creds = {}) => {
    const result = await checkStatus(orderId, amount, creds);
    if (!result.success) return { valid: false, status: 'api_error', error: result.error };
    return { valid: result.status === 'completed', status: result.status };
};

const cancelTransaction = async (orderId, creds = {}) => {
    try {
        const response = await signedRequest('POST', '/v1/api/transactions/cancel', { ref_id: String(orderId) }, creds);
        return { success: true, data: unwrap(response) };
    } catch (error) {
        return { success: false, error: error.response?.data?.message || error.message };
    }
};

const parseCallback = (body = {}) => {
    if (!body.event_id || !body.order_id) return { success: false, error: 'event_id/order_id tidak ada' };
    return {
        success: true,
        eventId: String(body.event_id),
        orderId: String(body.order_id),
        transactionId: body.transaction_id || null,
        status: normalizeStatus(body.status, null),
        amount: body.amount || null,
        paidAt: body.paid_at || null
    };
};

const verifyWebhookSignature = (rawBody, signature, webhookSecret) => {
    if (!rawBody || !signature || !webhookSecret) return false;
    const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(String(signature).toLowerCase());
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const testConnection = async (creds = {}) => {
    const merchantId = Number(creds.merchant_id);
    if (!creds.api_key || !Number.isSafeInteger(merchantId) || merchantId <= 0 || !creds.webhook_secret) {
        return { ok: false, message: 'API Key, Merchant ID & Webhook Secret wajib diisi' };
    }
    try {
        const response = await signedRequest('GET', '/v1/api/channels', null, creds);
        unwrap(response);
        return { ok: true, message: 'Koneksi & credential valid' };
    } catch (error) {
        return { ok: false, message: error.response?.data?.message || error.message };
    }
};

module.exports = {
    createQRIS, checkStatus, verifyTransaction, cancelTransaction, parseCallback,
    verifyWebhookSignature, testConnection, signRequest, normalizeStatus
};
