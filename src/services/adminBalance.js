const db = require('../models/db');
const balance = require('../payments/balance');

const adjustUserBalance = ({ userId, action, amount, note, actorId = 'admin', channel = 'web' }) => {
    const user = db.getUser(String(userId));
    if (!user) throw Object.assign(new Error('User tidak ditemukan'), { status: 404 });
    const value = Number.parseInt(amount, 10);
    if (!Number.isInteger(value) || value < 0) throw Object.assign(new Error('Nominal tidak valid'), { status: 400 });
    const reason = String(note || '').trim();
    if (!reason) throw Object.assign(new Error('Catatan wajib diisi'), { status: 400 });
    if (!['add', 'deduct', 'set'].includes(action)) throw Object.assign(new Error('Action tidak valid'), { status: 400 });

    const auditNote = `[${channel}:${actorId}] ${reason}`;
    let result;
    if (action === 'add') result = balance.addBalance(String(userId), value, 'admin', auditNote);
    else if (action === 'deduct') {
        if (value > balance.getBalance(String(userId))) throw Object.assign(new Error('Saldo tidak cukup'), { status: 400 });
        result = balance.deductBalance(String(userId), value, '', auditNote);
    } else result = balance.setBalance(String(userId), value, auditNote);

    db.dbEvents.emit('balance_change', { userId: String(userId), action, balance: result.balance, channel });
    return result;
};

module.exports = { adjustUserBalance };
