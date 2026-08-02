/**
 * Admin — Settings & Backup
 * Extracted from panel.js
 */
const fs = require('fs');
const path = require('path');
const db = require('../models/db');
const { getWIBToday } = require('../utils/helpers');
const { settingsKeyboard, navButtons } = require('../utils/keyboard');

function registerSettingsHandlers(bot, { isAdmin }) {

    // ==================== SETTINGS ====================

    bot.action('adm_settings', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();

        const s = db.getSettings();
        const mStatus = s.maintenance ? '🔴 ON' : '🟢 OFF';
        const qStatus = s.qris_enabled ? '✅ Active' : '❌ OFF';
        const sStatus = s.saldo_enabled !== false ? '✅ Active' : '❌ OFF';

        await ctx.editMessageText(`⚙️ *Settings*\n\n🛠 Maintenance Mode: ${mStatus}\n📱 QRIS Payment: ${qStatus}\n💰 Saldo Payment: ${sStatus}\n\nKlik tombol untuk toggle on/off:`, {
            parse_mode: 'Markdown',
            ...settingsKeyboard()
        });
    });

    const refreshSettings = async (ctx) => {
        const updated = db.getSettings();
        const mStatus = updated.maintenance ? '🔴 ON' : '🟢 OFF';
        const qStatus = updated.qris_enabled ? '✅ Active' : '❌ OFF';
        const sStatus = updated.saldo_enabled !== false ? '✅ Active' : '❌ OFF';

        await ctx.editMessageText(`⚙️ *Settings*\n\n🛠 Maintenance Mode: ${mStatus}\n📱 QRIS Payment: ${qStatus}\n💰 Saldo Payment: ${sStatus}\n\nKlik tombol untuk toggle on/off:`, {
            parse_mode: 'Markdown',
            ...settingsKeyboard()
        });
    };

    bot.action('adm_set_maintenance', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const s = db.getSettings();
        const newVal = !s.maintenance;
        db.updateSettings({ maintenance: newVal });
        await ctx.answerCbQuery(`Maintenance Mode: ${newVal ? 'ON 🔴' : 'OFF 🟢'}`, { show_alert: true });
        await refreshSettings(ctx);
    });

    bot.action('adm_set_qris', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const s = db.getSettings();
        const newVal = !s.qris_enabled;
        db.updateSettings({ qris_enabled: newVal });
        await ctx.answerCbQuery(`QRIS: ${newVal ? 'Active ✅' : 'OFF ❌'}`, { show_alert: true });
        await refreshSettings(ctx);
    });

    bot.action('adm_set_saldo', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const s = db.getSettings();
        const newVal = s.saldo_enabled === false ? true : false;
        db.updateSettings({ saldo_enabled: newVal });
        await ctx.answerCbQuery(`Saldo: ${newVal ? 'Active ✅' : 'OFF ❌'}`, { show_alert: true });
        await refreshSettings(ctx);
    });

    // ==================== BACKUP ====================

    bot.action('adm_backup', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery('⏳ Membuat backup...');

        try {
            const dbDir = path.join(__dirname, '..', 'database');
            const timestamp = getWIBToday();
            const backupName = `backup_${timestamp}.db`;
            const backupPath = path.join(dbDir, `chatbackup_${Date.now()}.db`);

            // Gunakan SQLite online backup yang sama dengan admin web agar snapshot
            // konsisten tanpa checkpoint/TRUNCATE pada database yang sedang aktif.
            await db.backupDatabase(backupPath);
            try {
                await ctx.replyWithDocument(
                    { source: backupPath, filename: backupName },
                    { caption: `💾 *Database Backup*\n📅 ${timestamp}\n📦 SQLite snapshot`, parse_mode: 'Markdown' }
                );
            } finally {
                try { if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath); } catch (e) { /* ignore */ }
            }

        } catch (error) {
            console.error('Backup error:', error);
            await ctx.reply('❌ Gagal membuat backup: ' + error.message);
        }
    });
}

module.exports = { registerSettingsHandlers };
