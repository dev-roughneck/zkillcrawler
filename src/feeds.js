const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Use the shared database file in /data
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'botdata.sqlite');
const db = new Database(DB_FILE);

// Create the feeds table if it doesn't exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS feeds (
    channelId TEXT NOT NULL,
    feedName TEXT NOT NULL,
    filters TEXT,
    PRIMARY KEY (channelId, feedName)
  )
`).run();

/**
 * Validate the filters object for supported structure.
 * @param {Object} filters
 * @returns {Object} - A cleaned, valid filters object.
 */
function validateFilters(filters) {
  const valid = {};
  if (!filters || typeof filters !== 'object') return valid;

  if (Array.isArray(filters.corporationIds)) {
    valid.corporationIds = filters.corporationIds.filter(id => typeof id === 'number');
  }
  if (Array.isArray(filters.characterIds)) {
    valid.characterIds = filters.characterIds.filter(id => typeof id === 'number');
  }
  if (typeof filters.minValue === 'number' && !isNaN(filters.minValue)) {
    valid.minValue = filters.minValue;
  }
  if (Array.isArray(filters.regions)) {
    valid.regions = filters.regions.filter(s => typeof s === 'string');
  }
  // Add more filter validations as needed

  return valid;
}

/**
 * Get all feeds for a specific channel.
 * @param {string} channelId
 * @returns {Object} feedName -> {filters}
 */
function getFeeds(channelId) {
  const rows = db.prepare(
    'SELECT feedName, filters FROM feeds WHERE channelId = ?'
  ).all(channelId);
  const feeds = {};
  for (const row of rows) {
    feeds[row.feedName] = { filters: validateFilters(JSON.parse(row.filters || '{}')) };
  }
  return feeds;
}

/**
 * Get all feeds as a flat array.
 * @returns {Array} [{channelId, feedName, filters}]
 */
function getAllFeeds() {
  const rows = db.prepare(
    'SELECT channelId, feedName, filters FROM feeds'
  ).all();
  return rows.map(row => ({
    channelId: row.channelId,
    feedName: row.feedName,
    filters: validateFilters(JSON.parse(row.filters || '{}'))
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
    'SELECT 1 FROM feeds WHERE channelId = ? AND feedName = ?'
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
    INSERT INTO feeds (channelId, feedName, filters)
    VALUES (?, ?, ?)
    ON CONFLICT(channelId, feedName) DO UPDATE SET filters=excluded.filters
  `).run(channelId, feedName, JSON.stringify(safeFilters));
}

/**
 * Delete a feed.
 * @param {string} channelId
 * @param {string} feedName
 */
function deleteFeed(channelId, feedName) {
  db.prepare(
    'DELETE FROM feeds WHERE channelId = ? AND feedName = ?'
  ).run(channelId, feedName);
}

module.exports = {
  getFeeds,
  getAllFeeds,
  setFeed,
  deleteFeed,
  feedExists,
};
