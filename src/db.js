const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'botdata.sqlite');
const db = new Database(DB_PATH);

// Feed definitions
db.exec(`
CREATE TABLE IF NOT EXISTS feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  feed_name TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  UNIQUE(channel_id, feed_name)
);
`);

// Eve Universe persistent cache
db.exec(`
CREATE TABLE IF NOT EXISTS eve_cache (
  endpoint TEXT NOT NULL,
  query TEXT NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY(endpoint, query)
);
`);

module.exports = db;
