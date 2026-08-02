const ADMIN_STATE_TTL_MS = 10 * 60 * 1000;

class AdminStateManager {
    constructor(ttlMs = ADMIN_STATE_TTL_MS) {
        this.ttlMs = ttlMs;
        this.states = new Map();
    }

    setFor(ctx, state) {
        const adminId = String(ctx.from.id);
        this.states.set(adminId, {
            ...state,
            _adminId: adminId,
            _chatId: String(ctx.chat?.id ?? ''),
            _expiresAt: Date.now() + this.ttlMs
        });
        return state;
    }

    getFor(ctx) {
        const adminId = String(ctx.from.id);
        const state = this.states.get(adminId);
        if (!state) return null;
        const sameChat = state._chatId === String(ctx.chat?.id ?? '');
        if (!sameChat || state._expiresAt <= Date.now()) {
            this.states.delete(adminId);
            return null;
        }
        return state;
    }

    delete(adminId) { return this.states.delete(String(adminId)); }
    clearFor(ctx) { return this.delete(ctx.from.id); }
    has(adminId) { return this.states.has(String(adminId)); }
}

module.exports = { AdminStateManager, ADMIN_STATE_TTL_MS };
