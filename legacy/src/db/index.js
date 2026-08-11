const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, "app.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

// Lightweight migrations: add columns that were introduced after the DB was created.
function ensureColumns(table, columns) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.includes(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }
}

ensureColumns("campaigns", {
  first_message: "TEXT",
  system_prompt: "TEXT",
  knowledge_base: "TEXT"
});

module.exports = db;
