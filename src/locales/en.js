module.exports = {
    // General
    welcome: `🛒 *Welcome to ${process.env.STORE_NAME || 'Store'}!*

We provide premium accounts with affordable prices.

Select a menu below to continue:`,

    select_language: '🌐 Pilih bahasa / Select language:',
    language_set: '✅ Language has been set to English',

    // Menu
    menu_categories: '📦 Product Categories',
    menu_history: '📜 Transaction History',
    menu_support: '💬 Contact Support',
    menu_language: '🌐 Change Language',
    menu_back: '‹ Back',
    menu_home: '🏠 Main Menu',
    menu_cancel: '❌ Cancel',

    // Categories & Products
    select_category: '📦 *Select Category:*',
    select_product: '🛍️ *Select Product:*',
    select_quantity: '🔢 *Select quantity to buy:*',
    no_categories: '😔 No product categories available.',
    no_products: '😔 No products in this category.',
    out_of_stock: '❌ Out of stock',
    stock_available: '✅ Stock: {count}',

    // Product Details
    product_details: `📦 *{name}*

📝 *Description:*
{description}

💰 *Price:* ${'{price}'} USD
📦 *Stock:* {stock}
🛡️ *Warranty:* {warranty}

📋 *Terms & Conditions:*
{terms}`,

    // Order
    confirm_order: `🛒 *Order Confirmation*

📦 Product: *{product}*
🔢 Quantity: *{quantity}*
💰 Total: *${'{total_usd}'} USD*

Select payment method:`,

    select_payment: '▣ *Select Payment Method:*',
    payment_qris: '▣ QRIS (Indonesian E-Wallet)',
    payment_saldo: '● Balance',

    // QRIS Payment
    qris_instruction: `📱 *QRIS Payment*

📦 Order: \`{order_id}\`
💰 Total: *Rp {amount}*

Scan the QR code below to pay:

⏰ Time limit: *15 minutes*
⚠️ Payment will be verified automatically`,

    // Balance
    saldo_menu: '💰 *Your Balance:* ${balance} USD',
    saldo_topup_title: '📥 *Top Up Balance*\n\nSelect amount:',
    saldo_insufficient: '❌ Insufficient balance! Your balance: ${balance} USD. Please top up first.',
    saldo_topup_success: '✅ *Top Up Successful!*\n\n💰 +${amount} USD\n💵 New balance: ${balance} USD',

    // Payment Status
    payment_pending: '⏳ Waiting for payment...',
    payment_reminder: `⚠️ *Payment Reminder*

Order \`{order_id}\` is not paid yet.
Time remaining: *{time_left}*

Please complete the payment or the order will be cancelled.`,

    payment_success: `✅ *PAYMENT SUCCESSFUL*

Order \`{order_id}\` has been paid.
Your premium account will be sent shortly...`,

    payment_cancelled: `❌ *Order Cancelled*

Order \`{order_id}\` has been cancelled due to no payment.`,

    payment_expired: `⏰ *Order Expired*

Order \`{order_id}\` has expired automatically.
Please create a new order if you still want to purchase.`,



    // History
    history_title: '📜 *Transaction History*\n\n',
    history_empty: '📭 No transactions yet.',
    history_item: `📦 \`{order_id}\`
🛍️ {product} x{quantity}
💰 ${'{amount}'} USD
📅 {date}
📊 Status: {status}
───────────────`,

    status_pending: '⏳ Waiting for Payment',
    status_paid: '✅ Paid',
    status_delivered: '📦 Delivered',
    status_cancelled: '❌ Cancelled',
    status_expired: '⏰ Expired',



    // Errors
    error_general: '❌ An error occurred. Please try again.',
    error_no_stock: '❌ Sorry, not enough stock available.',
    error_order_not_found: '❌ Order not found.',

    // Admin
    admin_notif_new_order: `🆕 *New Order!*

📦 ID: \`{order_id}\`
👤 User: {user_id}
🛍️ Product: {product}
🔢 Quantity: {quantity}
💰 Total: Rp {amount}
💳 Method: {method}`,

    admin_notif_paid: `💰 *Payment Received!*

📦 ID: \`{order_id}\`
👤 User: {user_id}
🛍️ Product: {product}
💰 Total: Rp {amount}`,

    admin_notif_delivered: `📦 *Account Delivered!*

📦 Order: \`{order_id}\`
👤 User: {user_id}
🛍️ Product: {product}

📋 Accounts sent:
{accounts}`
};
