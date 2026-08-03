const { Markup } = require('telegraf');
const path = require('path');
const fs = require('fs');
const { isRentBotEnabled } = require('../utils/features');
const { mainMenuKeyboard } = require('../utils/keyboard');

const registerSewaBotHandler = (bot) => {

    const bannerPath = path.join(__dirname, '..', '..', 'assets', 'sewa_banner.png');

    const sewaBotMessage = `<blockquote>🤖 <b>Sewa Bot Telegram — Jualan Autopilot 24/7</b></blockquote>

<b>Fitur:</b>
▸ Auto Order & Delivery
▸ QRIS Multi-Gateway (Wijayapay, Xoftware, KlikQris)
▸ Sistem Saldo
▸ Stok, Produk, Flash Sale
▸ Admin Web + Chat
▸ Voucher & Broadcast
▸ Multi-Bahasa ID/EN

<blockquote><b>Rp 30.000</b>/bulan · Setup via web</blockquote>

<b>Demo:</b> @cobasewabot
<b>Order:</b> @GREEBEL`;

    const sewaBotKeyboard = Markup.inlineKeyboard([
        [
            Markup.button.url('📩 Hubungi Admin', 'https://t.me/GREEBEL'),
            Markup.button.callback('📋 Syarat Deploy', 'sewa_prepare')
        ],
        [
            Markup.button.url('🤖 Coba Demo Bot', 'https://t.me/cobasewabot')
        ]
    ]);

    const prepareMessage = `<blockquote><b>📋 Siapkan Sebelum Deploy:</b></blockquote>

1. <b>🔑 License Key</b> — (dapat setelah pembayaran)
2. <b>🤖 Bot Token</b> — (buat bot di @BotFather → copy tokennya)
3. <b>🆔 Telegram ID Admin</b> — (cek di @userinfobot)
4. <b>🏪 Nama Toko</b> — (maks 30 karakter, contoh: "Sultan Store")
5. <b>💳 Data Payment Gateway</b> — (<a href="https://t.me/vitaciminstore/5">Panduan Payment Gateway</a>)
6. <b>🖼 Banner Toko</b> — (Opsional)`;

    const prepareKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('‹ Kembali', 'sewa_back')]
    ]);

    const editMessage = async (ctx, text, keyboard) => {
        try {
            await ctx.editMessageCaption(text, { parse_mode: 'HTML', ...keyboard, disable_web_page_preview: true });
        } catch {
            await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard, disable_web_page_preview: true });
        }
    };

    bot.hears(['◇ Sewa Bot', '🤖 Sewa Bot'], async (ctx) => {
        if (!isRentBotEnabled()) {
            await ctx.reply('Fitur Sewa Bot sedang tidak tersedia.', mainMenuKeyboard('id', ctx.from?.id?.toString()));
            return;
        }
        try {
            if (fs.existsSync(bannerPath)) {
                await ctx.replyWithPhoto(
                    { source: bannerPath },
                    { caption: sewaBotMessage, parse_mode: 'HTML', ...sewaBotKeyboard, disable_web_page_preview: true }
                );
            } else {
                await ctx.reply(sewaBotMessage, {
                    parse_mode: 'HTML',
                    ...sewaBotKeyboard,
                    disable_web_page_preview: true
                });
            }
        } catch (e) {
            console.error('[SEWABOT] Error:', e.message);
            await ctx.reply(sewaBotMessage, {
                parse_mode: 'HTML',
                ...sewaBotKeyboard,
                disable_web_page_preview: true
            });
        }
    });

    bot.action('sewa_prepare', async (ctx) => {
        try {
            await editMessage(ctx, prepareMessage, prepareKeyboard);
        } catch (e) {
            console.error('[SEWABOT] Prepare error:', e.message);
        }
        await ctx.answerCbQuery();
    });

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
