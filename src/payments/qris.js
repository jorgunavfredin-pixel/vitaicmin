const axios = require('axios');
const log = require('../utils/logger');

const PAKASIR_API_KEY = process.env.PAKASIR_API_KEY;
const PAKASIR_SLUG = process.env.PAKASIR_SLUG;

// Correct PaKasir API endpoints
const PAKASIR_BASE_URL = 'https://app.pakasir.com/api';

/**
 * Create QRIS payment via PaKasir
 * Endpoint: POST https://app.pakasir.com/api/transactioncreate/qris
 * 
 * @param {string} orderId - Order ID
 * @param {number} amount - Amount in IDR
 * @returns {Promise<Object>} - Payment data with QRIS string
 */
const createQRISPayment = async (orderId, amount) => {
    try {
        log.info(`[QRIS] Creating payment for order ${orderId}, amount: ${amount}`);

        const response = await axios.post(
            `${PAKASIR_BASE_URL}/transactioncreate/qris`,
            {
                project: PAKASIR_SLUG,
                order_id: orderId,
                amount: amount,
                api_key: PAKASIR_API_KEY
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );

        log.info('[QRIS] Response:', JSON.stringify(response.data));

        // PaKasir returns: { payment: { project, order_id, ... } }
        const paymentData = response.data.payment || response.data;

        if (paymentData && paymentData.payment_number) {
            return {
                success: true,
                data: {
                    order_id: paymentData.order_id,
                    qris_string: paymentData.payment_number, // QR string to convert to image
                    amount: paymentData.amount,
                    fee: paymentData.fee || 0,
                    total_payment: paymentData.total_payment || paymentData.amount,
                    expired_at: paymentData.expired_at
                }
            };
        }

        return {
            success: false,
            error: response.data?.message || 'Failed to create QRIS payment'
        };
    } catch (error) {
        log.error('[QRIS] Payment Error:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data?.message || error.message
        };
    }
};

/**
 * Check QRIS payment status via PaKasir
 * Endpoint: GET https://app.pakasir.com/api/transactiondetail
 * 
 * @param {string} orderId - Order ID
 * @param {number} amount - Amount
 * @returns {Promise<Object>} - Payment status
 */
const checkQRISStatus = async (orderId, amount) => {
    try {
        const response = await axios.get(
            `${PAKASIR_BASE_URL}/transactiondetail`,
            {
                params: {
                    project: PAKASIR_SLUG,
                    order_id: orderId,
                    amount: amount,
                    api_key: PAKASIR_API_KEY
                },
                timeout: 10000
            }
        );

        log.info('[QRIS] Status check:', JSON.stringify(response.data));

        // PaKasir returns: { transaction: { status, completed_at, ... } }
        const txData = response.data.transaction || response.data;

        if (txData && txData.status) {
            return {
                success: true,
                status: txData.status, // 'pending' | 'completed' | 'expired'
                completed_at: txData.completed_at
            };
        }

        return {
            success: false,
            error: 'Failed to check status'
        };
    } catch (error) {
        log.error('[QRIS] Status Check Error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Cancel QRIS transaction
 * Endpoint: POST https://app.pakasir.com/api/transactioncancel
 * 
 * @param {string} orderId - Order ID
 * @returns {Promise<Object>}
 */
const cancelQRISPayment = async (orderId) => {
    try {
        const response = await axios.post(
            `${PAKASIR_BASE_URL}/transactioncancel`,
            {
                project: PAKASIR_SLUG,
                order_id: orderId,
                api_key: PAKASIR_API_KEY
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        return { success: true, data: response.data };
    } catch (error) {
        log.error('[QRIS] Cancel Error:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Handle PaKasir webhook callback
 * Webhook payload: { amount, order_id, project, status, payment_method, completed_at }
 * 
 * @param {Object} webhookData - Webhook payload from PaKasir
 * @returns {Object} - Parsed webhook data
 */
const handleQRISWebhook = (webhookData) => {
    try {
        log.info('[QRIS] Webhook received:', JSON.stringify(webhookData));

        const { order_id, status, amount, payment_method, completed_at, project } = webhookData;

        // Verify project matches — STRICT check
        if (project && project !== PAKASIR_SLUG) {
            log.warn(`[QRIS] ❌ Webhook project mismatch: received "${project}", expected "${PAKASIR_SLUG}"`);
            return { success: false, error: 'Project mismatch' };
        }

        return {
            success: true,
            orderId: order_id,
            status: status, // 'completed' = paid
            amount: amount,
            paymentMethod: payment_method,
            completedAt: completed_at
        };
    } catch (error) {
        log.error('[QRIS] Webhook Error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Verify transaction via PaKasir Transaction Detail API
 * Calls: GET https://app.pakasir.com/api/transactiondetail?project={slug}&amount={amount}&order_id={order_id}&api_key={api_key}
 * 
 * @param {string} orderId - Order ID
 * @param {number} amount - Amount in IDR
 * @returns {Promise<Object>} - { valid: boolean, status: string }
 */
const verifyTransactionWithAPI = async (orderId, amount) => {
    try {
        const response = await axios.get(`${PAKASIR_BASE_URL}/transactiondetail`, {
            params: {
                project: PAKASIR_SLUG,
                amount: amount,
                order_id: orderId,
                api_key: PAKASIR_API_KEY
            },
            timeout: 10000
        });

        const tx = response.data?.transaction;
        if (tx && tx.status === 'completed' && tx.order_id === orderId) {
            log.info(`[QRIS] ✅ Transaction ${orderId} verified via API`);
            return { valid: true, status: tx.status };
        } else {
            log.warn(`[QRIS] ⚠️ Transaction ${orderId} API status: ${tx?.status || 'unknown'}`);
            return { valid: false, status: tx?.status || 'unknown' };
        }
    } catch (error) {
        log.error(`[QRIS] API verify error for ${orderId}:`, error.message);
        // On API error, we still return valid=false but don't block
        // The webhook data itself is already validated
        return { valid: false, status: 'api_error', error: error.message };
    }
};

/**
 * Generate QRIS image URL from QR string
 * Uses Google Charts API to generate QR code image
 * 
 * @param {string} qrString - QR code string from PaKasir
 * @returns {string} - URL to QR code image
 */
const generateQRImageUrl = (qrString) => {
    const encoded = encodeURIComponent(qrString);
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encoded}`;
};

module.exports = {
    createQRISPayment,
    checkQRISStatus,
    cancelQRISPayment,
    handleQRISWebhook,
    verifyTransactionWithAPI,
    generateQRImageUrl
};
