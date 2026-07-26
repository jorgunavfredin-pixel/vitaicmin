# Setup Guide — Bot Auto Order Telegram

## 1. Install Node.js
Download & install dari https://nodejs.org (versi LTS v18+)

## 2. Extract & Setup
```bash
# Extract zip ini ke folder
# Masuk ke folder
cd BOT-ORDER

# Rename .env.example jadi .env
rename .env.example .env

# Edit .env — isi semua data kamu
notepad .env
```

## 3. Konfigurasi .env
Isi semua field di `.env`:
- `BOT_TOKEN` — Buat bot di @BotFather, copy tokennya
- `ADMIN_ID` — Chat @userinfobot utk tau Telegram ID kamu (bisa multi-admin: `123,456`)
- `WEBHOOK_URL` — http://IP_SERVER_KAMU:3000
- `PAKASIR_API_KEY` & `PAKASIR_SLUG` — Daftar di PaKasir.com
- `STORE_NAME` — Nama toko kamu
- `SUPPORT_USERNAME` — Username Telegram kamu (tanpa @)
- `ORDER_PREFIX` — Prefix order ID (misal: ABC → ABC-20260211-0001)
- `SUPPORT_HOURS` — Jam operasional support
- `THEME_PRESET` — Tema QRIS: `gold`, `purple`, `blue`, `green`, `red`, `cyan`, `orange`, `white`, `pink`, `lime`
- `THEME_COLOR` / `THEME_BG` — (Opsional) Custom warna hex, override preset. **WAJIB pakai tanda kutip**: `"#C9A44A"`

## 4. Ganti Banner
Ganti file `assets/banner.png` dengan banner toko kamu.
**Nama file HARUS tetap `banner.png`**, maksimum 2MB.

## 5. Install Dependencies
```bash
npm install
```

## 6. Test Run
```bash
npm start
```
Kalau berhasil akan muncul: "✅ [NamaToko] is running!"

## 7. Production (PM2)
```bash
npm install -g pm2
pm2 start src/index.js --name "bot-order"
pm2 startup
pm2 save
```

## 8. Webhook QRIS
Di panel PaKasir, set callback URL: `http://IP_SERVER:3000/webhook/qris`

## Fitur Bot
- 🛍️ Auto order dengan pilihan kategori & produk
- 💳 Pembayaran QRIS via PaKasir
- 💰 Sistem saldo (topup via QRIS, bayar dari saldo)
- 🎟️ Sistem voucher (persen & nominal)
- 🌐 Bilingual (Indonesia & English)
- ⏰ Reminder pembayaran otomatis
- 📊 Dashboard admin lengkap
- 👥 Multi-admin support
- 📤 Export data CSV
- 🔄 Auto purge data lama

## Troubleshooting
- Port sudah dipakai? → Kill: `npx kill-port 3000`
- Bot error? → Cek log: `pm2 logs bot-order`
- Restart: `pm2 restart bot-order`
