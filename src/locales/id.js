module.exports = {
    // General
    welcome: `🛒 *Selamat datang di ${process.env.STORE_NAME || 'Store'}!*

Kami menyediakan akun premium berkualitas dengan harga terjangkau.

Pilih menu di bawah untuk melanjutkan:`,

    select_language: '🌐 Pilih bahasa / Select language:',
    language_set: '✅ Bahasa berhasil diatur ke Bahasa Indonesia',

    // Menu
    menu_categories: '📦 Kategori Produk',
    menu_history: '📜 Riwayat Transaksi',
    menu_support: '💬 Hubungi Support',
    menu_language: '🌐 Ganti Bahasa',
    menu_back: '‹ Kembali',
    menu_home: '🏠 Menu Utama',
    menu_cancel: '❌ Batalkan',

    // Categories & Products
    select_category: '📦 *Pilih Kategori:*',
    select_product: '🛍️ *Pilih Produk:*',
    select_quantity: '🔢 *Pilih jumlah yang ingin dibeli:*',
    no_categories: '😔 Belum ada kategori produk.',
    no_products: '😔 Belum ada produk di kategori ini.',
    out_of_stock: '❌ Stok habis',
    stock_available: '✅ Stok: {count}',

    // Product Details
    product_details: `📦 *{name}*

📝 *Deskripsi:*
{description}

💰 *Harga:* Rp {price}
📦 *Stok:* {stock}
🛡️ *Garansi:* {warranty}

📋 *Syarat & Ketentuan:*
{terms}`,

    // Order
    confirm_order: `🛒 *Konfirmasi Pesanan*

📦 Produk: *{product}*
🔢 Jumlah: *{quantity}*
💰 Total: *Rp {total_idr}*

Pilih metode pembayaran:`,

    select_payment: '▣ *Pilih Metode Pembayaran:*',
    payment_qris: '▣ QRIS (Dana/OVO/GoPay/dll)',
    payment_saldo: '● Saldo',

    // QRIS Payment
    qris_instruction: `📱 *Pembayaran QRIS*

📦 Order: \`{order_id}\`
💰 Total: *Rp {amount}*

Scan QR code di bawah untuk membayar:

⏰ Batas waktu: *15 menit*
⚠️ Pembayaran akan otomatis diverifikasi`,

    // Saldo
    saldo_menu: '💰 *Saldo Kamu:* Rp {balance}',
    saldo_topup_title: '📥 *Topup Saldo*\n\nPilih nominal:',
    saldo_insufficient: '❌ Saldo tidak cukup! Saldo kamu: Rp {balance}. Silakan topup terlebih dahulu.',
    saldo_topup_success: '✅ *Topup Berhasil!*\n\n💰 +Rp {amount}\n💵 Saldo baru: Rp {balance}',

    // Payment Status
    payment_pending: '⏳ Menunggu pembayaran...',
    payment_reminder: `⚠️ *Pengingat Pembayaran*

Order \`{order_id}\` belum dibayar.
Sisa waktu: *{time_left}*

Segera selesaikan pembayaran atau order akan dibatalkan.`,

    payment_success: `✅ *PEMBAYARAN BERHASIL*

Order \`{order_id}\` telah dibayar.
Akun premium kamu akan segera dikirim...`,

    payment_cancelled: `❌ *Order Dibatalkan*

Order \`{order_id}\` telah dibatalkan karena tidak ada pembayaran.`,

    payment_expired: `⏰ *Order Kadaluarsa*

Order \`{order_id}\` telah kedaluwarsa secara otomatis.
Silakan buat order baru jika masih ingin membeli.`,



    // History
    history_title: '📜 *Riwayat Transaksi*\n\n',
    history_empty: '📭 Belum ada transaksi.',
    history_item: `📦 \`{order_id}\`
🛍️ {product} x{quantity}
💰 Rp {amount}
📅 {date}
📊 Status: {status}
───────────────`,

    status_pending: '⏳ Menunggu Pembayaran',
    status_paid: '✅ Dibayar',
    status_delivered: '📦 Terkirim',
    status_cancelled: '❌ Dibatalkan',
    status_expired: '⏰ Kadaluarsa',

    // Support
    support_message: `💬 *Customer Support*

Untuk bantuan, silakan hubungi admin langsung:

👤 @${process.env.SUPPORT_USERNAME || 'admin'}

Jam operasional: ${process.env.SUPPORT_HOURS || '09:00 - 22:00 WIB'}`,

    // Errors
    error_general: '❌ Terjadi kesalahan. Silakan coba lagi.',
    error_no_stock: '❌ Maaf, stok tidak mencukupi.',
    error_order_not_found: '❌ Order tidak ditemukan.',

    // Admin
    admin_notif_new_order: `📥 <b>ORDER MASUK!</b>
<blockquote>📦 <b>ID:</b> <code>{order_id}</code>
👤 <b>User:</b> {user_display}
🛍️ <b>Produk:</b> {product}
🔢 <b>Jumlah:</b> {quantity}
💰 <b>Total:</b> Rp {amount}
🕐 <b>Checkout:</b> {checkout_time}
💳 <b>Metode:</b> {method} (⏱ <i>Menunggu Pembayaran....</i>)</blockquote>`,

    admin_notif_paid: `💰 *Pembayaran Diterima!*

📦 ID: \`{order_id}\`
👤 User: {user_id}
🛍️ Produk: {product}
💰 Total: Rp {amount}`,

    admin_notif_delivered: `📦 *Akun Terkirim!*

📦 Order: \`{order_id}\`
👤 User: {user_id}
🛍️ Produk: {product}

📋 Akun yang dikirim:
{accounts}`
};
