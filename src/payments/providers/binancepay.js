/**
 * Binance Pay provider adapter — BEDA dari provider QRIS lain.
 *
 * Toko QRIS lain: gateway men-generate QR dinamis + verifikasi via webhook/status.
 * Binance Pay di sini: QR STATIS (link uni-qr milik toko) yang ditampilkan ke buyer,
 * buyer transfer manual sesuai nominal, lalu MENGIRIM TX ID ke bot. Bot memverifikasi
 * dengan membaca riwayat Binance Pay MASUK milik penerima (READ-ONLY API key) via
 * endpoint resmi `GET /sapi/v1/pay/transactions`, lalu mencocokkan:
 *   - transactionId == TX ID yang di-submit buyer
 *   - amount        == nominal USDT yang diminta order
 *   - currency      == currency yang dikonfigurasi (default USDT)
 *   - arah          == dana MASUK (bukan keluar)
 *
 * Anti-fraud: caller (handler) WAJIB memanggil db.claimBinanceTxid() agar satu TX ID
 * tidak bisa dipakai ulang lintas order.
 *
 * Credentials = {
 *   api_key:    Binance API key (permission: Enable Reading SAJA),
 *   api_secret: Binance API secret,
 *   qr_string:  isi QR statis (mis. https://app.binance.com/uni-qr/XXXX) — untuk render QR,
 *   currency:   'USDT' (default),
 *   binance_id: opsional, hanya untuk ditampilkan ke buyer
 * }
 *
 * Bukti endpoint (SDK resmi Binance): GET /sapi/v1/pay/transactions, SIGNED (HMAC-SHA256),
 * header X-MBX-APIKEY, permission USER_DATA (Enable Reading). Field response.data[]:
 *   { transactionId, transactionTime, amount, currency, orderType, walletType,
 *     payerInfo{...}, receiverInfo{...} }
 */
const axios = require('axios');
const crypto = require('crypto');
const log = require('../../utils/logger');

const BINANCE_BASE_URL = 'https://api.binance.com';
const PAY_TRANSACTIONS_PATH = '/sapi/v1/pay/transactions';

// HMAC-SHA256 signature untuk endpoint /sapi/* (query string ditandatangani).
const sign = (queryString, apiSecret) =>
    crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

/**
 * Ambil riwayat transaksi Binance Pay (default 90 hari terakhir).
 * @returns {Promise<{success:boolean, rows?:Array, error?:string}>}
 */
const fetchPayTransactions = async (creds = {}, extraParams = {}) => {
    const apiKey = creds.api_key || '';
    const apiSecret = creds.api_secret || '';
    if (!apiKey || !apiSecret) {
        return { success: false, error: 'Credential Binance belum lengkap (api_key/api_secret)' };
    }
    try {
        const params = new URLSearchParams({
            timestamp: String(Date.now()),
            recvWindow: '5000',
            ...extraParams
        });
        const signature = sign(params.toString(), apiSecret);
        params.append('signature', signature);

        const url = `${BINANCE_BASE_URL}${PAY_TRANSACTIONS_PATH}?${params.toString()}`;
        const res = await axios.get(url, {
            headers: { 'X-MBX-APIKEY': apiKey },
            timeout: 15000,
            validateStatus: () => true
        });

        if (res.status === 401 || res.status === 403) {
            return { success: false, error: 'API key ditolak (cek permission Enable Reading / IP whitelist)' };
        }
        if (res.status !== 200) {
            const msg = res.data && (res.data.msg || res.data.message) ? (res.data.msg || res.data.message) : `HTTP ${res.status}`;
            return { success: false, error: `Binance API: ${msg}` };
        }
        const body = res.data || {};
        // Response shape: { code:'000000', message:'success', data:[...], success:true }
        if (body.code && body.code !== '000000' && body.success !== true) {
            return { success: false, error: `Binance: ${body.message || body.code}` };
        }
        const rows = Array.isArray(body.data) ? body.data : [];
        return { success: true, rows };
    } catch (error) {
        log.error(`[BINANCE] fetchPayTransactions error: ${error.message}`);
        return { success: false, error: error.message };
    }
};

// Normalisasi angka: "5.03000000" -> 5.03 ; toleransi pembanding pakai epsilon.
const toNum = (v) => {
    const n = parseFloat(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : NaN;
};

/**
 * Verifikasi pembayaran berdasarkan TX ID yang di-submit buyer + nominal order.
 * TIDAK menandai anti-reuse di sini (itu tugas handler via db.claimBinanceTxid);
 * fungsi ini murni: apakah transaksi VALID & COCOK di ledger penerima.
 *
 * @param {string} txId      - transactionId yang di-submit buyer
 * @param {number} amountUSDT- nominal USDT yang diminta order
 * @param {object} creds     - { api_key, api_secret, currency }
 * @returns {Promise<{valid:boolean, status:string, matched?:object, error?:string}>}
 */
const verifyByTxId = async (txId, amountUSDT, creds = {}, options = {}, _fetcher = fetchPayTransactions) => {
    const wantId = String(txId || '').trim();
    if (!wantId) return { valid: false, status: 'no_txid', error: 'TX ID kosong' };

    const currency = (creds.currency || 'USDT').toUpperCase();
    const want = toNum(amountUSDT);
    if (!Number.isFinite(want)) return { valid: false, status: 'bad_amount', error: 'Nominal order tidak valid' };

    const r = await _fetcher(creds);
    if (!r.success) return { valid: false, status: 'api_error', error: r.error };

    // PENTING: TX ID yang buyer lihat & copy di app Binance = field `orderId`
    // (angka panjang, mis. 446089779784040448), BUKAN `transactionId` (P_A2...).
    // Cocokkan ke orderId dulu, fallback ke transactionId untuk jaga-jaga.
    const tx = r.rows.find((t) =>
        String(t.orderId || '').trim() === wantId ||
        String(t.transactionId || '').trim() === wantId
    );
    if (!tx) {
        return { valid: false, status: 'not_found', error: 'TX ID tidak ditemukan di riwayat pembayaran' };
    }

    // Cocokkan currency.
    const txCurrency = String(tx.currency || '').toUpperCase();
    if (currency && txCurrency && txCurrency !== currency) {
        return { valid: false, status: 'currency_mismatch', error: `Mata uang ${txCurrency} ≠ ${currency}`, matched: tx };
    }

    // Jika Binance ID penerima dikonfigurasi, pastikan dana memang masuk ke akun toko.
    // Cegah buyer memakai ID transaksi yang bukan pembayaran ke akun ini.
    const expectedReceiver = String(creds.binance_id || '').trim();
    const actualReceiver = String(tx.receiverInfo?.binanceId || tx.receiverInfo?.accountId || '').trim();
    if (expectedReceiver && actualReceiver && expectedReceiver !== actualReceiver) {
        return { valid: false, status: 'receiver_mismatch', error: 'Penerima transaksi bukan akun Binance toko', matched: tx };
    }

    // Transaksi harus terjadi setelah order dibuat. Cegah pemakaian transaksi lama yang
    // nominalnya kebetulan sama tetapi belum tercatat di tabel anti-reuse.
    const createdAt = options.orderCreatedAt ? new Date(options.orderCreatedAt).getTime() : 0;
    const txTime = Number(tx.transactionTime || 0);
    if (createdAt && txTime && txTime < createdAt - 60_000) {
        return { valid: false, status: 'too_old', error: 'Transaksi terjadi sebelum order dibuat', matched: tx };
    }

    // Cocokkan nominal (epsilon kecil untuk pembulatan).
    const got = Math.abs(toNum(tx.amount));
    if (!Number.isFinite(got)) return { valid: false, status: 'bad_amount', error: 'Nominal transaksi tidak terbaca', matched: tx };
    const diff = Math.abs(got - want);
    if (diff > 0.01) {
        return { valid: false, status: 'amount_mismatch', error: `Nominal transaksi ${got} ≠ diminta ${want}`, matched: tx };
    }

    // Pastikan dana MASUK: amount positif. (Binance Pay history bisa memuat kirim & terima;
    // transaksi keluar biasanya bernilai negatif.)
    if (toNum(tx.amount) < 0) {
        return { valid: false, status: 'outgoing', error: 'Transaksi terdeteksi keluar, bukan masuk', matched: tx };
    }

    return { valid: true, status: 'completed', matched: tx };
};

/**
 * Test koneksi credential (tombol Test di panel). Cukup pastikan API key valid
 * & bisa membaca /pay/transactions (permission Enable Reading).
 */
const testConnection = async (creds = {}) => {
    if (!creds.api_key || !creds.api_secret) return { ok: false, message: 'API key & secret wajib diisi' };
    const r = await fetchPayTransactions(creds);
    if (r.success) return { ok: true, message: `Koneksi & credential valid (${r.rows.length} transaksi terbaca)` };
    return { ok: false, message: r.error || 'Gagal terhubung ke Binance' };
};

/**
 * Render QR statis Binance + logo Binance emas di tengah menjadi PNG buffer.
 * Error correction 'H' (tahan ~30% tertutup) supaya logo tengah tidak merusak QR.
 * qrString = isi QR statis (mis. https://app.binance.com/uni-qr/XXXX).
 * @returns {Promise<Buffer>}
 */
const renderQrWithLogo = async (qrString, size = 600) => {
    if (!qrString) throw new Error('QR string Binance kosong');
    const QRCode = require('qrcode');
    const sharp = require('sharp');

    const qrBuf = await QRCode.toBuffer(String(qrString), {
        type: 'png', width: size, margin: 2, errorCorrectionLevel: 'H',
        color: { dark: '#000000', light: '#ffffff' }
    });

    const logoSize = Math.round(size * 0.22);
    const pad = Math.round(logoSize * 0.16);
    const panel = logoSize + pad * 2;
    const gold = '#F0B90B';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${panel}" height="${panel}">
      <rect x="0" y="0" width="${panel}" height="${panel}" rx="${Math.round(panel * 0.22)}" fill="#ffffff"/>
      <g transform="translate(${pad},${pad})">
        <g fill="${gold}" transform="translate(${logoSize / 2},${logoSize / 2})">
          <rect x="-9" y="-9" width="18" height="18" transform="rotate(45)"/>
          <rect x="-9" y="-30" width="18" height="18" transform="rotate(45)"/>
          <rect x="-9" y="12" width="18" height="18" transform="rotate(45)"/>
          <rect x="-30" y="-9" width="18" height="18" transform="rotate(45)"/>
          <rect x="12" y="-9" width="18" height="18" transform="rotate(45)"/>
        </g>
      </g>
    </svg>`;
    const logoBuf = await sharp(Buffer.from(svg)).png().toBuffer();

    const qrWithLogo = await sharp(qrBuf).composite([{ input: logoBuf, gravity: 'center' }]).png().toBuffer();

    // Pakai twibbon QRIS yang aktif juga (setting/preset sama persis dari panel).
    // Kalau twibbon dimatikan/tidak tersedia, tetap kirim QR Binance + logo polos.
    try {
        const { renderActive } = require('../../services/qrisCustom');
        return (await renderActive(qrWithLogo)) || qrWithLogo;
    } catch (_) {
        return qrWithLogo;
    }
};

module.exports = {
    fetchPayTransactions,
    verifyByTxId,
    testConnection,
    renderQrWithLogo
};
