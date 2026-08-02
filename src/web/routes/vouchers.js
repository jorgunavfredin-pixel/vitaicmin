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
const vouchersService = require('../../services/vouchers');

// Hitung jumlah redemption per kode (akurat, per-user) dari voucher_redemptions.
const buildRedemptionMap = () => db.getVoucherRedemptionCounts();

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
        const voucher = vouchersService.createVoucher(req.body);
        res.json({ ok: true, voucher: { ...voucher, label: typeLabel(voucher) }, message: `Voucher ${voucher.code} (${typeLabel(voucher)}) berhasil dibuat` });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};

// ---- DELETE /vouchers/:id ----
const deleteVoucher = (req, res) => {
    try {
        const { id } = req.params;
        const exists = db.getVouchers().find(v => v.id === id);
        if (!exists) return res.status(404).json({ error: 'Voucher tidak ditemukan' });

        const result = vouchersService.deleteVoucherSafely(id);
        if (!result.ok) return res.status(result.reason === 'not_found' ? 404 : 409).json({ error: result.reason === 'in_use' ? 'Voucher memiliki histori/order aktif' : 'Voucher tidak ditemukan' });
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
