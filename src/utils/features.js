// Restart-bound feature flags sourced only from process.env.
// Intentionally not backed by DB/admin-web settings.
const isRentBotEnabled = () => String(process.env.RENT_BOT_ENABLED || '').trim().toLowerCase() === 'true';

module.exports = { isRentBotEnabled };
