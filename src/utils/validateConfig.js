/**
 * Config Validation — runs on startup
 * Validates all required .env variables before bot starts
 */

const validateConfig = () => {
    const errors = [];
    const warnings = [];

    // Required variables
    const required = [
        { key: 'BOT_TOKEN', label: 'Bot Token (dari @BotFather)' },
        { key: 'ADMIN_ID', label: 'Telegram Admin ID' },
        { key: 'PORT', label: 'Server Port' },
        { key: 'WEBHOOK_URL', label: 'Webhook URL' }
    ];

    required.forEach(({ key, label }) => {
        if (!process.env[key] || process.env[key].trim() === '') {
            errors.push(`  ❌ ${key} — ${label}`);
        }
    });

    // Validate ADMIN_ID is numeric
    if (process.env.ADMIN_ID) {
        const ids = process.env.ADMIN_ID.split(',').map(id => id.trim());
        ids.forEach(id => {
            if (!/^\d+$/.test(id)) {
                errors.push(`  ❌ ADMIN_ID "${id}" bukan angka valid`);
            }
        });
    }

    // Validate PORT is numeric
    if (process.env.PORT && !/^\d+$/.test(process.env.PORT)) {
        errors.push(`  ❌ PORT "${process.env.PORT}" harus angka (contoh: 3000)`);
    }

    // Optional but recommended
    const optional = [
        { key: 'PAKASIR_API_KEY', label: 'PaKasir API Key (untuk QRIS payment)' },
        { key: 'PAKASIR_SLUG', label: 'PaKasir Project Slug (untuk QRIS payment)' },
        { key: 'STORE_NAME', label: 'Nama toko (default: "Bot")' },
        { key: 'SUPPORT_USERNAME', label: 'Username support Telegram' },
        { key: 'ORDER_PREFIX', label: 'Prefix order ID (default: "ORD")' }
    ];

    optional.forEach(({ key, label }) => {
        if (!process.env[key] || process.env[key].trim() === '') {
            warnings.push(`  ⚠️  ${key} — ${label}`);
        }
    });

    // Validate THEME_PRESET if provided
    const validPresets = ['gold', 'purple', 'blue', 'green', 'red', 'cyan', 'orange', 'white', 'pink', 'lime'];
    const preset = (process.env.THEME_PRESET || '').toLowerCase().trim();
    if (preset && !validPresets.includes(preset)) {
        warnings.push(`  ⚠️  THEME_PRESET "${process.env.THEME_PRESET}" tidak dikenali. Pilihan: ${validPresets.join(', ')}`);
    }

    // Show results
    if (errors.length > 0) {
        console.error('\n╔══════════════════════════════════════╗');
        console.error('║     ❌ CONFIGURATION ERROR           ║');
        console.error('╚══════════════════════════════════════╝\n');
        console.error('Missing or invalid required config:\n');
        errors.forEach(e => console.error(e));
        console.error('\nPastikan file .env sudah diisi dengan benar.');
        console.error('Lihat .env.example untuk referensi.\n');
        process.exit(1);
    }

    if (warnings.length > 0) {
        console.warn('\n⚠️  Config warnings (optional tapi disarankan):');
        warnings.forEach(w => console.warn(w));
        console.warn('');
    }

    console.log('✅ Config validation passed');
};

validateConfig();

module.exports = { validateConfig };
