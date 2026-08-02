/**
 * Admin — Broadcast System (Non-blocking)
 * Broadcast runs in background so bot stays responsive
 */
const { Markup } = require('telegraf');
const db = require('../models/db');
const { broadcastKeyboard, navButtons, cancelButton } = require('../utils/keyboard');

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
