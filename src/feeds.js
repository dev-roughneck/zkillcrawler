const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'botdata.sqlite');
const db = new Database(DB_FILE);

db.prepare(`
  CREATE TABLE IF NOT EXISTS feeds (
    channel_id TEXT NOT NULL,
    feed_name TEXT NOT NULL,
    filters_json TEXT,
    PRIMARY KEY (channel_id, feed_name)
  )
`).run();

// Only strictly match fields that are present and non-empty/undefined/NaN
function validateFilters(filters) {
  const valid = {};
  if (!filters || typeof filters !== 'object') return valid;

  // List the allowed fields and types
  [
    'corporationIds',
    'characterIds',
    'allianceIds',
    'attackerCorporationIds',
    'attackerCharacterIds',
    'attackerAllianceIds',
    'regionIds',
    'systemIds',
    'shipTypeIds'
  ].forEach(key => {
    if (Array.isArray(filters[key]) && filters[key].length > 0) {
      valid[key] = filters[key].filter(id => typeof id === 'number');
    }
  });

  if (typeof filters.minValue === 'number' && !isNaN(filters.minValue)) {
    valid.minValue = filters.minValue;
  }
  if (typeof filters.maxValue === 'number' && !isNaN(filters.maxValue)) {
    valid.maxValue = filters.maxValue;
  }
  if (typeof filters.minAttackers === 'number' && !isNaN(filters.minAttackers)) {
    valid.minAttackers = filters.minAttackers;
  }
  if (typeof filters.maxAttackers === 'number' && !isNaN(filters.maxAttackers)) {
    valid.maxAttackers = filters.maxAttackers;
  }
  if (
    Array.isArray(filters.securityClass) &&
    filters.securityClass.length > 0 &&
    filters.securityClass.every(x =>
      typeof x === "string" && ["highsec", "lowsec", "nullsec", "wh"].includes(x.toLowerCase())
    )
  ) {
    valid.securityClass = filters.securityClass.map(x => x.toLowerCase());
  }
  if (typeof filters.distanceFromSystemId === 'number' && !isNaN(filters.distanceFromSystemId)) {
    valid.distanceFromSystemId = filters.distanceFromSystemId;
  }
  if (typeof filters.maxDistanceLy === 'number' && !isNaN(filters.maxDistanceLy)) {
    valid.maxDistanceLy = filters.maxDistanceLy;
  }

  return valid;
}

function getFeeds(channelId) {
  const rows = db.prepare(
    'SELECT feed_name, filters_json FROM feeds WHERE channel_id = ?'
  ).all(channelId);
  const feeds = {};
  for (const row of rows) {
    feeds[row.feed_name] = { filters: validateFilters(JSON.parse(row.filters_json || '{}')) };
  }
  return feeds;
}

function getAllFeeds() {
  const rows = db.prepare(
    'SELECT channel_id, feed_name, filters_json FROM feeds'
  ).all();
  return rows.map(row => ({
    channel_id: row.channel_id,
    feed_name: row.feed_name,
    filters: validateFilters(JSON.parse(row.filters_json || '{}'))
  }));
}

function feedExists(channelId, feedName) {
  const row = db.prepare(
    'SELECT 1 FROM feeds WHERE channel_id = ? AND feed_name = ?'
  ).get(channelId, feedName);
  return !!row;
}

function setFeed(channelId, feedName, feedObj) {
  const safeFilters = validateFilters(feedObj.filters || {});
  db.prepare(`
    INSERT INTO feeds (channel_id, feed_name, filters_json)
    VALUES (?, ?, ?)
    ON CONFLICT(channel_id, feed_name) DO UPDATE SET filters_json=excluded.filters_json
  `).run(channelId, feedName, JSON.stringify(safeFilters));
}

function deleteFeed(channelId, feedName) {
  db.prepare(
    'DELETE FROM feeds WHERE channel_id = ? AND feed_name = ?'
  ).run(channelId, feedName);
}

module.exports = {
  getFeeds,
  getAllFeeds,
  setFeed,
  deleteFeed,
  feedExists,
};
