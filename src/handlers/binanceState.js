/**
 * Shared state untuk Binance Pay Transaction ID input, dipakai oleh:
 * - order.js (checkout produk dengan Binance Pay)
 * - keyboard.js (top-up saldo dengan Binance Pay)
 * 
 * Modul terpisah untuk menghindari circular dependency antara order.js ↔ keyboard.js.
 */

const binanceTxidStates = new Map();

module.exports = { binanceTxidStates };
