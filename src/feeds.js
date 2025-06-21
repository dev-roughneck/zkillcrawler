const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Use the shared database file in /data
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'botdata.sqlite');
const db = new Database(DB_FILE);

// Create the feeds table if it doesn't exist (snake_case column names)
db.prepare(`
  CREATE TABLE IF NOT EXISTS feeds (
    channel_id TEXT NOT NULL,
    feed_name TEXT NOT NULL,
    filters_json TEXT,
    PRIMARY KEY (channel_id, feed_name)
  )
`).run();

/**
 * Validate the filters object for supported structure, including AND/OR/IF logic modes.
 * @param {Object} filters
 * @returns {Object} - A cleaned, valid filters object.
 */
function validateFilters(filters) {
  const valid = {};
  if (!filters || typeof filters !== 'object') return valid;

  [
    'corporationIds',
    'characterIds',
    'allianceIds',
    'attackerCorporationIds',
    'attackerCharacterIds',
    'attackerAllianceIds',
    'regionIds',
    'systemIds',
    'shipTypeIds',
    'attackerShipTypeIds'
  ].forEach(key => {
    if (Array.isArray(filters[key])) {
      valid[key] = filters[key].filter(id => typeof id === 'number');
    }
    const modeKey = `${key}Mode`;
    if (typeof filters[modeKey] === 'string' && ['AND', 'OR', 'IF'].includes(filters[modeKey])) {
      valid[modeKey] = filters[modeKey];
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
  if (Array.isArray(filters.regions)) {
    valid.regions = filters.regions.filter(s => typeof s === 'string');
  }

  return valid;
}

/**
 * Get all feeds for a specific channel.
 * @param {string} channelId
 * @returns {Object} feedName -> {filters}
 */
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

/**
 * Get all feeds as a flat array.
 * @returns {Array} [{channel_id, feed_name, filters}]
 */
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

/**
 * Check if a feed exists.
 * @param {string} channelId
 * @param {string} feedName
 * @returns {boolean}
 */
function feedExists(channelId, feedName) {
  const row = db.prepare(
    'SELECT 1 FROM feeds WHERE channel_id = ? AND feed_name = ?'
  ).get(channelId, feedName);
  return !!row;
}

/**
 * Set or update a feed.
 * @param {string} channelId
 * @param {string} feedName
 * @param {Object} feedObj
 */
function setFeed(channelId, feedName, feedObj) {
  const safeFilters = validateFilters(feedObj.filters || {});
  db.prepare(`
    INSERT INTO feeds (channel_id, feed_name, filters_json)
    VALUES (?, ?, ?)
    ON CONFLICT(channel_id, feed_name) DO UPDATE SET filters_json=excluded.filters_json
  `).run(channelId, feedName, JSON.stringify(safeFilters));
}

/**
 * Delete a feed.
 * @param {string} channelId
 * @param {string} feedName
 */
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
