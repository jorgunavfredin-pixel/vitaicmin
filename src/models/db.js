const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const dbEvents = new EventEmitter();


const dbDir = path.join(__dirname, '../database');
const dbFile = path.join(dbDir, 'store.db');

// Ensure database directory exists
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// Initialize SQLite database
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');  // Better concurrency
db.pragma('foreign_keys = ON');

// ==================== SCHEMA ====================
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name_id TEXT,
    name_en TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    category_id TEXT,
    name_id TEXT,
    name_en TEXT,
    description_id TEXT DEFAULT '',
    description_en TEXT DEFAULT '',
    price_idr INTEGER DEFAULT 0,
    warranty_id TEXT DEFAULT '',
    warranty_en TEXT DEFAULT '',
    terms_id TEXT DEFAULT '',
    terms_en TEXT DEFAULT '',
    stock_type TEXT DEFAULT 'email_pass',
    stock_mode TEXT DEFAULT 'limited',
    active INTEGER DEFAULT 1,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS stock (
    id TEXT PRIMARY KEY,
    product_id TEXT,
    data TEXT,
    sold INTEGER DEFAULT 0,
    sold_to TEXT,
    sold_at TEXT,
    order_id TEXT,
    added_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_stock_product ON stock(product_id);
  CREATE INDEX IF NOT EXISTS idx_stock_sold ON stock(sold);

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    product_id TEXT,
    quantity INTEGER DEFAULT 1,
    total_idr INTEGER DEFAULT 0,
    total_usd REAL DEFAULT 0,
    payment_method TEXT,
    unique_code INTEGER,
    status TEXT DEFAULT 'pending',
    stock_ids TEXT DEFAULT '[]',
    delivered_data TEXT DEFAULT '[]',
    payment_proof TEXT,
    reminder_sent INTEGER DEFAULT 0,
    message_id INTEGER,
    chat_id TEXT,
    reminder_message_id INTEGER,
    reminder_chat_id TEXT,
    delivery_message_id INTEGER,
    created_at TEXT,
    paid_at TEXT,
    delivered_at TEXT,
    expires_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
`);

// Migration: add delivery_message_id if missing (for existing databases)
try {
  db.prepare('SELECT delivery_message_id FROM orders LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE orders ADD COLUMN delivery_message_id INTEGER');
}

// Migration: add flash sale columns to products
try {
  db.prepare('SELECT flash_price FROM products LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE products ADD COLUMN flash_price INTEGER');
  db.exec('ALTER TABLE products ADD COLUMN flash_start TEXT');
  db.exec('ALTER TABLE products ADD COLUMN flash_end TEXT');
  console.log('[DB] Added flash sale columns to products table');
}

// Migration: add qty_discounts column to products
try {
  db.prepare('SELECT qty_discounts FROM products LIMIT 1').get();
} catch (e) {
  db.exec("ALTER TABLE products ADD COLUMN qty_discounts TEXT DEFAULT ''");
  console.log('[DB] Added qty_discounts column to products table');
}

// Migration: add terms_format column to products
try {
  db.prepare('SELECT terms_format FROM products LIMIT 1').get();
} catch (e) {
  db.exec("ALTER TABLE products ADD COLUMN terms_format TEXT DEFAULT ''");
  console.log('[DB] Added terms_format column to products table');
}

// Migration: add stock reservation columns
try {
  db.prepare('SELECT reserved_by FROM stock LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE stock ADD COLUMN reserved_by TEXT');
  db.exec('ALTER TABLE stock ADD COLUMN reserved_at TEXT');
  console.log('[DB] Added reservation columns to stock table');
}

// Migration: add voucher columns to orders (so applied voucher persists)
try {
  db.prepare('SELECT voucher_code FROM orders LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE orders ADD COLUMN voucher_code TEXT');
  db.exec('ALTER TABLE orders ADD COLUMN discount_amount INTEGER DEFAULT 0');
  db.exec('ALTER TABLE orders ADD COLUMN original_total_idr INTEGER');
  db.exec('ALTER TABLE orders ADD COLUMN original_total_usd REAL');
  console.log('[DB] Added voucher columns to orders table');
}

// Migration: add gateway_id to orders (Fase 4 — multi-gateway routing).
// Menyimpan gateway MANA yang dipakai membuat transaksi, supaya verifikasi/cek
// status/webhook memakai credential (api_key + slug) yang SAMA. Tanpa ini, routing
// multi-gateway bisa memverifikasi pakai gateway lain → slug mismatch → bayar nyangkut.
try {
  db.prepare('SELECT gateway_id FROM orders LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE orders ADD COLUMN gateway_id TEXT');
  console.log('[DB] Added gateway_id column to orders table');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    username TEXT,
    language TEXT DEFAULT 'id',
    banned INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS vouchers (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE,
    type TEXT,
    value REAL,
    used INTEGER DEFAULT 0,
    used_by TEXT,
    used_at TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS balances (
    user_id TEXT PRIMARY KEY,
    balance INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS balance_history (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    type TEXT,
    amount INTEGER,
    method TEXT,
    order_id TEXT,
    note TEXT,
    balance_after INTEGER,
    created_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_balhist_user ON balance_history(user_id);

  CREATE TABLE IF NOT EXISTS voucher_redemptions (
    id TEXT PRIMARY KEY,
    voucher_code TEXT,
    user_id TEXT,
    order_id TEXT,
    redeemed_at TEXT,
    UNIQUE(voucher_code, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_vred_user ON voucher_redemptions(user_id);

  CREATE TABLE IF NOT EXISTS payment_gateways (
    id TEXT PRIMARY KEY,
    provider TEXT,
    label TEXT,
    credentials TEXT,
    enabled INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    order_id TEXT,
    received_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_orders_pending_qris
    ON orders(status, payment_method, expires_at);
`);

// Migration: seed gateway dari .env kalau BELUM ada baris untuk provider itu (backward compatible).
// Ini memastikan sistem yang sudah jalan pakai env tetap bekerja setelah upgrade,
// TANPA menimpa data kalau admin sudah mengelola gateway dari panel. Idempoten:
// seed hanya kalau provider ybs belum punya baris sama sekali. Fase 5: dukung WijayaPay.
try {
  const now = new Date().toISOString();
  const hasProvider = (p) => db.prepare('SELECT COUNT(*) AS n FROM payment_gateways WHERE provider = ?').get(p).n > 0;
  const insertGw = db.prepare(`INSERT INTO payment_gateways (id, provider, label, credentials, enabled, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)`);

  if (!hasProvider('pakasir') && (process.env.PAKASIR_API_KEY || process.env.PAKASIR_SLUG)) {
    insertGw.run('pakasir-default', 'pakasir', 'PaKasir (dari .env)',
      JSON.stringify({ api_key: process.env.PAKASIR_API_KEY || '', slug: process.env.PAKASIR_SLUG || '' }),
      0, now, now);
    console.log('[DB] Seeded default PaKasir gateway from .env');
  }

  if (!hasProvider('wijayapay') && (process.env.WIJAYAPAY_CODE_MERCHANT || process.env.WIJAYAPAY_API_KEY)) {
    insertGw.run('wijayapay-default', 'wijayapay', 'WijayaPay (dari .env)',
      JSON.stringify({ code_merchant: process.env.WIJAYAPAY_CODE_MERCHANT || '', api_key: process.env.WIJAYAPAY_API_KEY || '' }),
      1, now, now);
    console.log('[DB] Seeded default WijayaPay gateway from .env');
  }
  if (!hasProvider('xoftware') && (process.env.XOWFTWARE_API_KEY || process.env.XOWFTWARE_MERCHANT_ID)) {
    insertGw.run('xoftware-default', 'xoftware', 'Xoftware Pay (dari .env)',
      JSON.stringify({
        api_key: process.env.XOWFTWARE_API_KEY || '',
        merchant_id: process.env.XOWFTWARE_MERCHANT_ID || '',
        webhook_secret: process.env.XOWFTWARE_WEBHOOK_SECRET || '',
        fee_direction: process.env.XOWFTWARE_FEE_DIRECTION === 'user' ? 'user' : 'merchant'
      }), 2, now, now);
    console.log('[DB] Seeded default Xoftware gateway from .env');
  }
} catch (e) {
  console.error('[DB] payment_gateways seed error:', e.message);
}

// ==================== JSON → SQLite MIGRATION ====================
const migrateFromJSON = () => {
  const jsonDir = path.join(__dirname, '../database');

  const readJSON = (filename) => {
    const filePath = path.join(jsonDir, filename);
    try {
      if (!fs.existsSync(filePath)) return null;
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (e) { return null; }
  };

  // Check if migration needed (if categories table empty AND json files exist)
  const count = db.prepare('SELECT COUNT(*) as cnt FROM categories').get();
  const catJson = readJSON('categories.json');
  if (count.cnt > 0 || !catJson) return; // Already migrated or no JSON

  console.log('[DB] Migrating from JSON to SQLite...');

  const insertCat = db.prepare('INSERT OR IGNORE INTO categories (id, name_id, name_en, created_at) VALUES (?, ?, ?, ?)');
  const insertProd = db.prepare('INSERT OR IGNORE INTO products (id, category_id, name_id, name_en, description_id, description_en, price_idr, warranty_id, warranty_en, terms_id, terms_en, stock_type, stock_mode, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertStock = db.prepare('INSERT OR IGNORE INTO stock (id, product_id, data, sold, sold_to, sold_at, order_id, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertOrder = db.prepare('INSERT OR IGNORE INTO orders (id, user_id, product_id, quantity, total_idr, total_usd, payment_method, unique_code, status, stock_ids, delivered_data, payment_proof, reminder_sent, message_id, chat_id, reminder_message_id, reminder_chat_id, created_at, paid_at, delivered_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertUser = db.prepare('INSERT OR IGNORE INTO users (id, first_name, last_name, username, language, banned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertVoucher = db.prepare('INSERT OR IGNORE INTO vouchers (id, code, type, value, used, used_by, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

  const migrate = db.transaction(() => {
    // Categories
    const cats = catJson || [];
    cats.forEach(c => insertCat.run(c.id, c.name_id, c.name_en, c.created_at));
    console.log(`  ✓ ${cats.length} categories`);

    // Products
    const prods = readJSON('products.json') || [];
    prods.forEach(p => insertProd.run(p.id, p.category_id, p.name_id, p.name_en, p.description_id || '', p.description_en || '', p.price_idr || 0, p.warranty_id || '', p.warranty_en || '', p.terms_id || '', p.terms_en || '', p.stock_type || 'email_pass', p.stock_mode || 'limited', p.active !== false ? 1 : 0, p.created_at));
    console.log(`  ✓ ${prods.length} products`);

    // Stock
    const stockData = readJSON('stock.json') || [];
    if (Array.isArray(stockData)) {
      stockData.forEach(s => insertStock.run(s.id, s.product_id, s.data, s.sold ? 1 : 0, s.sold_to || null, s.sold_at || null, s.order_id || null, s.added_at));
      console.log(`  ✓ ${stockData.length} stock items`);
    } else {
      // Old format: { product_id: [items] }
      let total = 0;
      for (const [prodId, items] of Object.entries(stockData)) {
        (items || []).forEach(s => {
          insertStock.run(s.id, prodId, s.data, s.sold ? 1 : 0, s.sold_to || null, s.sold_at || null, s.order_id || null, s.added_at);
          total++;
        });
      }
      console.log(`  ✓ ${total} stock items`);
    }

    // Orders
    const orders = readJSON('orders.json') || [];
    orders.forEach(o => insertOrder.run(o.id, o.user_id, o.product_id, o.quantity || 1, o.total_idr || 0, o.total_usd || 0, o.payment_method, o.unique_code || null, o.status, JSON.stringify(o.stock_ids || []), JSON.stringify(o.delivered_data || []), o.payment_proof || null, o.reminder_sent ? 1 : 0, o.message_id || null, o.chat_id || null, o.reminder_message_id || null, o.reminder_chat_id || null, o.created_at, o.paid_at || null, o.delivered_at || null, o.expires_at || null));
    console.log(`  ✓ ${orders.length} orders`);

    // Users
    const users = readJSON('users.json') || {};
    let userCount = 0;
    for (const [uid, u] of Object.entries(users)) {
      insertUser.run(uid, u.first_name || null, u.last_name || null, u.username || null, u.language || 'id', u.banned ? 1 : 0, u.created_at || null, u.updated_at || null);
      userCount++;
    }
    console.log(`  ✓ ${userCount} users`);

    // Vouchers
    const vouchers = readJSON('vouchers.json') || [];
    if (Array.isArray(vouchers)) {
      vouchers.forEach(v => insertVoucher.run(v.id, v.code, v.type, v.value, v.used ? 1 : 0, v.used_by || null, v.used_at || null, v.created_at));
      console.log(`  ✓ ${vouchers.length} vouchers`);
    }

    // Settings
    const settings = readJSON('settings.json');
    if (settings && !Array.isArray(settings)) {
      for (const [key, val] of Object.entries(settings)) {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(val));
      }
      console.log(`  ✓ settings migrated`);
    }
  });

  migrate();
  console.log('[DB] Migration complete!');
};

migrateFromJSON();

// ==================== CATEGORIES ====================
const getCategories = () => {
  return db.prepare('SELECT * FROM categories').all();
};

const addCategory = (category) => {
  const id = `cat_${Date.now()}`;
  const created_at = new Date().toISOString();
  db.prepare('INSERT INTO categories (id, name_id, name_en, created_at) VALUES (?, ?, ?, ?)').run(id, category.name_id, category.name_en, created_at);
  return { id, name_id: category.name_id, name_en: category.name_en, created_at };
};

const updateCategory = (categoryId, updates) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!cat) return null;
  const updated = { ...cat, ...updates };
  db.prepare('UPDATE categories SET name_id = ?, name_en = ? WHERE id = ?').run(updated.name_id, updated.name_en, categoryId);
  return updated;
};

const deleteCategory = (categoryId) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
  db.prepare('DELETE FROM products WHERE category_id = ?').run(categoryId);
  return true;
};

// ==================== PRODUCTS ====================
const getProducts = () => {
  return db.prepare('SELECT * FROM products').all().map(p => ({ ...p, active: p.active === 1 }));
};

const getProductsByCategory = (categoryId) => {
  return db.prepare('SELECT * FROM products WHERE category_id = ?').all(categoryId).map(p => ({ ...p, active: p.active === 1 }));
};

const getProductById = (productId) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  return p ? { ...p, active: p.active === 1 } : null;
};

const addProduct = (product) => {
  const id = `prod_${Date.now()}`;
  const created_at = new Date().toISOString();
  db.prepare(`INSERT INTO products (id, category_id, name_id, name_en, description_id, description_en, price_idr, warranty_id, warranty_en, terms_id, terms_en, stock_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, product.category_id, product.name_id, product.name_en, product.description_id || '', product.description_en || '', product.price_idr, product.warranty_id || '', product.warranty_en || '', product.terms_id || '', product.terms_en || '', product.stock_type || 'email_pass', created_at);
  return { id, ...product, created_at };
};

const updateProduct = (productId, updates) => {
  const prod = getProductById(productId);
  if (!prod) return null;
  const merged = { ...prod, ...updates };
  db.prepare(`UPDATE products SET category_id=?, name_id=?, name_en=?, description_id=?, description_en=?, price_idr=?, warranty_id=?, warranty_en=?, terms_id=?, terms_en=?, stock_type=?, stock_mode=?, terms_format=?, qty_discounts=?, active=? WHERE id=?`).run(merged.category_id, merged.name_id, merged.name_en, merged.description_id, merged.description_en, merged.price_idr, merged.warranty_id, merged.warranty_en, merged.terms_id, merged.terms_en, merged.stock_type, merged.stock_mode || 'limited', merged.terms_format || '', merged.qty_discounts || '', merged.active === false ? 0 : 1, productId);
  return merged;
};

const deleteProduct = (productId) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(productId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(productId);
  return true;
};

// ==================== STOCK ====================
const getStock = () => {
  return db.prepare('SELECT * FROM stock').all().map(s => ({ ...s, sold: s.sold === 1 }));
};

const getStockByProduct = (productId) => {
  return db.prepare('SELECT * FROM stock WHERE product_id = ? AND sold = 0').all(productId);
};

const getAvailableStockCount = (productId) => {
  const r = db.prepare('SELECT COUNT(*) as cnt FROM stock WHERE product_id = ? AND sold = 0 AND reserved_by IS NULL').get(productId);
  return r.cnt;
};

// Deliverable stock for fallback path (saldo/unlimited): unsold AND not reserved by any pending order
const getUnsoldUnreservedStock = (productId) => {
  return db.prepare('SELECT * FROM stock WHERE product_id = ? AND sold = 0 AND reserved_by IS NULL').all(productId);
};

const reserveStock = (productId, quantity, orderId) => {
  const available = db.prepare('SELECT id FROM stock WHERE product_id = ? AND sold = 0 AND reserved_by IS NULL LIMIT ?').all(productId, quantity);
  if (available.length < quantity) {
    console.log(`[STOCK] Reserve failed for order ${orderId} — need ${quantity}, available ${available.length}`);
    return null;
  }
  const update = db.prepare('UPDATE stock SET reserved_by = ?, reserved_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  const batch = db.transaction(() => {
    available.forEach(s => update.run(orderId, now, s.id));
  });
  batch();
  console.log(`[STOCK] Reserved ${quantity} item(s) for order ${orderId}`);
  return available.map(s => s.id);
};

const releaseReservedStock = (orderId) => {
  const result = db.prepare('UPDATE stock SET reserved_by = NULL, reserved_at = NULL WHERE reserved_by = ? AND sold = 0').run(orderId);
  if (result.changes > 0) console.log(`[STOCK] Released ${result.changes} reserved item(s) for order ${orderId}`);
};

const getReservedStock = (orderId) => {
  return db.prepare('SELECT * FROM stock WHERE reserved_by = ? AND sold = 0').all(orderId);
};

const addStock = (productId, stockData) => {
  const id = `stk_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  const added_at = new Date().toISOString();
  db.prepare('INSERT INTO stock (id, product_id, data, sold, added_at) VALUES (?, ?, ?, 0, ?)').run(id, productId, stockData, added_at);
  return { id, product_id: productId, data: stockData, sold: false, sold_to: null, sold_at: null, order_id: null, added_at };
};

const addBulkStock = (productId, stockDataArray) => {
  const insert = db.prepare('INSERT INTO stock (id, product_id, data, sold, added_at) VALUES (?, ?, ?, 0, ?)');
  const added_at = new Date().toISOString();
  const items = [];
  const bulk = db.transaction(() => {
    stockDataArray.forEach((data, index) => {
      const id = `stk_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 5)}`;
      insert.run(id, productId, data.trim(), added_at);
      items.push({ id, product_id: productId, data: data.trim(), sold: false, added_at });
    });
  });
  bulk();
  return items;
};

const markStockAsSold = (stockIds, userId, orderId) => {
  const update = db.prepare('UPDATE stock SET sold = 1, sold_to = ?, sold_at = ?, order_id = ? WHERE id = ?');
  const now = new Date().toISOString();
  const batch = db.transaction(() => {
    stockIds.forEach(id => update.run(userId, now, orderId, id));
  });
  batch();
};

const restoreStock = (stockIds) => {
  const update = db.prepare('UPDATE stock SET sold = 0, sold_to = NULL, sold_at = NULL, order_id = NULL WHERE id = ?');
  const batch = db.transaction(() => {
    stockIds.forEach(id => update.run(id));
  });
  batch();
};

const deleteStock = (stockId) => {
  db.prepare('DELETE FROM stock WHERE id = ?').run(stockId);
  return true;
};

const clearProductStock = (productId) => {
  db.prepare('DELETE FROM stock WHERE product_id = ? AND sold = 0').run(productId);
  return true;
};

const removeLastStock = (productId, count) => {
  const items = db.prepare('SELECT id FROM stock WHERE product_id = ? AND sold = 0 ORDER BY added_at DESC LIMIT ?').all(productId, count);
  if (items.length === 0) return 0;
  const ids = items.map(i => i.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM stock WHERE id IN (${placeholders})`).run(...ids);
  return ids.length;
};

// ==================== ORDERS ====================
const getOrders = () => {
  return db.prepare('SELECT * FROM orders').all().map(o => ({
    ...o,
    stock_ids: JSON.parse(o.stock_ids || '[]'),
    delivered_data: JSON.parse(o.delivered_data || '[]'),
    reminder_sent: o.reminder_sent === 1
  }));
};

const getOrderById = (orderId) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!o) return null;
  return { ...o, stock_ids: JSON.parse(o.stock_ids || '[]'), delivered_data: JSON.parse(o.delivered_data || '[]'), reminder_sent: o.reminder_sent === 1 };
};

const getOrdersByUser = (userId) => {
  return db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(userId).map(o => ({
    ...o,
    stock_ids: JSON.parse(o.stock_ids || '[]'),
    delivered_data: JSON.parse(o.delivered_data || '[]'),
    reminder_sent: o.reminder_sent === 1
  }));
};

const getPendingOrders = () => {
  return db.prepare("SELECT * FROM orders WHERE status = 'pending'").all().map(o => ({
    ...o,
    stock_ids: JSON.parse(o.stock_ids || '[]'),
    delivered_data: JSON.parse(o.delivered_data || '[]'),
    reminder_sent: o.reminder_sent === 1
  }));
};

// Bounded polling queue: hanya QRIS pending, belum expired, dan gateway pembuatnya jelas.
const getPendingQRISOrders = (limit = 50) => {
  return db.prepare(`SELECT * FROM orders
    WHERE status = 'pending' AND payment_method = 'qris'
      AND gateway_id IS NOT NULL AND gateway_id != ''
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY created_at ASC LIMIT ?`).all(new Date().toISOString(), limit).map(o => ({
      ...o,
      stock_ids: JSON.parse(o.stock_ids || '[]'),
      delivered_data: JSON.parse(o.delivered_data || '[]'),
      reminder_sent: o.reminder_sent === 1
    }));
};

const generateOrderId = () => {
  const now = new Date();
  const prefix = getConfig('order_prefix', 'ORDER_PREFIX', 'ORD');
  const dateStr = now.toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).split('/').reverse().join('');

  // Use MAX to find highest existing order number for today (safer than COUNT)
  const pattern = `${prefix}-${dateStr}-`;
  const r = db.prepare('SELECT MAX(CAST(SUBSTR(id, ?) AS INTEGER)) as maxNum FROM orders WHERE id LIKE ?')
    .get(pattern.length + 1, `${pattern}%`);
  const orderNum = String((r.maxNum || 0) + 1).padStart(4, '0');
  return `${prefix}-${dateStr}-${orderNum}`;
};

const createOrder = (orderData) => {
  const created_at = new Date().toISOString();
  const maxRetries = 5;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const id = generateOrderId();
    try {
      db.prepare(`INSERT INTO orders (id, user_id, product_id, quantity, total_idr, total_usd, payment_method, unique_code, status, stock_ids, delivered_data, reminder_sent, message_id, chat_id, created_at, expires_at, gateway_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', 0, ?, ?, ?, ?, ?)`).run(id, orderData.user_id, orderData.product_id, orderData.quantity, orderData.total_idr, orderData.total_usd || 0, orderData.payment_method, orderData.unique_code || null, orderData.status || 'pending', orderData.message_id || null, orderData.chat_id || null, created_at, orderData.expires_at || null, orderData.gateway_id || null);
      const newOrder = getOrderById(id);
      dbEvents.emit('order_change', newOrder);
      return newOrder;
    } catch (e) {
      if (e.message.includes('UNIQUE constraint') && attempt < maxRetries - 1) {
        console.log(`[ORDER] ID collision on ${id}, retrying... (attempt ${attempt + 2})`);
        continue;
      }
      throw e;
    }
  }
};

const updateOrder = (orderId, updates, reason) => {
  const order = getOrderById(orderId);
  if (!order) return null;
  const merged = { ...order, ...updates };
  db.prepare(`UPDATE orders SET user_id=?, product_id=?, quantity=?, total_idr=?, total_usd=?, payment_method=?, unique_code=?, status=?, stock_ids=?, delivered_data=?, payment_proof=?, reminder_sent=?, message_id=?, chat_id=?, reminder_message_id=?, reminder_chat_id=?, delivery_message_id=?, created_at=?, paid_at=?, delivered_at=?, expires_at=?, voucher_code=?, discount_amount=?, original_total_idr=?, original_total_usd=?, gateway_id=? WHERE id=?`).run(merged.user_id, merged.product_id, merged.quantity, merged.total_idr, merged.total_usd, merged.payment_method, merged.unique_code, merged.status, JSON.stringify(merged.stock_ids || []), JSON.stringify(merged.delivered_data || []), merged.payment_proof, merged.reminder_sent ? 1 : 0, merged.message_id, merged.chat_id, merged.reminder_message_id || null, merged.reminder_chat_id || null, merged.delivery_message_id || null, merged.created_at, merged.paid_at, merged.delivered_at, merged.expires_at, merged.voucher_code || null, merged.discount_amount || 0, merged.original_total_idr || null, merged.original_total_usd || null, merged.gateway_id || null, orderId);
  const updatedOrder = getOrderById(orderId);
  dbEvents.emit('order_change', updatedOrder, reason || 'update');
  return updatedOrder;
};

const deleteOrder = (orderId) => {
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  return true;
};

// Atomically claim an order for payment processing (prevents double-tap double-charge).
// Returns true only for the ONE caller that flips it out of init/pending; concurrent taps get false.
const claimOrderForPayment = (orderId) => {
  const result = db.prepare("UPDATE orders SET status = 'processing' WHERE id = ? AND status IN ('init', 'pending')").run(orderId);
  return result.changes === 1;
};

// Atomic delivery claim shared by webhook, polling, and manual status check.
// Only one caller can transition pending → processing_delivery.
const claimOrderForDelivery = (orderId) => {
  const result = db.prepare("UPDATE orders SET status = 'processing_delivery' WHERE id = ? AND status = 'pending'").run(orderId);
  return result.changes === 1;
};

const releaseOrderDeliveryClaim = (orderId) => {
  const result = db.prepare("UPDATE orders SET status = 'pending' WHERE id = ? AND status = 'processing_delivery'").run(orderId);
  return result.changes === 1;
};

const claimOrderForExpiry = (orderId) => {
  const result = db.prepare("UPDATE orders SET status = 'processing_expiry' WHERE id = ? AND status = 'pending'").run(orderId);
  return result.changes === 1;
};

const releaseOrderExpiryClaim = (orderId) => {
  const result = db.prepare("UPDATE orders SET status = 'pending' WHERE id = ? AND status = 'processing_expiry'").run(orderId);
  return result.changes === 1;
};

const recoverPaymentClaims = () => {
  const result = db.prepare("UPDATE orders SET status = 'pending' WHERE status IN ('processing_delivery', 'processing_expiry')").run();
  return result.changes;
};

// Exactly-once TOPUP settlement: balance, history, and terminal order status
// commit in one SQLite transaction after the shared delivery claim is won.
const completeTopupOrder = (orderId) => db.transaction(() => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND product_id = 'TOPUP' AND status = 'processing_delivery'").get(orderId);
  if (!order) return false;
  const now = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO balances (user_id, balance) VALUES (?, 0)').run(order.user_id);
  db.prepare('UPDATE balances SET balance = balance + ? WHERE user_id = ?').run(order.total_idr, order.user_id);
  const balance = db.prepare('SELECT balance FROM balances WHERE user_id = ?').get(order.user_id).balance;
  db.prepare(`INSERT INTO balance_history (id, user_id, type, amount, method, order_id, note, balance_after, created_at)
    VALUES (?, ?, 'topup', ?, 'qris', ?, 'Topup via QRIS', ?, ?)`).run(`bal_${Date.now()}_${order.id}`, order.user_id, order.total_idr, order.id, balance, now);
  db.prepare("UPDATE orders SET status = 'delivered', paid_at = ?, delivered_at = ? WHERE id = ? AND status = 'processing_delivery'").run(now, now, order.id);
  return true;
})();

// ==================== USERS ====================
const getUsers = () => {
  const rows = db.prepare('SELECT * FROM users').all();
  const result = {};
  rows.forEach(u => {
    result[u.id] = { ...u, banned: u.banned === 1 };
    delete result[u.id].id;
  });
  return result;
};

const getUser = (userId) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  const result = { ...u, banned: u.banned === 1 };
  delete result.id;
  return result;
};

const createOrUpdateUser = (userId, userData) => {
  const existing = getUser(userId);
  const now = new Date().toISOString();
  if (existing) {
    const merged = { ...existing, ...userData, updated_at: now };
    db.prepare('UPDATE users SET first_name=?, last_name=?, username=?, language=?, banned=?, updated_at=? WHERE id=?').run(merged.first_name || null, merged.last_name || null, merged.username || null, merged.language || 'id', merged.banned ? 1 : 0, now, userId);
    return getUser(userId);
  } else {
    const created_at = now;
    db.prepare('INSERT INTO users (id, first_name, last_name, username, language, banned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(userId, userData.first_name || null, userData.last_name || null, userData.username || null, userData.language || 'id', userData.banned ? 1 : 0, created_at, now);
    return getUser(userId);
  }
};

const setUserLanguage = (userId, lang) => {
  return createOrUpdateUser(userId, { language: lang });
};

const getUserLanguage = (userId) => {
  const user = getUser(userId);
  return user?.language || 'id';
};

// ==================== STATS ====================
const getStats = () => {
  const detailed = getDetailedStats();
  return {
    pending: db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'pending'").get().cnt,
    done: detailed.transactions.total_success,
    todayRevenue: detailed.income.today.total_idr
  };
};

const getDetailedStats = () => {
  const { getWIBDateRange } = require('../utils/helpers');
  const { todayStart, weekStart, monthStart } = getWIBDateRange();

  // Semua order sukses (termasuk TOPUP) — dipakai untuk HITUNGAN transaksi.
  const paidOrders = db.prepare("SELECT * FROM orders WHERE status IN ('paid', 'delivered')").all();

  // REVENUE hanya dari penjualan produk. Topup saldo BUKAN pendapatan: uang baru dihitung sbg
  // revenue saat buyer checkout produk pakai saldo. Kalau topup ikut, uang sama ke-count 2x. Jadi exclude TOPUP.
  const salesOrders = paidOrders.filter(o => o.product_id !== 'TOPUP');

  const calculateIncome = (orderList) => {
    let total = 0, qris = 0, saldo = 0;
    orderList.forEach(o => {
      const val = o.total_idr || 0;
      total += val;
      if (o.payment_method === 'qris') qris += val;
      else if (o.payment_method === 'saldo') saldo += val;
    });
    return { total, qris, saldo };
  };

  const todayOrders = salesOrders.filter(o => o.paid_at && o.paid_at >= todayStart);
  const weekOrders = salesOrders.filter(o => o.paid_at && o.paid_at >= weekStart);
  const monthOrders = salesOrders.filter(o => o.paid_at && o.paid_at >= monthStart);

  // Transaksi NYATA = kecualikan 'init' (draft ditinggalkan di layar konfirmasi) & 'processing' (transisi).
  // Order draft bukan transaksi sungguhan; kalau ikut denominator, success rate jadi terlihat lebih buruk dari kenyataan.
  const totalTx = db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status NOT IN ('init', 'processing')").get().cnt;
  const pendingTx = db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'pending'").get().cnt;
  const successTx = paidOrders.length;
  const failedTx = db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status IN ('cancelled', 'expired')").get().cnt;
  const successRate = totalTx > 0 ? ((successTx / totalTx) * 100).toFixed(1) : 0;

  return {
    income: {
      today: { ...calculateIncome(todayOrders), total_idr: calculateIncome(todayOrders).total },
      week: { ...calculateIncome(weekOrders) },
      month: { ...calculateIncome(monthOrders) },
      all_time: { ...calculateIncome(salesOrders) }
    },
    transactions: {
      total: totalTx,
      pending: pendingTx,
      success: successTx,
      total_success: successTx,
      failed: failedTx,
      success_rate: successRate
    }
  };
};

// Jumlah ITEM terjual per produk dalam N hari terakhir = SUM(quantity) order sukses (paid/delivered).
// Dihitung dari tabel orders (bukan baris stock sold), karena baris stock sold=1 dipurge >60 hari
// (purgeOldSoldStock di reminder.js) sehingga tidak akurat untuk statistik. Order delivered disimpan lebih lama.
// Default 30 hari: dipakai kolom "Terjual" di menu produk / kelola stok (statistik penjualan bulanan).
const getSoldQtyByProduct = (productId, sinceDays = 30) => {
  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const r = db.prepare(
    "SELECT COALESCE(SUM(quantity), 0) AS qty FROM orders WHERE product_id = ? AND status IN ('paid', 'delivered') AND COALESCE(delivered_at, paid_at, created_at) >= ?"
  ).get(productId, cutoff);
  return r.qty || 0;
};

const getTopSpenders = (limit = 10) => {
  const rows = db.prepare(`
    SELECT user_id, SUM(total_idr) as total_spend, COUNT(*) as total_tx
    FROM orders WHERE status IN ('paid', 'delivered')
    GROUP BY user_id ORDER BY total_spend DESC LIMIT ?
  `).all(limit);

  const users = getUsers();
  return rows.map(r => ({
    user_id: r.user_id,
    total_spend: r.total_spend,
    total_tx: r.total_tx,
    ...users[r.user_id]
  }));
};

// ==================== VOUCHERS ====================
const getVouchers = () => {
  return db.prepare('SELECT * FROM vouchers').all().map(v => ({ ...v, used: v.used === 1 }));
};

const getVoucherByCode = (code) => {
  const v = db.prepare('SELECT * FROM vouchers WHERE UPPER(code) = UPPER(?)').get(code);
  return v ? { ...v, used: v.used === 1 } : null;
};

const createVoucher = (voucherData) => {
  const id = `VCH-${Date.now()}`;
  const created_at = new Date().toISOString();
  db.prepare('INSERT INTO vouchers (id, code, type, value, used, created_at) VALUES (?, ?, ?, ?, 0, ?)').run(id, voucherData.code.toUpperCase(), voucherData.type, voucherData.value, created_at);
  return { id, code: voucherData.code.toUpperCase(), type: voucherData.type, value: voucherData.value, used: false, created_at };
};

const useVoucher = (code, userId) => {
  const v = getVoucherByCode(code);
  if (!v) return null;
  const now = new Date().toISOString();
  db.prepare('UPDATE vouchers SET used = 1, used_by = ?, used_at = ? WHERE id = ?').run(userId, now, v.id);
  return { ...v, used: true, used_by: userId, used_at: now };
};

const deleteVoucher = (voucherId) => {
  db.prepare('DELETE FROM vouchers WHERE id = ?').run(voucherId);
};

const calculateDiscount = (totalIDR, voucher) => {
  if (voucher.type === 'percent') {
    return Math.floor(totalIDR * (voucher.value / 100));
  } else {
    return Math.min(voucher.value, totalIDR);
  }
};

// Per-user voucher usage: a code can be redeemed once PER user (not globally single-use).
const hasUserRedeemedVoucher = (code, userId) => {
  const r = db.prepare('SELECT 1 FROM voucher_redemptions WHERE voucher_code = UPPER(?) AND user_id = ?').get(code, userId);
  return !!r;
};

// Record a redemption at payment success. Returns false if this user already redeemed the code.
const redeemVoucher = (code, userId, orderId) => {
  try {
    const id = `VRD-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    db.prepare('INSERT INTO voucher_redemptions (id, voucher_code, user_id, order_id, redeemed_at) VALUES (?, UPPER(?), ?, ?, ?)')
      .run(id, code, userId, orderId, new Date().toISOString());
    return true;
  } catch (e) {
    // UNIQUE(voucher_code, user_id) violation → already redeemed by this user
    return false;
  }
};

// ==================== SETTINGS ====================
const getSettings = () => {
  const defaults = { maintenance: false, qris_enabled: true, saldo_enabled: true };
  const rows = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  rows.forEach(r => { try { obj[r.key] = JSON.parse(r.value); } catch (e) { obj[r.key] = r.value; } });
  return { ...defaults, ...obj };
};

const updateSettings = (updates) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const batch = db.transaction(() => {
    for (const [key, val] of Object.entries(updates)) {
      upsert.run(key, JSON.stringify(val));
    }
  });
  batch();
  return getSettings();
};

// SQLite online backup API: menghasilkan satu file snapshot konsisten termasuk
// seluruh perubahan WAL, tanpa perlu menyalin store.db-wal/store.db-shm.
const backupDatabase = (destination) => db.backup(destination);

/**
 * getConfig — sumber konfigurasi tunggal dengan urutan prioritas:
 *   1. Nilai di tabel settings (bisa diubah dari panel web, live tanpa restart)
 *   2. process.env[ENV_KEY]  (backward-compatible dengan .env lama)
 *   3. fallback default
 * Dibaca fresh tiap panggil → perubahan dari panel langsung ngefek.
 *
 * @param {string} settingKey - key di tabel settings (mis. 'store_name')
 * @param {string} envKey - nama env var (mis. 'STORE_NAME')
 * @param {*} fallback - nilai default kalau dua-duanya kosong
 */
const getConfig = (settingKey, envKey, fallback = '') => {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey);
    if (row && row.value != null) {
      let v;
      try { v = JSON.parse(row.value); } catch (e) { v = row.value; }
      if (v !== '' && v != null) return v;
    }
  } catch (e) { /* fall through ke env */ }
  const envVal = envKey ? process.env[envKey] : undefined;
  if (envVal != null && envVal !== '') return envVal;
  return fallback;
};

// ==================== PAYMENT GATEWAYS ====================
const parseGateway = (row) => {
  if (!row) return null;
  let creds = {};
  try { creds = JSON.parse(row.credentials || '{}'); } catch (e) { creds = {}; }
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    credentials: creds,
    enabled: row.enabled === 1,
    priority: row.priority || 0,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
};

const getPaymentGateways = () => {
  return db.prepare('SELECT * FROM payment_gateways ORDER BY priority ASC, created_at ASC').all().map(parseGateway);
};

const getPaymentGatewayById = (id) => {
  return parseGateway(db.prepare('SELECT * FROM payment_gateways WHERE id = ?').get(id));
};

// Gateway aktif berprioritas tertinggi untuk sebuah provider (dipakai qris.js call-time).
// Fase 3: single gateway. Fase 4: routing multi-gateway pakai daftar enabled.
const getActiveGateway = (provider = 'pakasir') => {
  const row = db.prepare(
    'SELECT * FROM payment_gateways WHERE provider = ? AND enabled = 1 ORDER BY priority ASC, created_at ASC LIMIT 1'
  ).get(provider);
  return parseGateway(row);
};

const createPaymentGateway = ({ provider, label, credentials, enabled = true, priority = 0 }) => {
  const id = `GW-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO payment_gateways (id, provider, label, credentials, enabled, priority, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, provider, label || provider, JSON.stringify(credentials || {}), enabled ? 1 : 0, priority, now, now
  );
  return getPaymentGatewayById(id);
};

const updatePaymentGateway = (id, updates) => {
  const existing = getPaymentGatewayById(id);
  if (!existing) return null;
  const merged = {
    label: updates.label !== undefined ? updates.label : existing.label,
    // Merge credentials: field yang tidak dikirim tetap pakai nilai lama (biar bisa update sebagian).
    credentials: updates.credentials !== undefined
      ? { ...existing.credentials, ...updates.credentials }
      : existing.credentials,
    enabled: updates.enabled !== undefined ? updates.enabled : existing.enabled,
    priority: updates.priority !== undefined ? updates.priority : existing.priority
  };
  db.prepare(`UPDATE payment_gateways SET label = ?, credentials = ?, enabled = ?, priority = ?, updated_at = ? WHERE id = ?`)
    .run(merged.label, JSON.stringify(merged.credentials), merged.enabled ? 1 : 0, merged.priority, new Date().toISOString(), id);
  return getPaymentGatewayById(id);
};

const deletePaymentGateway = (id) => {
  db.prepare('DELETE FROM payment_gateways WHERE id = ?').run(id);
};

const getActiveOrderCountByGateway = (gatewayId) => db.prepare(
  "SELECT COUNT(*) AS n FROM orders WHERE gateway_id = ? AND status IN ('pending','processing')"
).get(gatewayId).n || 0;

// Atomic webhook idempotency claim. true hanya untuk event pertama.
const claimWebhookEvent = (eventId, provider, orderId) => {
  const result = db.prepare(`INSERT OR IGNORE INTO webhook_events (event_id, provider, order_id, received_at)
    VALUES (?, ?, ?, ?)`).run(eventId, provider, orderId || null, new Date().toISOString());
  return result.changes === 1;
};

const releaseWebhookEvent = (eventId) => {
  db.prepare('DELETE FROM webhook_events WHERE event_id = ?').run(eventId);
};

/**
 * getGatewayCredential — resolver credential untuk provider aktif.
 * Prioritas: gateway aktif di DB > process.env (backward compat) > ''.
 * Dipakai qris.js SAAT CALL (bukan module-load) supaya ganti credential langsung ngefek.
 */
const getGatewayCredential = (provider = 'pakasir') => {
  const gw = getActiveGateway(provider);
  if (gw && gw.credentials) {
    return { source: 'db', gatewayId: gw.id, ...gw.credentials };
  }
  // Fallback ke env
  if (provider === 'pakasir') {
    return { source: 'env', api_key: process.env.PAKASIR_API_KEY || '', slug: process.env.PAKASIR_SLUG || '' };
  }
  return { source: 'none' };
};

/**
 * getGatewayCredentialById — resolver credential untuk gateway SPESIFIK (by id).
 * Dipakai saat verifikasi/cek status/webhook: order menyimpan gateway_id yang dipakai
 * membuat transaksi, jadi kita HARUS memakai credential gateway itu (bukan gateway aktif
 * saat ini, yang bisa berubah karena round-robin / admin menyalakan gateway lain).
 * Kalau id tidak ketemu (mis. gateway sudah dihapus), fallback ke resolver aktif/env.
 */
const getGatewayCredentialById = (gatewayId, provider = 'pakasir') => {
  if (gatewayId) {
    const gw = getPaymentGatewayById(gatewayId);
    if (gw && gw.credentials) {
      return { source: 'db', gatewayId: gw.id, ...gw.credentials };
    }
  }
  return getGatewayCredential(provider);
};

// ==================== GATEWAY ROUTING (Fase 4) ====================
// Strategi routing multi-gateway. Disimpan di tabel settings (live tanpa restart):
//   - gateway_strategy: 'priority' (default) | 'round_robin' | 'manual'
//   - gateway_manual_id: id gateway pilihan admin (dipakai saat strategy='manual')
//   - gateway_rr_index: kursor internal untuk round-robin (auto-managed)
const ROUTING_STRATEGIES = ['priority', 'round_robin', 'manual'];

const getGatewayStrategy = () => {
  const s = getConfig('gateway_strategy', null, 'priority');
  return ROUTING_STRATEGIES.includes(s) ? s : 'priority';
};

/**
 * getRoutedGateway — pilih SATU gateway enabled untuk transaksi baru sesuai strategi.
 *   - priority    : priority ASC, lalu created_at ASC (gateway "utama" dulu).
 *   - round_robin : bergilir merata antar gateway enabled (load balancing).
 *   - manual      : gateway yang dipilih admin; fallback ke priority kalau tak valid/mati.
 * Return objek gateway (parseGateway) atau null kalau tidak ada gateway enabled sama sekali
 * (caller lalu fallback ke credential env demi backward-compat).
 */
const getRoutedGateway = (provider = 'pakasir') => {
  const enabled = db.prepare(
    'SELECT * FROM payment_gateways WHERE provider = ? AND enabled = 1 ORDER BY priority ASC, created_at ASC'
  ).all(provider).map(parseGateway);

  if (enabled.length === 0) return null;
  if (enabled.length === 1) return enabled[0];

  const strategy = getGatewayStrategy();

  if (strategy === 'manual') {
    const manualId = getConfig('gateway_manual_id', null, '');
    const picked = enabled.find(g => g.id === manualId);
    if (picked) return picked;
    return enabled[0]; // manual id invalid/mati → fallback prioritas tertinggi
  }

  if (strategy === 'round_robin') {
    // Kursor persisten di settings; naikkan tiap pemakaian, modulo jumlah gateway enabled.
    const prev = parseInt(getConfig('gateway_rr_index', null, 0)) || 0;
    const idx = prev % enabled.length;
    updateSettings({ gateway_rr_index: (idx + 1) % enabled.length });
    return enabled[idx];
  }

  // default: priority
  return enabled[0];
};

// ==================== FLASH SALE ====================
const isFlashSaleActive = (product) => {
  if (!product || !product.flash_price || !product.flash_start || !product.flash_end) return false;
  const now = new Date().toISOString();
  return now >= product.flash_start && now <= product.flash_end;
};

const getEffectivePrice = (product) => {
  if (isFlashSaleActive(product)) return product.flash_price;
  return product.price_idr;
};

const setFlashSale = (productId, flashPrice, flashStart, flashEnd) => {
  db.prepare('UPDATE products SET flash_price = ?, flash_start = ?, flash_end = ? WHERE id = ?')
    .run(flashPrice, flashStart, flashEnd, productId);
  return getProductById(productId);
};

const clearFlashSale = (productId) => {
  db.prepare('UPDATE products SET flash_price = NULL, flash_start = NULL, flash_end = NULL WHERE id = ?')
    .run(productId);
  return getProductById(productId);
};

const getActiveFlashSales = () => {
  const now = new Date().toISOString();
  return db.prepare('SELECT * FROM products WHERE flash_price IS NOT NULL AND flash_start <= ? AND flash_end >= ?')
    .all(now, now)
    .map(p => ({ ...p, active: p.active === 1 }));
};

const getExpiredFlashSales = () => {
  const now = new Date().toISOString();
  return db.prepare('SELECT * FROM products WHERE flash_price IS NOT NULL AND flash_end < ?')
    .all(now)
    .map(p => ({ ...p, active: p.active === 1 }));
};

// ==================== MAINTENANCE ====================
const purgeOldOrders = (daysOld = 30) => {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare("DELETE FROM orders WHERE status IN ('expired', 'cancelled', 'refunded') AND created_at < ?").run(cutoff);
  if (result.changes > 0) console.log(`[PURGE] Removed ${result.changes} old orders`);
  return result.changes;
};

const purgeOldSoldStock = (daysOld = 60) => {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM stock WHERE sold = 1 AND sold_at < ?').run(cutoff);
  if (result.changes > 0) console.log(`[PURGE] Removed ${result.changes} old sold stock`);
  return result.changes;
};

// ==================== EXPORTS ====================
module.exports = {
  // Raw db instance (for balance.js to reuse)
  _db: db,
  // Categories
  getCategories, addCategory, updateCategory, deleteCategory,
  // Products
  getProducts, getProductsByCategory, getProductById, addProduct, updateProduct, deleteProduct,
  // Stock
  getStock, getStockByProduct, getAvailableStockCount, getUnsoldUnreservedStock, addStock, addBulkStock, markStockAsSold, restoreStock, deleteStock, clearProductStock, removeLastStock, reserveStock, releaseReservedStock, getReservedStock,
  // Orders
  getOrders, getOrderById, getOrdersByUser, getPendingOrders, getPendingQRISOrders, generateOrderId, createOrder, updateOrder, deleteOrder, claimOrderForPayment, claimOrderForDelivery, releaseOrderDeliveryClaim, claimOrderForExpiry, releaseOrderExpiryClaim, recoverPaymentClaims, completeTopupOrder,
  // Users
  getUsers, getUser, createOrUpdateUser, setUserLanguage, getUserLanguage,
  // Stats
  getStats, getDetailedStats, getTopSpenders, getSoldQtyByProduct,
  // Vouchers
  getVouchers, getVoucherByCode, createVoucher, useVoucher, deleteVoucher, calculateDiscount, hasUserRedeemedVoucher, redeemVoucher,
  // Settings
  getSettings, updateSettings, getConfig, backupDatabase,
  // Payment Gateways
  getPaymentGateways, getPaymentGatewayById, getActiveGateway, createPaymentGateway,
  updatePaymentGateway, deletePaymentGateway, getActiveOrderCountByGateway, getGatewayCredential,
  getGatewayCredentialById, getRoutedGateway, getGatewayStrategy, claimWebhookEvent, releaseWebhookEvent,
  // Flash Sale
  isFlashSaleActive, getEffectivePrice, setFlashSale, clearFlashSale, getActiveFlashSales, getExpiredFlashSales,
  // Maintenance
  purgeOldOrders, purgeOldSoldStock,
  // Event Emitter
  dbEvents
};
