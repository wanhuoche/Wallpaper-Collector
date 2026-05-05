const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'app.db');

// 确保 data 目录存在
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// WAL 模式提升并发性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 初始化表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT    UNIQUE NOT NULL,
    email      TEXT    UNIQUE NOT NULL,
    password   TEXT    NOT NULL,
    avatar     TEXT    DEFAULT NULL,
    created_at TEXT    DEFAULT (datetime('now')),
    updated_at TEXT    DEFAULT (datetime('now'))
  );
`);

module.exports = db;
