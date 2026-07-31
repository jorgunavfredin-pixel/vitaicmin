const axios = require('axios');

// Cache exchange rate for 1 hour
let exchangeRateCache = {
    rate: 16000, // Default fallback rate
    lastFetch: 0
};
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Fetch current USD to IDR exchange rate with retry
 * @returns {Promise<number>} - Exchange rate
 */
const fetchExchangeRateNetwork = async () => {
    const now = Date.now();

    // Return cached rate if still valid
    if (now - exchangeRateCache.lastFetch < CACHE_DURATION) {
        return exchangeRateCache.rate;
    }

    // Retry helper
    const fetchWithRetry = async (url, retries = 2) => {
        for (let i = 0; i <= retries; i++) {
            try {
                const response = await axios.get(url, { timeout: 5000 });
                if (response.data?.rates?.IDR) return response.data.rates.IDR;
            } catch (error) {
                if (i < retries) {
                    await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
                } else {
                    throw error;
                }
            }
        }
    };

    try {
        // Primary API with retry
        const rate = await fetchWithRetry('https://api.exchangerate-api.com/v4/latest/USD');
        if (rate) {
            exchangeRateCache = { rate, lastFetch: now };
            console.log(`Exchange rate updated: 1 USD = ${rate} IDR`);
            return rate;
        }
    } catch (error) {
        console.error('Primary exchange rate API error:', error.message);

        // Fallback API (single attempt)
        try {
            const fallbackResponse = await axios.get(
                'https://open.er-api.com/v6/latest/USD',
                { timeout: 5000 }
            );

            if (fallbackResponse.data?.rates?.IDR) {
                const rate = fallbackResponse.data.rates.IDR;
                exchangeRateCache = { rate, lastFetch: now };
                console.log(`Exchange rate updated (fallback): 1 USD = ${rate} IDR`);
                return rate;
            }
        } catch (fallbackError) {
            console.error('Fallback exchange rate API error:', fallbackError.message);
        }
    }

    // Return cached or default rate on all failures
    console.log(`Using cached/default rate: 1 USD = ${exchangeRateCache.rate} IDR`);
    return exchangeRateCache.rate;
};
// Concurrent checkout renders share one in-flight network request. Without this,
// rapid quantity taps before the cache is warm can trigger several 5s API calls.
let exchangeRateInFlight = null;
const fetchExchangeRate = async () => {
    const now = Date.now();
    if (now - exchangeRateCache.lastFetch < CACHE_DURATION) return exchangeRateCache.rate;
    if (!exchangeRateInFlight) {
        exchangeRateInFlight = fetchExchangeRateNetwork()
            .catch(() => exchangeRateCache.rate)
            .finally(() => { exchangeRateInFlight = null; });
    }
    // Stale-while-revalidate: checkout never waits for an external rate API.
    return exchangeRateCache.rate;
};
/**
 * Convert IDR to USD
 * @param {number} amountIDR - Amount in IDR
 * @returns {Promise<number>} - Amount in USD
 */
const convertIDRtoUSD = async (amountIDR) => {
    const rate = await fetchExchangeRate();
    return amountIDR / rate;
};
/**
 * Convert USD to IDR
 * @param {number} amountUSD - Amount in USD
 * @returns {Promise<number>} - Amount in IDR
 */
const convertUSDtoIDR = async (amountUSD) => {
    const rate = await fetchExchangeRate();
    return amountUSD * rate;
};
/**
 * Get current exchange rate
 * @returns {Promise<number>} - Current rate
 */
const getExchangeRate = async () => {
    return await fetchExchangeRate();
};
/**
 * Format price for display
 * @param {number} amountIDR - Amount in IDR
 * @param {string} lang - Language code
 * @returns {Promise<string>} - Formatted price string
 */
const formatPrice = async (amountIDR, lang = 'id') => {
    if (lang === 'en') {
        const amountUSD = await convertIDRtoUSD(amountIDR);
        return `$${amountUSD.toFixed(2)}`;
    }
    return `Rp ${new Intl.NumberFormat('id-ID').format(amountIDR)}`;
};
module.exports = {
    fetchExchangeRate,
    convertIDRtoUSD,
    convertUSDtoIDR,
    getExchangeRate,
    formatPrice
};