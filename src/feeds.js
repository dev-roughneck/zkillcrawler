const fs = require('fs');
const path = require('path');

const FEEDS_FILE = path.join(__dirname, 'feeds.json');

// Get feeds for a specific channel
function getFeeds(channelId) {
  const all = loadFeeds();
  return all[channelId] || {};
}

// Get all feeds as a flat array: { channelId, feedName, filters }
function getAllFeeds() {
  const all = loadFeeds();
  const flat = [];
  for (const channelId of Object.keys(all)) {
    for (const feedName of Object.keys(all[channelId])) {
      flat.push({ channelId, feedName, filters: all[channelId][feedName].filters });
    }
  }
  return flat;
}

function feedExists(channelId, feedName) {
  const all = loadFeeds();
  return all[channelId] && all[channelId][feedName];
}

function setFeed(channelId, feedName, feedObj) {
  const all = loadFeeds();
  if (!all[channelId]) all[channelId] = {};
  all[channelId][feedName] = feedObj;
  saveFeeds(all);
}

function deleteFeed(channelId, feedName) {
  const all = loadFeeds();
  if (all[channelId]) {
    delete all[channelId][feedName];
    if (Object.keys(all[channelId]).length === 0) delete all[channelId];
    saveFeeds(all);
  }
}

function loadFeeds() {
  if (!fs.existsSync(FEEDS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(FEEDS_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function saveFeeds(all) {
  fs.writeFileSync(FEEDS_FILE, JSON.stringify(all, null, 2));
}

module.exports = {
  getFeeds,
  getAllFeeds,
  setFeed,
  deleteFeed,
  feedExists,
};
