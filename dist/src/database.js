"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toUser = exports.now = void 0;
exports.getDatabase = getDatabase;
exports.migrate = migrate;
exports.closeDatabase = closeDatabase;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
let database;
function getDatabase() {
    if (database)
        return database;
    const filename = process.env.DATABASE_PATH ?? node_path_1.default.resolve("data", "delivery-verifier.sqlite");
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(filename), { recursive: true });
    database = new better_sqlite3_1.default(filename);
    migrate(database);
    return database;
}
function migrate(db = getDatabase()) {
    db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('client','worker','reviewer')),
      paypal_email TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
      worker_id INTEGER NOT NULL REFERENCES users(id), brief TEXT NOT NULL,
      stack TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'created', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS criteria (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL REFERENCES cases(id),
      status TEXT NOT NULL, payload TEXT NOT NULL, approved_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL REFERENCES cases(id),
      paypal_id TEXT, kind TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL REFERENCES cases(id),
      storage_path TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL REFERENCES cases(id),
      decision TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL REFERENCES cases(id),
      reviewer_id INTEGER REFERENCES users(id), status TEXT NOT NULL, decision TEXT,
      payload TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL REFERENCES cases(id),
      paypal_batch_id TEXT, status TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT REFERENCES cases(id),
      actor_id INTEGER REFERENCES users(id), type TEXT NOT NULL, payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}
function closeDatabase() {
    database?.close();
    database = undefined;
}
const now = () => new Date().toISOString();
exports.now = now;
const toUser = (row) => ({
    id: Number(row.id), email: String(row.email), name: String(row.name),
    role: row.role, paypalEmail: String(row.paypal_email), passwordHash: String(row.password_hash)
});
exports.toUser = toUser;
