const { Markup } = require('telegraf');
const db = require('../models/db');
const { formatIDR } = require('../utils/helpers');

// Helper to format large numbers (e.g. 1.2M, 100K) if needed, 
// but user requested exact IDR which formatIDR handles.

const statsKeyboard = () => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('📅 Income Stats', 'adm_stats_income')],
        [Markup.button.callback('👥 User Stats', 'adm_stats_users')],
        [Markup.button.callback('📉 Transaction Stats', 'adm_stats_tx')],
        [Markup.button.callback('⬅️ Back to Admin', 'admin_home')]
    ]);
};

const backToStatsKeyboard = () => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Back to Stats', 'adm_stats_menu')]
    ]);
};

// Main Stats Menu
const showStatsMenu = async (ctx) => {
    const text = `📊 *Pusat Statistik & Monitoring*
    
Pilih kategori statistik yang ingin dilihat:
💰 *Income*: Laporan omzet harian/mingguan/bulanan.
👥 *Users*: Top sultan dan pertumbuhan user.
📉 *Transaksi*: Rate sukses dan total order.`;

    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...statsKeyboard()
    });
};

// Income Stats
const showIncomeStats = async (ctx) => {
    const stats = db.getDetailedStats();
    const inc = stats.income;

    const text = `💰 *Laporan Pendapatan (Income)*
    
📆 *HARI INI*
Total: Rp ${formatIDR(inc.today.total)}
• QRIS: Rp ${formatIDR(inc.today.qris)}
• Saldo: Rp ${formatIDR(inc.today.saldo)}

🗓 *MINGGU INI*
Total: Rp ${formatIDR(inc.week.total)}
• QRIS: Rp ${formatIDR(inc.week.qris)}
• Saldo: Rp ${formatIDR(inc.week.saldo)}

📅 *BULAN INI*
Total: Rp ${formatIDR(inc.month.total)}
• QRIS: Rp ${formatIDR(inc.month.qris)}
• Saldo: Rp ${formatIDR(inc.month.saldo)}

💎 *ALL TIME*
Total: Rp ${formatIDR(inc.all_time.total)}`;

    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...backToStatsKeyboard()
    });
};

// User Stats (Top Spenders)
const showUserStats = async (ctx) => {
    const allUsers = db.getUsers();
    const totalUsers = Object.keys(allUsers).length;
    // New users today? We need created_at in users.json (supported in db.js)
    // We can filter db.getUsers()

    // Top Spenders
    const sultans = db.getTopSpenders(10);

    let sultanList = '';
    sultans.forEach((u, index) => {
        const name = u.first_name ? u.first_name : (u.username ? '@' + u.username : 'User ' + u.user_id);
        // Escape markdown chars for name if needed, but simple valid markdown usually ok.
        // Better to strip special chars or use simple format
        const cleanName = name.replace(/[*_`\[\]]/g, '');
        sultanList += `${index + 1}. *${cleanName}*: Rp ${formatIDR(u.total_spend)} (${u.total_tx} tx)\n`;
    });

    const text = `👥 *User Monitoring*
    
📈 Total User: ${totalUsers}

👑 *TOP 10 SULTAN (Spenders)*
${sultanList || '_Belum ada data sultan_'}
`;

    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...backToStatsKeyboard()
    });
};

// Transaction Stats
const showTxStats = async (ctx) => {
    const stats = db.getDetailedStats();
    const tx = stats.transactions;

    const text = `📉 *Statistik Transaksi (Global)*
    
📦 *Total Order:* ${tx.total}

✅ *Sukses:* ${tx.success}
⏳ *Pending:* ${tx.pending}
❌ *Gagal/Expired:* ${tx.failed}

📊 *Success Rate:* ${tx.success_rate}%`;

    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...backToStatsKeyboard()
    });
};
const handleStatsAction = async (ctx, action) => {
    switch (action) {
        case 'income': return showIncomeStats(ctx);
        case 'users': return showUserStats(ctx);
        case 'tx': return showTxStats(ctx);
        case 'menu': return showStatsMenu(ctx);
    }
};

module.exports = {
    showStatsMenu,
    showIncomeStats,
    showUserStats,
    showTxStats,
    handleStatsAction
};
