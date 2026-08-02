/**
 * Admin — Broadcast System (Non-blocking)
 * Broadcast runs in background so bot stays responsive
 */
const { Markup } = require('telegraf');
const db = require('../models/db');
const { escapeHtml } = require('../utils/helpers');
const { broadcastKeyboard, navButtons, cancelButton } = require('../utils/keyboard');
const { resolveTargets, startBroadcastJob, getBroadcastJob } = require('../services/broadcast');

const BROADCAST_DELAY_MS = 50; // 20 msg/sec, safe dari rate limit

function registerBroadcastHandlers(bot, { isAdmin, adminStates }) {

    bot.action('adm_broadcast', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        await ctx.editMessageText('📣 *Broadcast*\n\nPilih target broadcast:', {
            parse_mode: 'Markdown',
            ...broadcastKeyboard()
        });
    });

    bot.action('adm_bc_all', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        adminStates.setFor(ctx, { action: 'broadcast' });

        await ctx.editMessageText('🔔 *Broadcast ke Semua*\n\nKirim pesan yang mau di-broadcast:\n\n💡 *Tips:*\n• Support _teks_ dengan formatting (bold, italic, dll)\n• Atau kirim _foto_ dengan caption\n• Header `📢 BROADCAST MESSAGE` otomatis ditambahkan', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    // Broadcast per Kategori — Step 1: Show category list
    bot.action('adm_bc_category', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const categories = db.getCategories().filter(c => c.active !== false);
        if (categories.length === 0) {
            await ctx.editMessageText('❌ Tidak ada kategori aktif.', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: navButtons('adm_broadcast') }
            });
            return;
        }

        const buttons = categories.map(cat => {
            const emoji = cat.emoji || '📢';
            return [Markup.button.callback(`${emoji} ${cat.name_id}`, `adm_bc_cat_select_${cat.id}`)];
        });
        buttons.push(...navButtons('adm_broadcast'));

        await ctx.editMessageText('📢 *Broadcast per Kategori*\n\nPilih kategori target broadcast:\n_(hanya user yang pernah beli di kategori ini yang akan menerima)_', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    });

    // Broadcast per Kategori — Step 2: Select category, ask for message
    bot.action(/^adm_bc_cat_select_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const catId = ctx.match[1];
        const cat = db.getCategories().find(c => c.id === catId);
        if (!cat) return;

        const products = db.getProductsByCategory(catId);
        const productIds = products.map(p => p.id);
        const orders = db.getOrders().filter(o => productIds.includes(o.product_id) && (o.status === 'delivered' || o.status === 'paid'));
        const uniqueUsers = [...new Set(orders.map(o => o.user_id))];

        adminStates.setFor(ctx, { action: 'broadcast_category', catId, targetUsers: uniqueUsers });

        await ctx.editMessageText(`📢 *Broadcast ke Kategori: ${cat.name_id}*\n\n👥 Target: ${uniqueUsers.length} user\n\nKirim pesan yang mau di-broadcast:\n\n💡 *Tips:*\n• Support _teks_ dengan formatting (bold, italic, dll)\n• Atau kirim _foto_ dengan caption\n• Header \`📢 BROADCAST MESSAGE\` otomatis ditambahkan`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: cancelButton() }
        });
    });

    bot.action('adm_bc_flash_active', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const products = db.getActiveFlashSales().filter(p => !p.flash_slots?.limited || p.flash_slots.remaining > 0);
        if (!products.length) return ctx.editMessageText('❌ Tidak ada Flash Sale aktif.', { reply_markup: { inline_keyboard: navButtons('adm_broadcast') } });
        const buttons = products.map(p => [Markup.button.callback(`⚡ ${p.name_id}`, `adm_bc_flash_pick_${p.id}`)]);
        buttons.push(...navButtons('adm_broadcast'));
        await ctx.editMessageText('⚡ *Flash Sale Aktif*\n\nPilih produk untuk dibuatkan template broadcast:', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    });

    bot.action(/^adm_bc_flash_pick_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const prod = db.getProductById(ctx.match[1]);
        if (!prod || !db.isFlashSaleActive(prod)) return ctx.answerCbQuery('Flash Sale tidak aktif', { show_alert: true });
        const slots = db.getFlashSaleSlotStats(prod);
        const end = new Date(prod.flash_end).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const text = `⚡🔥 <b>FLASH SALE!</b>\n\n📦 <b>${escapeHtml(prod.name_id)}</b>\n💵 <s>Rp ${prod.price_idr.toLocaleString('id-ID')}</s> → <b>Rp ${prod.flash_price.toLocaleString('id-ID')}</b>\n⏰ Berakhir: ${end} WIB${slots.limited ? `\n🎯 Sisa ${slots.remaining} slot` : ''}\n\n🛒 Order sekarang sebelum promo berakhir!`;
        const targets = resolveTargets('all');
        adminStates.setFor(ctx, { action: 'broadcast_flash_confirm', productId: prod.id, text, targetUsers: targets.users });
        await ctx.answerCbQuery();
        await ctx.editMessageText(`<blockquote>Preview Broadcast</blockquote>\n${text}\n\nTarget: <b>${targets.users.length} user</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[Markup.button.callback('✅ Kirim Sekarang', `adm_bc_flash_send_${prod.id}`)], ...navButtons('adm_broadcast')] } });
    });

    bot.action(/^adm_bc_flash_send_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const state = adminStates.getFor(ctx);
        if (!state || state.action !== 'broadcast_flash_confirm' || state.productId !== ctx.match[1]) return ctx.answerCbQuery('Preview kedaluwarsa', { show_alert: true });
        const job = startBroadcastJob({ telegram: ctx.telegram, users: state.targetUsers, label: 'Flash Sale', send: (telegram, uid) => telegram.sendMessage(uid, state.text, { parse_mode: 'HTML' }) });
        adminStates.delete(ctx.from.id.toString());
        await ctx.answerCbQuery('Broadcast dimulai');
        await ctx.editMessageText(`📤 Broadcast Flash Sale dimulai.\n\nJob: ${job.id}\nTarget: ${job.total} user`, { reply_markup: { inline_keyboard: [[Markup.button.callback('⟲ Cek Progress', `adm_bc_job_${job.id}`)], ...navButtons('adm_broadcast')] } });
    });

    bot.action(/^adm_bc_job_(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const job = getBroadcastJob(ctx.match[1]);
        if (!job) return ctx.answerCbQuery('Job selesai/kedaluwarsa', { show_alert: true });
        await ctx.answerCbQuery();
        await ctx.editMessageText(`📊 *Progress Broadcast*\n\nStatus: ${job.status}\nProgress: ${job.processed}/${job.total}\n✅ Terkirim: ${job.sent}\n❌ Gagal: ${job.failed}`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[Markup.button.callback('⟲ Refresh', `adm_bc_job_${job.id}`)], ...navButtons('adm_broadcast')] } });
    });
}

// Helper: delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Non-blocking broadcast — runs in background
async function broadcastToUsers(ctx, userIds, label, adminStates) {
    const total = userIds.length;
    let sent = 0;
    let failed = 0;

    const photo = ctx.message.photo;
    const rawText = ctx.message.text || ctx.message.caption || '';
    const rawEntities = ctx.message.entities || ctx.message.caption_entities || [];

    const header = '📢 BROADCAST MESSAGE\n\n';
    const fullText = header + rawText;

    const shiftedEntities = rawEntities.map(e => ({
        ...e,
        offset: e.offset + header.length
    }));

    const headerEntities = [
        { type: 'bold', offset: 0, length: header.trim().length },
        ...shiftedEntities
    ];

    // Send initial progress message to admin
    const progressMsg = await ctx.reply(`📤 Broadcast dimulai...\n\n⏳ Progress: 0/${total}\n✅ Terkirim: 0\n❌ Gagal: 0`);
    adminStates.delete(ctx.from.id.toString());

    for (let i = 0; i < userIds.length; i++) {
        const userId = userIds[i];
        try {
            if (photo && photo.length > 0) {
                const fileId = photo[photo.length - 1].file_id;
                await ctx.telegram.sendPhoto(userId, fileId, {
                    caption: fullText || undefined,
                    caption_entities: headerEntities
                });
            } else {
                await ctx.telegram.sendMessage(userId, fullText, {
                    entities: headerEntities
                });
            }
            sent++;
        } catch (e) {
            failed++;
        }

        // Progress update tiap 100 user
        if ((i + 1) % 100 === 0 || i === userIds.length - 1) {
            try {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    progressMsg.message_id,
                    null,
                    `📤 Broadcast sedang berjalan...\n\n⏳ Progress: ${i + 1}/${total}\n✅ Terkirim: ${sent}\n❌ Gagal: ${failed}`
                );
            } catch (e) { }
        }

        // Delay 50ms antar pesan (20 msg/sec)
        if (i < userIds.length - 1) {
            await sleep(BROADCAST_DELAY_MS);
        }
    }

    // Final message
    try {
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            progressMsg.message_id,
            null,
            `✅ Broadcast selesai!\n\n📊 Total: ${total}${label}\n✅ Terkirim: ${sent}\n❌ Gagal: ${failed}`,
            { reply_markup: { inline_keyboard: navButtons('admin_home') } }
        );
    } catch (e) { }
}

async function handleBroadcast(ctx, adminStates) {
    const users = db.getUsers();
    const userIds = Object.keys(users);
    // Non-blocking: jalan di background
    broadcastToUsers(ctx, userIds, ` user`, adminStates);
}

async function handleBroadcastCategory(ctx, state, adminStates) {
    const targetUsers = state.targetUsers || [];
    // Non-blocking: jalan di background
    broadcastToUsers(ctx, targetUsers, `/${targetUsers.length} user di kategori ini`, adminStates);
}

module.exports = { registerBroadcastHandlers, handleBroadcast, handleBroadcastCategory };
