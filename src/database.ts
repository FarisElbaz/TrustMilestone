import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type Role = "client" | "worker" | "reviewer";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  paypalEmail: string;
  passwordHash: string;
}

export interface CaseRecord {
  id: string;
  ownerId: number;
  workerId: number;
  brief: string;
  stack: string;
  status: string;
}

let database: Database.Database | undefined;

export function getDatabase(): Database.Database {
  if (database) return database;
  const filename = process.env.DATABASE_PATH ?? path.resolve("data", "delivery-verifier.sqlite");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  database = new Database(filename);
  migrate(database);
  return database;
}

export function migrate(db = getDatabase()): void {
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

export function closeDatabase(): void {
  database?.close();
  database = undefined;
}

export const now = (): string => new Date().toISOString();
export const toUser = (row: Record<string, unknown>): User => ({
  id: Number(row.id), email: String(row.email), name: String(row.name),
  role: row.role as Role, paypalEmail: String(row.paypal_email), passwordHash: String(row.password_hash)
});
