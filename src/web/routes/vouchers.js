/**
 * Voucher management untuk panel web admin.
 * Mirror fitur chat-admin (src/admin/vouchers.js): list, create, delete.
 *
 * Catatan penting soal model pemakaian voucher:
 * - Kolom `used` di tabel vouchers itu flag GLOBAL (legacy), TAPI logika checkout
 *   (src/handlers/order.js) memakai per-user via tabel `voucher_redemptions`
 *   (1 kode = 1x pakai PER user). Jadi jumlah pemakaian yang akurat = COUNT dari
 *   voucher_redemptions, bukan flag `used`.
 */
const db = require('../../models/db');
const { formatIDR } = require('../../utils/helpers');

// Hitung jumlah redemption per kode (akurat, per-user) dari voucher_redemptions.
const buildRedemptionMap = () => {
    const rows = db._db.prepare(
        'SELECT UPPER(voucher_code) AS code, COUNT(*) AS n FROM voucher_redemptions GROUP BY UPPER(voucher_code)'
    ).all();
    const map = {};
    for (const r of rows) map[r.code] = r.n;
    return map;
};

const typeLabel = (v) => v.type === 'percent' ? `${v.value}%` : `Rp ${formatIDR(v.value)}`;

// ---- GET /vouchers ----
const listVouchers = (req, res) => {
    try {
        const vouchers = db.getVouchers();
        const redMap = buildRedemptionMap();

        const items = vouchers.map(v => {
            const redemptions = redMap[String(v.code).toUpperCase()] || 0;
            return {
                id: v.id,
                code: v.code,
                type: v.type,                       // 'percent' | 'fixed'
                value: v.value,
                label: typeLabel(v),
                redemptions,                        // berapa user sudah pakai (akurat)
                used: !!v.used,                     // flag global legacy
                created_at: v.created_at || null
            };
        });

        // Urut terbaru dulu
        items.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

        const stats = {
            total: items.length,
            percent: items.filter(v => v.type === 'percent').length,
            fixed: items.filter(v => v.type === 'fixed').length,
            totalRedemptions: items.reduce((s, v) => s + v.redemptions, 0)
        };

        res.json({ vouchers: items, stats });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- POST /vouchers ----  { code, type: 'percent'|'fixed', value }
const createVoucher = (req, res) => {
    try {
        const code = String(req.body.code || '').trim().toUpperCase();
        const type = String(req.body.type || '').trim().toLowerCase();
        const value = parseInt(req.body.value);

        // Validasi (mirror aturan chat-admin)
        if (!code) return res.status(400).json({ error: 'Kode voucher wajib diisi' });
        if (!/^[A-Z0-9_-]+$/.test(code)) return res.status(400).json({ error: 'Kode hanya boleh huruf, angka, - dan _' });
        if (!['percent', 'fixed'].includes(type)) return res.status(400).json({ error: 'Tipe harus percent atau fixed' });
        if (isNaN(value) || value <= 0) return res.status(400).json({ error: 'Nilai diskon harus angka positif' });
        if (type === 'percent' && value > 100) return res.status(400).json({ error: 'Diskon persen tidak boleh lebih dari 100%' });

        if (db.getVoucherByCode(code)) {
            return res.status(409).json({ error: `Kode voucher "${code}" sudah ada` });
        }

        const voucher = db.createVoucher({ code, type, value });
        res.json({
            ok: true,
            voucher: { ...voucher, label: typeLabel(voucher) },
            message: `Voucher ${code} (${typeLabel(voucher)}) berhasil dibuat`
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ---- DELETE /vouchers/:id ----
const deleteVoucher = (req, res) => {
    try {
        const { id } = req.params;
        const exists = db.getVouchers().find(v => v.id === id);
        if (!exists) return res.status(404).json({ error: 'Voucher tidak ditemukan' });

        db.deleteVoucher(id);
        res.json({ ok: true, message: `Voucher ${exists.code} dihapus` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

const registerVoucherRoutes = (api) => {
    api.get('/vouchers', listVouchers);
    api.post('/vouchers', createVoucher);
    api.delete('/vouchers/:id', deleteVoucher);
};

module.exports = { registerVoucherRoutes };
