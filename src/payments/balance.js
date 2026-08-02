/**
 * Balance Module — uses shared DB connection from db.js
 * No separate SQLite connection needed.
 */
const path = require('path');
const fs = require('fs');
const db = require('../models/db')._db;

// ==================== JSON → SQLite MIGRATION ====================
const migrateBalancesFromJSON = () => {
    const jsonFile = path.join(__dirname, '../database/balances.json');
    if (!fs.existsSync(jsonFile)) return;

    const count = db.prepare('SELECT COUNT(*) as cnt FROM balances').get();
    if (count.cnt > 0) return; // Already migrated

    try {
        const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
        if (!data || typeof data !== 'object') return;

        console.log('[DB] Migrating balances from JSON to SQLite...');

        const insertBal = db.prepare('INSERT OR IGNORE INTO balances (user_id, balance) VALUES (?, ?)');
        const insertHist = db.prepare('INSERT OR IGNORE INTO balance_history (id, user_id, type, amount, method, order_id, note, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');

        const migrate = db.transaction(() => {
            let userCount = 0;
            let histCount = 0;
            for (const [userId, userData] of Object.entries(data)) {
                insertBal.run(userId, userData.balance || 0);
                userCount++;
                if (userData.history && Array.isArray(userData.history)) {
                    userData.history.forEach(h => {
                        insertHist.run(h.id, userId, h.type, h.amount, h.method || null, h.order_id || null, h.note || '', h.balance_after || 0, h.created_at);
                        histCount++;
                    });
                }
            }
            console.log(`  ✓ ${userCount} user balances, ${histCount} history entries`);
        });

        migrate();
        console.log('[DB] Balance migration complete!');
    } catch (e) {
        console.error('[DB] Balance migration error:', e.message);
    }
};

migrateBalancesFromJSON();

// ==================== BALANCE OPERATIONS ====================

const newBalanceHistoryId = () => `bal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Get user balance
 * @param {string} userId
 * @returns {number} Balance in IDR
 */
const getBalance = (userId) => {
    const row = db.prepare('SELECT balance FROM balances WHERE user_id = ?').get(userId);
    return row ? row.balance : 0;
};

/**
 * Get user balance data (balance + history)
 * @param {string} userId
 * @returns {Object} { balance, history }
 */
const getBalanceData = (userId) => {
    const balance = getBalance(userId);
    const history = db.prepare('SELECT * FROM balance_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(userId);
    return { balance, history };
};

/**
 * Add balance (topup)
 */
const addBalance = (userId, amount, method = 'qris', note = '', orderId = null) => {
    const addBal = db.transaction(() => {
        // Ensure user row exists
        db.prepare('INSERT OR IGNORE INTO balances (user_id, balance) VALUES (?, 0)').run(userId);
        db.prepare('UPDATE balances SET balance = balance + ? WHERE user_id = ?').run(amount, userId);

        const newBalance = getBalance(userId);
        const id = newBalanceHistoryId();
        db.prepare('INSERT INTO balance_history (id, user_id, type, amount, method, order_id, note, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, userId, 'topup', amount, method, orderId, note || `Topup via ${method.toUpperCase()}`, newBalance, new Date().toISOString());

        return { balance: newBalance, history: getBalanceData(userId).history };
    });
    return addBal();
};

/**
 * Deduct balance (purchase)
 */
const deductBalance = (userId, amount, orderId = '', note = '') => {
    const current = getBalance(userId);
    if (current < amount) return null; // Insufficient

    const deduct = db.transaction(() => {
        db.prepare('UPDATE balances SET balance = balance - ? WHERE user_id = ?').run(amount, userId);
        const newBalance = getBalance(userId);
        const id = newBalanceHistoryId();
        db.prepare('INSERT INTO balance_history (id, user_id, type, amount, method, order_id, note, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, userId, 'deduct', -amount, null, orderId, note || `Pembelian #${orderId}`, newBalance, new Date().toISOString());

        return { balance: newBalance, history: getBalanceData(userId).history };
    });
    return deduct();
};

/**
 * Set balance to specific amount (admin override)
 */
const setBalance = (userId, newBalance, note = 'Admin adjustment') => {
    const setBal = db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO balances (user_id, balance) VALUES (?, 0)').run(userId);
        const oldBalance = getBalance(userId);
        const diff = newBalance - oldBalance;
        db.prepare('UPDATE balances SET balance = ? WHERE user_id = ?').run(newBalance, userId);

        const id = newBalanceHistoryId();
        db.prepare('INSERT INTO balance_history (id, user_id, type, amount, method, order_id, note, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, userId, diff >= 0 ? 'admin_add' : 'admin_deduct', diff, 'admin', null, note, newBalance, new Date().toISOString());

        return { balance: newBalance, history: getBalanceData(userId).history };
    });
    return setBal();
};

/**
 * Get balance history for a user
 */
const getBalanceHistory = (userId, limit = 10) => {
    return db.prepare('SELECT * FROM balance_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit);
};

/**
 * Get total balance across all users
 */
const getTotalBalance = () => {
    const row = db.prepare('SELECT SUM(balance) as totalBalance, COUNT(*) as userCount FROM balances WHERE balance > 0').get();
    return { totalBalance: row.totalBalance || 0, userCount: row.userCount || 0 };
};

/**
 * Get all users with balance > 0
 */
const getAllBalances = () => {
    return db.prepare('SELECT user_id as userId, balance FROM balances WHERE balance > 0 ORDER BY balance DESC').all();
};

module.exports = {
    getBalance,
    getBalanceData,
    addBalance,
    deductBalance,
    setBalance,
    getBalanceHistory,
    getTotalBalance,
    getAllBalances
};
