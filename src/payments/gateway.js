/**
 * Payment gateway dispatcher (Fase 4/5) — satu titik masuk untuk semua provider QRIS.
 *
 * Toko HANYA memakai QRIS. Kalau >1 gateway QRIS aktif, buyer memilih gateway
 * saat checkout; gateway yang dipilih (by id) yang meng-generate QRIS, dan
 * SEMUA operasi lanjutan (cek status, verifikasi webhook) memakai gateway yang
 * SAMA — dijamin lewat order.gateway_id.
 *
 * Provider yang didukung:
 *   - pakasir   (credentials: api_key, slug)
 *   - wijayapay (credentials: code_merchant, api_key)
 *
 * Credential di-resolve dari DB (tabel payment_gateways) atau, sebagai fallback,
 * dari .env (prefix PAKASIR_ / WIJAYAPAY_). Semua di-resolve SAAT CALL supaya
 * perubahan dari panel admin langsung berlaku tanpa restart.
 */
const log = require('../utils/logger');

const ADAPTERS = {
    pakasir: require('./providers/pakasir'),
    wijayapay: require('./providers/wijayapay'),
    xoftware: require('./providers/xoftware')
};

const getAdapter = (provider) => ADAPTERS[provider] || null;

// Provider yang dianggap valid untuk seluruh sistem (dipakai validasi web & UI).
const SUPPORTED_PROVIDERS = Object.keys(ADAPTERS);

// Field credential per provider (buat validasi & masking di web admin).
const PROVIDER_FIELDS = {
    pakasir: ['api_key', 'slug'],
    wijayapay: ['code_merchant', 'api_key'],
    xoftware: ['api_key', 'merchant_id', 'webhook_secret', 'registered_notify_url']
};

/**
 * Bangun credential dari .env untuk provider tertentu (fallback backward-compat).
 * @returns {object|null}
 */
const envCredential = (provider) => {
    if (provider === 'pakasir') {
        const api_key = process.env.PAKASIR_API_KEY || '';
        const slug = process.env.PAKASIR_SLUG || '';
        if (api_key || slug) return { api_key, slug };
    }
    if (provider === 'wijayapay') {
        const code_merchant = process.env.WIJAYAPAY_CODE_MERCHANT || '';
        const api_key = process.env.WIJAYAPAY_API_KEY || '';
        if (code_merchant || api_key) return { code_merchant, api_key };
    }
    if (provider === 'xoftware') {
        const api_key = process.env.XOWFTWARE_API_KEY || '';
        const merchant_id = process.env.XOWFTWARE_MERCHANT_ID || '';
        const webhook_secret = process.env.XOWFTWARE_WEBHOOK_SECRET || '';
        const registered_notify_url = process.env.XOWFTWARE_NOTIFY_URL || '';
        const fee_direction = process.env.XOWFTWARE_FEE_DIRECTION === 'user' ? 'user' : 'merchant';
        if (api_key || merchant_id || webhook_secret || registered_notify_url) return { api_key, merchant_id, webhook_secret, registered_notify_url, fee_direction };
    }
    return null;
};

const effectiveCredentials = (provider, creds = {}) => {
    if (provider !== 'xoftware') return creds;
    return {
        ...creds,
        registered_notify_url: creds.registered_notify_url || process.env.XOWFTWARE_NOTIFY_URL || ''
    };
};

/**
 * Daftar gateway QRIS yang aktif & siap dipakai buyer (punya credential lengkap).
 * Menggabungkan gateway DB (enabled) + fallback .env untuk provider yang belum
 * punya baris DB. Setiap item: { id, provider, label, credentials }.
 * id null menandakan "dari .env" (dipakai sebagai gateway tunggal implisit).
 */
const listActiveGateways = () => {
    const db = require('../models/db');
    const out = [];
    let dbGateways = [];
    try { dbGateways = db.getPaymentGateways(); } catch (e) { dbGateways = []; }

    const providersWithDbRow = new Set();
    for (const gw of dbGateways) {
        providersWithDbRow.add(gw.provider);
        if (!gw.enabled) continue;
        const credentials = effectiveCredentials(gw.provider, gw.credentials);
        if (!hasCompleteCreds(gw.provider, credentials)) continue;
        out.push({ id: gw.id, provider: gw.provider, label: gw.label || providerLabel(gw.provider), credentials });
    }

    // Fallback .env: hanya untuk provider yang BELUM punya baris DB sama sekali,
    // supaya sistem lama (env-only) tetap jalan tanpa harus bikin gateway di panel.
    for (const provider of SUPPORTED_PROVIDERS) {
        if (providersWithDbRow.has(provider)) continue;
        const cred = envCredential(provider);
        if (cred && hasCompleteCreds(provider, cred)) {
            out.push({ id: null, provider, label: `${providerLabel(provider)} (.env)`, credentials: cred });
        }
    }
    return out.map((gw, index) => ({
        ...gw,
        qris_number: index + 1,
        buyer_label: `QRIS ${index + 1}`
    }));
};

const providerLabel = (provider) => ({ pakasir: 'PaKasir', wijayapay: 'WijayaPay', xoftware: 'Xoftware Pay' }[provider] || provider);

const hasCompleteCreds = (provider, creds) => {
    if (!creds) return false;
    const fields = PROVIDER_FIELDS[provider] || [];
    const complete = fields.every((f) => creds[f] && String(creds[f]).trim() !== '');
    if (!complete) return false;
    if (provider === 'xoftware' && !/^https?:\/\/[^\s]+$/i.test(String(creds.registered_notify_url))) return false;
    return true;
};

/**
 * Resolve satu gateway (provider + credentials) dari gateway_id.
 * gatewayId null/undefined → pakai gateway aktif pertama (single-gateway / env).
 * @returns {{id:string|null, provider:string, credentials:object}|null}
 */
const resolveGateway = (gatewayId) => {
    const db = require('../models/db');
    if (gatewayId) {
        let gw = null;
        try { gw = db.getPaymentGatewayById(gatewayId); } catch (e) { gw = null; }
        const credentials = gw ? effectiveCredentials(gw.provider, gw.credentials) : null;
        if (gw && hasCompleteCreds(gw.provider, credentials)) {
            return { id: gw.id, provider: gw.provider, credentials };
        }
        // gateway_id sudah tidak valid (dihapus/creds kosong) → fall through ke default.
        log.warn(`[GATEWAY] gateway_id ${gatewayId} tidak valid, fallback ke gateway aktif`);
    }
    const active = listActiveGateways();
    if (active.length > 0) {
        const g = active[0];
        return { id: g.id, provider: g.provider, credentials: g.credentials };
    }
    return null;
};

/**
 * Buat QRIS lewat gateway yang dipilih.
 * @param {string} orderId
 * @param {number} amount
 * @param {string|null} gatewayId - id gateway pilihan buyer (null = default/tunggal)
 * @returns {Promise<{success, gateway_id, provider, data?, error?}>}
 */
const createQRIS = async (orderId, amount, gatewayId = null, options = {}) => {
    const gw = resolveGateway(gatewayId);
    if (!gw) return { success: false, error: 'Tidak ada payment gateway aktif' };
    const adapter = getAdapter(gw.provider);
    if (!adapter) return { success: false, error: `Provider ${gw.provider} tidak didukung` };

    const r = await adapter.createQRIS(orderId, amount, gw.credentials, options);
    return { ...r, gateway_id: gw.id, provider: gw.provider };
};

/**
 * Cek status via gateway yang membuat transaksi.
 * @returns {Promise<{success, status?, error?}>} status: completed|expired|pending
 */
const checkStatus = async (orderId, amount, gatewayId = null, options = {}) => {
    const gw = resolveGateway(gatewayId);
    if (!gw) return { success: false, error: 'Tidak ada payment gateway aktif' };
    const adapter = getAdapter(gw.provider);
    if (!adapter) return { success: false, error: `Provider ${gw.provider} tidak didukung` };
    return adapter.checkStatus(orderId, amount, gw.credentials, options);
};

/**
 * Verifikasi authoritative (dipanggil dari webhook handler).
 * @returns {Promise<{valid, status, error?}>}
 */
const verifyTransaction = async (orderId, amount, gatewayId = null) => {
    const gw = resolveGateway(gatewayId);
    if (!gw) return { valid: false, status: 'no_gateway' };
    const adapter = getAdapter(gw.provider);
    if (!adapter) return { valid: false, status: 'unsupported' };
    return adapter.verifyTransaction(orderId, amount, gw.credentials);
};

/**
 * Test koneksi credential (dipakai tombol Test di panel). credsOverride opsional
 * untuk menguji credential yang belum disimpan.
 */
const testConnection = async (provider, credsOverride) => {
    const adapter = getAdapter(provider);
    if (!adapter) return { ok: false, message: `Provider ${provider} tidak didukung` };
    const creds = credsOverride || envCredential(provider) || {};
    return adapter.testConnection(creds);
};

/**
 * Generate URL gambar QR dari string QRIS (fallback universal via qrserver).
 * Provider yang menyediakan qr_image sendiri (WijayaPay) tetap bisa memakainya.
 */
const generateQRImageUrl = (qrString) => {
    const encoded = encodeURIComponent(qrString);
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encoded}`;
};

module.exports = {
    SUPPORTED_PROVIDERS,
    PROVIDER_FIELDS,
    providerLabel,
    hasCompleteCreds,
    envCredential,
    listActiveGateways,
    resolveGateway,
    getAdapter,
    createQRIS,
    checkStatus,
    verifyTransaction,
    testConnection,
    generateQRImageUrl
};
