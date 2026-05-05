CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT    UNIQUE NOT NULL,
  email      TEXT    UNIQUE NOT NULL,
  password   TEXT    NOT NULL,
  avatar     TEXT    DEFAULT NULL,
  created_at TEXT    DEFAULT (datetime('now')),
  updated_at TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL,
  photo_id   TEXT    NOT NULL,
  photo_data TEXT    NOT NULL,
  created_at TEXT    DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, photo_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
