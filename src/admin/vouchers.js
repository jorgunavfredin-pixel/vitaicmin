/**
 * Admin — Voucher Management
 * Extracted from panel.js
 */
const db = require('../models/db');
const { formatIDR } = require('../utils/helpers');
const { navButtons, cancelButton } = require('../utils/keyboard');
const { createVoucher, deleteVoucherSafely } = require('../services/vouchers');

function registerVoucherHandlers(bot, { isAdmin, adminStates }) {
    // ==================== VOUCHER MANAGEMENT ====================

    bot.action('adm_vouchers', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const vouchers = db.getVouchers();
        const counts = db.getVoucherRedemptionCounts();
        const totalRedemptions = Object.values(counts).reduce((sum, n) => sum + n, 0);

        let msg = `🎟️ *Voucher Management*\n\n`;
        msg += `📋 Total kode: ${vouchers.length} | 👥 Total redemption: ${totalRedemptions}\n\n`;
        if (vouchers.length > 0) {
            msg += `*Voucher Tersedia:*\n`;
            vouchers.forEach(v => {
                const typeLabel = v.type === 'percent' ? `${v.value}%` : `Rp ${formatIDR(v.value)}`;
                msg += `⬢ \`${v.code}\` → ${typeLabel} · Dipakai ${counts[v.code.toUpperCase()] || 0} user\n`;
            });
        }

        await ctx.editMessageText(msg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ Buat Voucher', callback_data: 'adm_voucher_create' }],
                    [{ text: '🗑 Hapus Voucher', callback_data: 'adm_voucher_delete_menu' }],
                    ...navButtons('admin_home')
                ]
            }
        });
    });

    // Create voucher - step 1: choose type
    bot.action('adm_voucher_create', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        await ctx.editMessageText('🎟️ *Buat Voucher Baru*\n\nPilih tipe diskon:', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💰 Persen (%)', callback_data: 'adm_voucher_type_percent' }],
                    [{ text: '💰 Potongan Harga (Rp)', callback_data: 'adm_voucher_type_fixed' }],
                    ...navButtons('adm_vouchers')
                ]
            }
        });
    });

    // Create voucher - step 2: set type, ask for code & value
    bot.action(/^adm_voucher_type_(percent|fixed)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const type = ctx.match[1];
        await ctx.answerCbQuery();

        adminStates.setFor(ctx, {
            action: 'create_voucher',
            step: 'code',
            type: type
        });

        const unitLabel = type === 'percent' ? 'persen (contoh: 10 untuk 10%)' : 'nominal (contoh: 5000 untuk Rp 5.000)';
        await ctx.editMessageText(`🎟️ *Buat Voucher (${type === 'percent' ? 'Persen' : 'Potongan'})*\n\nKirim kode voucher dan nilai diskon.\nFormat: \`KODE NILAI\`\n\nContoh: \`DISKON10 10\`\nNilai dalam ${unitLabel}`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    // Delete voucher menu
    bot.action('adm_voucher_delete_menu', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const vouchers = db.getVouchers();
        if (vouchers.length === 0) {
            await ctx.editMessageText('❌ Tidak ada voucher aktif untuk dihapus.', {
                reply_markup: { inline_keyboard: navButtons('adm_vouchers') }
            });
            return;
        }

        const buttons = vouchers.map(v => {
            const typeLabel = v.type === 'percent' ? `${v.value}%` : `Rp ${formatIDR(v.value)}`;
            return [{ text: `🗑 ${v.code} (${typeLabel})`, callback_data: `adm_voucher_del_${v.id}` }];
        });
        buttons.push(...navButtons('adm_vouchers'));

        await ctx.editMessageText('🗑 *Pilih voucher yang mau dihapus:*', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    });

    // Confirm delete voucher
    bot.action(/^adm_voucher_del_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const voucherId = ctx.match[1];
        await ctx.answerCbQuery();

        const result = deleteVoucherSafely(voucherId);
        const message = result.ok ? '✅ Voucher berhasil dihapus!' : result.reason === 'in_use'
            ? '❌ Voucher memiliki redemption/order aktif dan tidak dapat dihapus.' : '❌ Voucher tidak ditemukan.';
        await ctx.editMessageText(message, {
            reply_markup: { inline_keyboard: navButtons('adm_vouchers') }
        });
    });
}

// Input handler for creating voucher
async function handleCreateVoucher(ctx, state, text, adminStates) {
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2) {
        await ctx.reply('❌ Format salah. Kirim: `KODE NILAI`\nContoh: `DISKON10 10`', { parse_mode: 'Markdown' });
        return;
    }

    let voucher;
    try { voucher = createVoucher({ code: parts[0], type: state.type, value: parts[1] }); }
    catch (e) { await ctx.reply(`❌ ${e.message}`); return; }
    const { code, value } = voucher;

    adminStates.delete(ctx.from.id.toString());

    const typeLabel = state.type === 'percent' ? `${value}%` : `Rp ${formatIDR(value)}`;
    await ctx.reply(`✅ *Voucher Berhasil Dibuat!*\n\n🎟️ Kode: \`${code}\`\n💰 Diskon: ${typeLabel}\n📝 Status: Tersedia — maksimal 1x per user`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: navButtons('adm_vouchers') }
    });
}

module.exports = { registerVoucherHandlers, handleCreateVoucher };
