const db = require('../models/db');
const gateway = require('../payments/gateway');
const { handlePaymentSuccess } = require('./delivery');
const { handleOrderExpired } = require('./reminder');
const log = require('../utils/logger');

const BASE_INTERVAL_MS = 20_000;
const START_DELAY_MS = 5_000;
const MAX_CONCURRENCY = 3;
const BATCH_LIMIT = 50;
const backoff = new Map();

let bot = null;
let timer = null;
let running = false;
let stopped = true;

const jitter = () => Math.floor(Math.random() * 6_001) - 3_000;
const schedule = (delay = BASE_INTERVAL_MS + jitter()) => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(runPollingCycle, Math.max(5_000, delay));
    timer.unref?.();
};

const recordFailure = (orderId) => {
    const prev = backoff.get(orderId) || { failures: 0, nextAt: 0 };
    const failures = Math.min(prev.failures + 1, 6);
    const delay = Math.min(BASE_INTERVAL_MS * (2 ** failures), 5 * 60_000);
    backoff.set(orderId, { failures, nextAt: Date.now() + delay + Math.max(0, jitter()) });
};

const shouldCheck = (orderId) => {
    const state = backoff.get(orderId);
    return !state || Date.now() >= state.nextAt;
};

const processOrder = async (snapshot) => {
    if (!shouldCheck(snapshot.id)) return;
    const current = db.getOrderById(snapshot.id);
    if (!current || current.status !== 'pending') {
        backoff.delete(snapshot.id);
        return;
    }
    if (current.expires_at && Date.now() >= new Date(current.expires_at).getTime()) {
        backoff.delete(current.id);
        await handleOrderExpired(current);
        return;
    }

    const result = await gateway.checkStatus(current.id, current.total_idr, current.gateway_id, { silent: true });
    if (!result.success) {
        recordFailure(current.id);
        log.warn(`[POLLING] provider-check failed order=${current.id} error=${result.error || 'unknown'}`);
        return;
    }

    backoff.delete(current.id);
    if (result.status === 'completed') {
        const delivered = await handlePaymentSuccess(bot, current.id, { method: 'polling' });
        if (delivered) log.info(`[POLLING] order=${current.id} status=paid action=delivered`);
    } else if (result.status === 'expired') {
        await handleOrderExpired(current);
    }
};

const runWithConcurrency = async (items, limit, worker) => {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const item = items[cursor++];
            try { await worker(item); }
            catch (error) {
                recordFailure(item.id);
                log.error(`[POLLING] order=${item.id} error=${error.message}`);
            }
        }
    });
    await Promise.all(runners);
};

async function runPollingCycle() {
    if (stopped) return;
    if (running) {
        schedule();
        return;
    }
    running = true;
    try {
        const orders = db.getPendingQRISOrders(BATCH_LIMIT);
        if (orders.length) await runWithConcurrency(orders, MAX_CONCURRENCY, processOrder);
    } catch (error) {
        log.error(`[POLLING] cycle error=${error.message}`);
    } finally {
        running = false;
        schedule();
    }
}

const initPaymentPolling = (botInstance) => {
    if (!botInstance || !stopped) return;
    bot = botInstance;
    const recovered = db.recoverPaymentClaims();
    if (recovered) log.warn(`[POLLING] recovered stale claims=${recovered}`);
    stopped = false;
    schedule(START_DELAY_MS);
    log.info(`[POLLING] initialized interval=${BASE_INTERVAL_MS / 1000}s concurrency=${MAX_CONCURRENCY}`);
};

const stopPaymentPolling = () => {
    stopped = true;
    clearTimeout(timer);
    timer = null;
};

module.exports = {
    initPaymentPolling,
    stopPaymentPolling,
    runPollingCycle,
    processOrder,
    constants: { BASE_INTERVAL_MS, MAX_CONCURRENCY, BATCH_LIMIT }
};
