const { Markup } = require('telegraf');
const path = require('path');
const fs = require('fs');
const { isRentBotEnabled } = require('../utils/features');
const { mainMenuKeyboard } = require('../utils/keyboard');

/**
 * Register Sewa Bot handler
 * @param {Object} bot - Telegraf bot instance
 */
const registerSewaBotHandler = (bot) => {

    const bannerPath = path.join(__dirname, '..', '..', 'assets', 'sewa_banner.png');
    console.log('[SEWABOT] Banner path:', bannerPath, '| Exists:', fs.existsSync(bannerPath));

    // Main sewa bot message
    const sewaBotMessage = `🤖 *Sewa Bot Order Telegram* — Jualan Autopilot 24/7

Capek balesin chat satu-satu? Pake bot kita, jualan jalan terus walau kamu tidur💤.

✨ Fitur:
├ 🛒 Auto Order & Delivery
├ 📱 QRIS Payment Gateway (PaKasir)
├ 💰 Sistem Saldo / Balance
├ 📦 Manajemen Stok & Produk
├ 📊 Admin Panel & Statistik Lengkap
├ 📣 Broadcast & Voucher Promo
├ 📥 Export Order CSV
├ 🌐 Multi-Bahasa (ID/EN)
├ 💾 Backup Database 1 Klik
└ 🎨 Tema QRIS Custom

💰 *Harga:*
➥ Rp 30.000 / bulan

✅ Setup mudah via web — data kamu 100% aman
🤖 *Demo bot: @cobasewabot*
📩 *Minat? Chat: @GREEBEL*`;

    const sewaBotKeyboard = Markup.inlineKeyboard([
        [
            Markup.button.url('📩 Hubungi Admin', 'https://t.me/GREEBEL'),
            Markup.button.callback('📋 Requirements', 'sewa_prepare')
        ],
        [
            Markup.button.url('🤖 Demo Bot', 'https://t.me/cobasewabot')
        ]
    ]);

    // Preparation checklist message
    const prepareMessage = `📋 *Yang Perlu Kamu Siapkan Sebelum Deploy:*

1. 🔑 License Key — _(dapat setelah pembayaran)_
2. 🤖 Bot Token — _(buat bot di @BotFather → copy tokennya)_
3. 🆔 Telegram ID Admin — _(cek di @userinfobot)_
4. 🏪 Nama Toko — _(maks 30 karakter, contoh: "Sultan Store")_
5. 📝 Format ID Pesanan — _(misal: ORD, INV, TRX)_
6. 💳 API Key PaKasir — _(daftar di pakasir.com → copy API Key)_
7. 📱 Slug PaKasir — _(nama project di PaKasir)_
8. 🖼 Banner Toko — _(file PNG, maks 2MB)_`;

    const prepareKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Kembali', 'sewa_back')]
    ]);

    // Helper: edit message (auto-detect photo caption vs text)
    const editMessage = async (ctx, text, keyboard) => {
        try {
            // Try editing caption first (photo message)
            await ctx.editMessageCaption(text, { parse_mode: 'Markdown', ...keyboard });
        } catch {
            // Fallback: edit as text message
            await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
        }
    };

    // Handler: button "🤖 Sewa Bot" from reply keyboard
    bot.hears(['◇ Sewa Bot', '🤖 Sewa Bot'], async (ctx) => {
        if (!isRentBotEnabled()) {
            await ctx.reply('Fitur Sewa Bot sedang tidak tersedia.', mainMenuKeyboard('id', ctx.from?.id?.toString()));
            return;
        }
        try {
            if (fs.existsSync(bannerPath)) {
                await ctx.replyWithPhoto(
                    { source: bannerPath },
                    { caption: sewaBotMessage, parse_mode: 'Markdown', ...sewaBotKeyboard }
                );
            } else {
                await ctx.reply(sewaBotMessage, {
                    parse_mode: 'Markdown',
                    ...sewaBotKeyboard
                });
            }
        } catch (e) {
            console.error('[SEWABOT] Error:', e.message);
            await ctx.reply(sewaBotMessage, {
                parse_mode: 'Markdown',
                ...sewaBotKeyboard
            });
        }
    });

    // Handler: button "📋 Requirements"
    bot.action('sewa_prepare', async (ctx) => {
        try {
            await editMessage(ctx, prepareMessage, prepareKeyboard);
        } catch (e) {
            console.error('[SEWABOT] Prepare error:', e.message);
        }
        await ctx.answerCbQuery();
    });

    // Handler: button "⬅️ Kembali"
    bot.action('sewa_back', async (ctx) => {
        try {
            await editMessage(ctx, sewaBotMessage, sewaBotKeyboard);
        } catch (e) {
            console.error('[SEWABOT] Back error:', e.message);
        }
        await ctx.answerCbQuery();
    });
};

module.exports = { registerSewaBotHandler };
