import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const CURATED_ALIASES = {
  'kfc-2813': [
    'combo gà rán vui vẻ',
    'combo vui vẻ',
    'combo gà vui vẻ',
    'gà rán vui vẻ',
    'nhóm 2 vui vẻ',
  ],
  'kfc-2743': ['gà cay', 'gà không cay', 'miếng gà cay', 'miếng gà thường'],
  'kfc-2770': ['khoai tây chiên size l', 'khoai chiên l', 'khoai lớn'],
  'kfc-2782': ['pepsi', 'pepsi tiêu chuẩn', 'ly pepsi'],
};

export function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/\u00a0/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Starter VI/EN sensitive-keyword list (complaint, legal threat, fraud,
// food-safety, abuse language) — see plans/staff-alerts-cart-edit/spec.md
// Assumptions. Stored pre-normalized (token sequences) so message matching
// never needs to re-normalize the list itself.
const SENSITIVE_KEYWORDS = [
  'khieu nai', 'phan nan', 'to cao', 'kien', 'luat su', 'bao cong an', 'cong an',
  'lua dao', 'lua gat', 'ngo doc', 'di ung', 'di vat', 'con trung',
  'toc trong do an', 'hong', 'oi thiu', 'moc', 'ban', 'thai do te', 'chui',
  'xuc pham', 'boi thuong', 'hoan tien', 'boc phot', 'tay chay',
  'complaint', 'lawsuit', 'lawyer', 'sue', 'police', 'scam', 'fraud',
  'food poisoning', 'allergic reaction', 'foreign object', 'insect',
  'hair in food', 'moldy', 'expired', 'refund', 'compensation', 'disgusting',
  'terrible service', 'report this', 'boycott',
].map((phrase) => phrase.split(' '));

// Whole-token/phrase match against normalized text — a raw substring check
// would false-positive (e.g. "ban" is a substring of "banh", the normalized
// form of "Bánh"), so this compares token sequences instead.
export function matchesSensitiveKeyword(text) {
  const tokens = normalizeText(text).split(' ').filter(Boolean);
  return SENSITIVE_KEYWORDS.some((phrase) => {
    for (let start = 0; start <= tokens.length - phrase.length; start += 1) {
      if (phrase.every((word, i) => tokens[start + i] === word)) return true;
    }
    return false;
  });
}

const schema = `
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    item_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    original_price INTEGER,
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    aliases_json TEXT NOT NULL DEFAULT '[]',
    search_text TEXT NOT NULL,
    source_file TEXT NOT NULL DEFAULT 'kfc_menu.json',
    imported_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    customer_phone TEXT,
    last_response_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    control_mode TEXT NOT NULL DEFAULT 'bot',
    zalo_chat_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS carts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    address TEXT,
    voucher_code TEXT,
    discount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'empty',
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    id TEXT PRIMARY KEY,
    cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(item_id),
    variant TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 20),
    note TEXT NOT NULL DEFAULT '',
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(cart_id, product_id, variant)
  );

  CREATE TABLE IF NOT EXISTS customers (
    phone TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vouchers (
    code TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    discount_type TEXT NOT NULL,
    discount_value INTEGER NOT NULL,
    minimum_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    display_id TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    source_cart_id TEXT NOT NULL UNIQUE REFERENCES carts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    phone TEXT,
    address TEXT NOT NULL,
    subtotal INTEGER NOT NULL,
    discount INTEGER NOT NULL,
    total INTEGER NOT NULL,
    voucher_code TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    variant TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    unit_price INTEGER NOT NULL,
    line_total INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'human_agent')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reply_ids_json TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    PRIMARY KEY(provider, external_id)
  );

  CREATE INDEX IF NOT EXISTS idx_activity_session_id ON activity_events(session_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_webhook_events_session ON webhook_events(session_id, received_at DESC);
`;

function now() {
  return new Date().toISOString();
}

const SCHEMA_VERSION = 1;

function backupDatabaseFile(db, databasePath, preexisted) {
  if (!preexisted) return null;
  // WAL mode keeps recently committed rows in the -wal sidecar file until a
  // checkpoint folds them into the main file. Without this, copying the main
  // file alone can produce a backup that's missing recent commits.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const suffix = now().replace(/[:.]/g, '-');
  const backupPath = `${databasePath}.backup-${suffix}`;
  fs.copyFileSync(databasePath, backupPath);
  return backupPath;
}

function sessionsHasColumn(db, column) {
  return db.prepare('PRAGMA table_info(sessions)').all().some((row) => row.name === column);
}

function messagesAllowsHumanAgentRole(db) {
  const row = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'
  `).get();
  return Boolean(row?.sql?.includes('human_agent'));
}

function rebuildMessagesTableForHumanAgentRole(db) {
  const before = db.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
  db.exec(`
    CREATE TABLE messages_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'human_agent')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(`
    INSERT INTO messages_new (id, session_id, role, content, created_at)
    SELECT id, session_id, role, content, created_at FROM messages;
  `);
  const after = db.prepare('SELECT COUNT(*) AS count FROM messages_new').get().count;
  if (after !== before) {
    throw new Error(`Nâng cấp bảng messages thất bại: kỳ vọng ${before} dòng, thực tế ${after}.`);
  }
  db.exec('DROP TABLE messages;');
  db.exec('ALTER TABLE messages_new RENAME TO messages;');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id, id DESC);');
}

function migrateSchema(db, databasePath, preexisted) {
  const currentVersion = db.prepare('PRAGMA user_version').get().user_version;
  if (currentVersion >= SCHEMA_VERSION) return;

  backupDatabaseFile(db, databasePath, preexisted);

  const needsMessagesRebuild = !messagesAllowsHumanAgentRole(db);
  if (needsMessagesRebuild) db.exec('PRAGMA foreign_keys = OFF');

  try {
    withTransaction(db, () => {
      if (!sessionsHasColumn(db, 'control_mode')) {
        db.exec("ALTER TABLE sessions ADD COLUMN control_mode TEXT NOT NULL DEFAULT 'bot'");
      }
      if (!sessionsHasColumn(db, 'zalo_chat_id')) {
        db.exec('ALTER TABLE sessions ADD COLUMN zalo_chat_id TEXT');
      }
      if (needsMessagesRebuild) rebuildMessagesTableForHumanAgentRole(db);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  } finally {
    if (needsMessagesRebuild) db.exec('PRAGMA foreign_keys = ON');
  }
}

function withTransaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function importMenu(db, menuPath) {
  const raw = fs.readFileSync(menuPath, 'utf8');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const currentHash = db.prepare("SELECT value FROM metadata WHERE key = 'menu_hash'").get()?.value;
  const currentCount = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  if (currentHash === hash && currentCount > 0) return currentCount;

  const menu = JSON.parse(raw);
  if (!Array.isArray(menu) || menu.length === 0) {
    throw new Error('kfc_menu.json phải là một mảng có ít nhất một món.');
  }

  const upsert = db.prepare(`
    INSERT INTO products (
      item_id, name, category, price, original_price, description, image_url,
      aliases_json, search_text, source_file, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'kfc_menu.json', ?)
    ON CONFLICT(item_id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      price = excluded.price,
      original_price = excluded.original_price,
      description = excluded.description,
      image_url = excluded.image_url,
      aliases_json = excluded.aliases_json,
      search_text = excluded.search_text,
      imported_at = excluded.imported_at
  `);

  const importedAt = now();
  withTransaction(db, () => {
    for (const item of menu) {
      if (!item.item_id || !item.name || !Number.isInteger(item.price)) {
        throw new Error(`Món không hợp lệ trong menu: ${JSON.stringify(item)}`);
      }
      const aliases = [...new Set([...(item.aliases || []), ...(CURATED_ALIASES[item.item_id] || [])])];
      const searchText = normalizeText([
        item.item_id,
        item.name,
        item.category,
        item.description || '',
        ...aliases,
      ].join(' '));
      upsert.run(
        item.item_id,
        item.name.trim(),
        item.category || 'khac',
        item.price,
        item.original_price ?? null,
        (item.description || '').trim(),
        item.image_url || '',
        JSON.stringify(aliases),
        searchText,
        importedAt,
      );
    }

    db.prepare(`
      INSERT INTO metadata(key, value) VALUES ('menu_hash', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(hash);
    db.prepare(`
      INSERT INTO metadata(key, value) VALUES ('menu_imported_at', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(importedAt);
  });
  return menu.length;
}

function seedDemoData(db) {
  const updatedAt = now();
  db.prepare(`
    INSERT INTO customers(phone, display_name, points, updated_at)
    VALUES ('0901234567', 'Khách Demo', 150, ?)
    ON CONFLICT(phone) DO UPDATE SET
      display_name = excluded.display_name,
      points = excluded.points,
      updated_at = excluded.updated_at
  `).run(updatedAt);

  const upsertVoucher = db.prepare(`
    INSERT INTO vouchers(code, description, discount_type, discount_value, minimum_order, active, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(code) DO UPDATE SET
      description = excluded.description,
      discount_type = excluded.discount_type,
      discount_value = excluded.discount_value,
      minimum_order = excluded.minimum_order,
      active = excluded.active,
      updated_at = excluded.updated_at
  `);

  upsertVoucher.run(
    'KFC50K',
    'Giảm 50.000đ cho đơn từ 100.000đ',
    'fixed',
    50000,
    100000,
    updatedAt,
  );

  for (let percentage = 10; percentage <= 100; percentage += 10) {
    upsertVoucher.run(
      `KFC${percentage}`,
      `Giảm ${percentage}% tổng giá trị giỏ hàng`,
      'percentage',
      percentage,
      0,
      updatedAt,
    );
  }
}

export function openDatabase({ databasePath, menuPath }) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  // Capture existence *before* DatabaseSync creates the file on disk, so the
  // pre-upgrade backup step can tell a genuine first run (no file yet, skip
  // backup) apart from an existing database being upgraded (back it up).
  const preexisted = fs.existsSync(databasePath);
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(schema);
  migrateSchema(db, databasePath, preexisted);
  const menuCount = importMenu(db, menuPath);
  seedDemoData(db);
  return { db, menuCount };
}

export function resetAllDemoData(db) {
  withTransaction(db, () => {
    db.exec('DELETE FROM webhook_events');
    db.exec('DELETE FROM sessions');
  });
}

export { withTransaction };
