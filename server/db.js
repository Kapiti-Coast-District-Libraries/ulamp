// server/db.js
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DB_PATH = path.resolve(process.cwd(), "data.sqlite");
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, "");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// base schema
db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  stripe_session_id TEXT UNIQUE,
  paid INTEGER DEFAULT 0,

  email TEXT,
  name TEXT,
  phone TEXT,
  shipping_json TEXT,

  currency TEXT,
  amount_total INTEGER,

  pack_key TEXT,
  model_key TEXT,
  params_json TEXT,
  filename TEXT,

  drive_file_id TEXT,
  drive_web_view_link TEXT,
  drive_web_content_link TEXT,
  uploaded INTEGER DEFAULT 0
);
`);

// light migration, add paid if missing in an older DB
try {
  const cols = db.prepare(`PRAGMA table_info(orders)`).all();
  const names = new Set(cols.map(c => c.name));
  if (!names.has("paid")) {
    db.exec(`ALTER TABLE orders ADD COLUMN paid INTEGER DEFAULT 0`);
  }
} catch (e) {
  // ignore
}

export function upsertOrderFromSession(session) {
  const md = session?.metadata || {};
  const cust = session?.customer_details || {};
  const shipping = session?.shipping_details
    ? {
        name: session.shipping_details.name || null,
        phone: cust.phone || null,
        address: session.shipping_details.address || null
      }
    : null;

  const stmt = db.prepare(`
    INSERT INTO orders (
      stripe_session_id, paid, email, name, phone, shipping_json,
      currency, amount_total, pack_key, model_key, params_json, filename
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stripe_session_id) DO UPDATE SET
      paid = excluded.paid,
      email = COALESCE(excluded.email, orders.email),
      name = COALESCE(excluded.name, orders.name),
      phone = COALESCE(excluded.phone, orders.phone),
      shipping_json = COALESCE(excluded.shipping_json, orders.shipping_json),
      currency = COALESCE(excluded.currency, orders.currency),
      amount_total = COALESCE(excluded.amount_total, orders.amount_total),
      pack_key = COALESCE(excluded.pack_key, orders.pack_key),
      model_key = COALESCE(excluded.model_key, orders.model_key),
      params_json = COALESCE(excluded.params_json, orders.params_json),
      filename = COALESCE(excluded.filename, orders.filename)
  `);

  stmt.run(
    session.id,
    session.payment_status === "paid" && session.status === "complete" ? 1 : 0,
    cust.email || null,
    session?.shipping_details?.name || null,
    cust.phone || null,
    shipping ? JSON.stringify(shipping) : null,
    session.currency || null,
    session.amount_total ?? null,
    md.packKey || null,
    md.modelKey || null,
    md.params || null,
    md.filename || null
  );
}

export function saveDraftOrder(sessionId, { packKey, modelKey, params_json, filename }) {
  // insert literal 0 for paid, do not reference a column in VALUES
  db.prepare(`
    INSERT INTO orders (stripe_session_id, pack_key, model_key, params_json, filename, paid)
    VALUES (?, ?, ?, ?, ?, 0)
    ON CONFLICT(stripe_session_id) DO UPDATE SET
      pack_key = COALESCE(excluded.pack_key, orders.pack_key),
      model_key = COALESCE(excluded.model_key, orders.model_key),
      params_json = COALESCE(excluded.params_json, orders.params_json),
      filename = COALESCE(excluded.filename, orders.filename)
  `).run(
    sessionId,
    packKey || null,
    modelKey || null,
    params_json || null,
    filename || null
  );
}

export function markUploaded(sessionId, file, finalFilename) {
  db.prepare(`
    UPDATE orders SET
      uploaded = 1,
      filename = COALESCE(?, filename),
      drive_file_id = ?,
      drive_web_view_link = ?,
      drive_web_content_link = ?
    WHERE stripe_session_id = ?
  `).run(
    finalFilename || null,
    file?.id || null,
    file?.webViewLink || null,
    file?.webContentLink || null,
    sessionId
  );
}

export function listOrders(limit = 100) {
  return db.prepare(`SELECT * FROM orders ORDER BY id DESC LIMIT ?`).all(limit);
}

export function getOrderBySession(sessionId) {
  return db.prepare(`SELECT * FROM orders WHERE stripe_session_id = ?`).get(sessionId);
}
