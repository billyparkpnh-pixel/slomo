import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { TABLES } from './tables.js';

export function openDatabase(directory) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const path=join(directory,'slomo.sqlite');
  const db=new DatabaseSync(path);
  chmodSync(path,0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS tables (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
      capacity INTEGER NOT NULL, minimum TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY, reference TEXT UNIQUE NOT NULL, date TEXT NOT NULL,
      table_id TEXT NOT NULL REFERENCES tables(id), guests INTEGER NOT NULL,
      name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL,
      minimum TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed',
      manage_hash TEXT NOT NULL, request_key TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_booking_per_table_date ON bookings(date,table_id) WHERE status='confirmed';
    CREATE TABLE IF NOT EXISTS holds (
      date TEXT NOT NULL, table_id TEXT NOT NULL REFERENCES tables(id), blocked INTEGER NOT NULL,
      PRIMARY KEY(date,table_id)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admins (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS email_outbox (
      id INTEGER PRIMARY KEY, booking_id INTEGER REFERENCES bookings(id),
      recipient TEXT NOT NULL, subject TEXT NOT NULL, html TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      sent_at TEXT
    );
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
  `);
  const insert=db.prepare('INSERT OR IGNORE INTO tables(id,type,x,y,capacity,minimum) VALUES (?,?,?,?,?,?)');
  for(const t of TABLES) insert.run(t.id,t.type,t.x,t.y,t.capacity,t.minimum);
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('DELETE FROM rate_limits WHERE expires < ?').run(Date.now());
  return db;
}

export function settings(db) {
  const saved=Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value]));
  return {venueName:'SLOMO',phone:'+855 87 330 003',address:'Street 55, Boeung Raing, Phnom Penh',logoUrl:'',heroVideoUrl:'',...saved};
}
