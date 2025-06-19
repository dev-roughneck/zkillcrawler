const db = require('./db');

function getFeeds(channelId) {
  const rows = db.prepare('SELECT feed_name, filters_json FROM feeds WHERE channel_id = ?').all(channelId);
  const feeds = {};
  for (const row of rows) {
    feeds[row.feed_name] = { filters: JSON.parse(row.filters_json) };
  }
  return feeds;
}

function getFeed(channelId, feedName) {
  const row = db.prepare('SELECT filters_json FROM feeds WHERE channel_id = ? AND feed_name = ?').get(channelId, feedName);
  return row ? { filters: JSON.parse(row.filters_json) } : null;
}

function setFeed(channelId, feedName, data) {
  db.prepare(
    'INSERT INTO feeds (channel_id, feed_name, filters_json) VALUES (?, ?, ?) ON CONFLICT(channel_id, feed_name) DO UPDATE SET filters_json = excluded.filters_json'
  ).run(channelId, feedName, JSON.stringify(data.filters));
}

function deleteFeed(channelId, feedName) {
  db.prepare('DELETE FROM feeds WHERE channel_id = ? AND feed_name = ?').run(channelId, feedName);
}

function listFeeds(channelId) {
  const rows = db.prepare('SELECT feed_name FROM feeds WHERE channel_id = ?').all(channelId);
  return rows.map(r => r.feed_name);
}

// Returns true if the feed with this name exists for this channel
function feedExists(channelId, feedName) {
  const row = db.prepare('SELECT 1 FROM feeds WHERE channel_id = ? AND feed_name = ?').get(channelId, feedName);
  return !!row;
}

// Kept for API compatibility, no-op
function reloadFeeds() {}

module.exports = { getFeeds, getFeed, setFeed, deleteFeed, listFeeds, feedExists, reloadFeeds };
