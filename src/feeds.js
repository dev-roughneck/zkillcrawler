const path = require('path');
const Database = require('better-sqlite3');

// Location of the feeds database file
const DB_FILE = path.join(__dirname, 'feeds.db');
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
    feeds[row.feedName] = { filters: JSON.parse(row.filters || '{}') };
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
    filters: JSON.parse(row.filters || '{}')
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
  db.prepare(`
    INSERT INTO feeds (channelId, feedName, filters)
    VALUES (?, ?, ?)
    ON CONFLICT(channelId, feedName) DO UPDATE SET filters=excluded.filters
  `).run(channelId, feedName, JSON.stringify(feedObj.filters || {}));
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
