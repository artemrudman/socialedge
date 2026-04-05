// ── SQLite database setup ────────────────────────────────────────────────────
const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "socialedge.db");
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent reads
db.pragma("journal_mode = WAL");

// ── Schema ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password    TEXT,                   -- bcrypt hash (NULL for Google-only users)
    google_id   TEXT UNIQUE,            -- Google sub claim
    avatar_url  TEXT,
    plan        TEXT NOT NULL DEFAULT 'free',   -- 'free' | 'pro'
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
`);

// ── Prepared statements ─────────────────────────────────────────────────────
const stmts = {
  findByEmail:    db.prepare("SELECT * FROM users WHERE email = ?"),
  findByGoogleId: db.prepare("SELECT * FROM users WHERE google_id = ?"),
  findById:       db.prepare("SELECT * FROM users WHERE id = ?"),

  create: db.prepare(`
    INSERT INTO users (id, name, email, password, google_id, avatar_url, plan, created_at, updated_at)
    VALUES (@id, @name, @email, @password, @google_id, @avatar_url, @plan, @created_at, @updated_at)
  `),

  updatePlan: db.prepare("UPDATE users SET plan = ?, updated_at = ? WHERE id = ?"),

  linkGoogle: db.prepare(
    "UPDATE users SET google_id = ?, avatar_url = COALESCE(?, avatar_url), updated_at = ? WHERE id = ?"
  ),
};

module.exports = { db, stmts };
