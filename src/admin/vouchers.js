/**
 * Admin — Voucher Management
 * Extracted from panel.js
 */
const db = require('../models/db');
const { formatIDR } = require('../utils/helpers');
const { navButtons, cancelButton } = require('../utils/keyboard');

function registerVoucherHandlers(bot, { isAdmin, adminStates }) {
    // ==================== VOUCHER MANAGEMENT ====================

    bot.action('adm_vouchers', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const vouchers = db.getVouchers();
        const active = vouchers.filter(v => !v.used);
        const used = vouchers.filter(v => v.used);

        let msg = `🎟️ *Voucher Management*\n\n`;
        msg += `📋 Total: ${vouchers.length} | ✅ Aktif: ${active.length} | ❌ Terpakai: ${used.length}\n\n`;

        if (active.length > 0) {
            msg += `*Voucher Aktif:*\n`;
            active.forEach(v => {
                const typeLabel = v.type === 'percent' ? `${v.value}%` : `Rp ${formatIDR(v.value)}`;
                msg += `⬢ \`${v.code}\` → ${typeLabel}\n`;
            });
        }

        if (used.length > 0) {
            msg += `\n*Terpakai:*\n`;
            used.slice(-5).forEach(v => {
                const typeLabel = v.type === 'percent' ? `${v.value}%` : `Rp ${formatIDR(v.value)}`;
                msg += `⬢ ~${v.code}~ → ${typeLabel} (by ${v.used_by})\n`;
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

        adminStates.set(ctx.from.id.toString(), {
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

        const vouchers = db.getVouchers().filter(v => !v.used);
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

        db.deleteVoucher(voucherId);

        await ctx.editMessageText('✅ Voucher berhasil dihapus!', {
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

    const code = parts[0].toUpperCase();
    const value = parseInt(parts[1]);

    if (isNaN(value) || value <= 0) {
        await ctx.reply('❌ Nilai diskon harus berupa angka positif.');
        return;
    }

    const existing = db.getVoucherByCode(code);
    if (existing) {
        await ctx.reply(`❌ Kode voucher \`${code}\` sudah ada!`, { parse_mode: 'Markdown' });
        return;
    }

    if (state.type === 'percent' && value > 100) {
        await ctx.reply('❌ Diskon persen tidak boleh lebih dari 100%.');
        return;
    }

    const voucher = db.createVoucher({
        code: code,
        type: state.type,
        value: value
    });

    adminStates.delete(ctx.from.id.toString());

    const typeLabel = state.type === 'percent' ? `${value}%` : `Rp ${formatIDR(value)}`;
    await ctx.reply(`✅ *Voucher Berhasil Dibuat!*\n\n🎟️ Kode: \`${code}\`\n💰 Diskon: ${typeLabel}\n📝 Status: Aktif (1x pakai)`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: navButtons('adm_vouchers') }
    });
}

module.exports = { registerVoucherHandlers, handleCreateVoucher };
