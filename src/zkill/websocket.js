const WebSocket = require('ws');
const { filterKillmail } = require('./filter');

/**
 * Start a zKillboard WebSocket for a feed. Sends messages to channelObj.
 * @param {string} feedName - Name of the feed
 * @param {string} channelId - Discord channel ID
 * @param {object} filters - Normalized filter object
 * @param {object} channelObj - Discord.js channel object to send messages
 * @param {Map} liveWebsockets - Map for tracking active websockets
 */
function startZKillWebSocket(feedName, channelId, filters, channelObj, liveWebsockets) {
  const wsKey = `${channelId}:${feedName}`;
  if (liveWebsockets.has(wsKey)) {
    return;
  }
  const ws = new WebSocket('wss://zkillboard.com/websocket/');
  liveWebsockets.set(wsKey, ws);

  ws.on('open', () => {
    console.log(`[WS] Opened for ${wsKey}`);
    ws.send(JSON.stringify({ 'action': 'sub', 'channel': 'all' }));
  });

  ws.on('message', async data => {
    try {
      const killmail = JSON.parse(data);

      // ADDED LOGGING: show every killmail received
      console.log(`[ZKILL] Received killmail for feed "${feedName}" in channel ${channelId}:`);
      console.log(JSON.stringify(killmail, null, 2));

      if (!filterKillmail(killmail, filters)) {
        // ADDED LOGGING: show when a killmail is filtered out
        console.log(`[ZKILL] Killmail ${killmail.killmail_id} did not match filters for feed "${feedName}".`);
        return;
      }

      const link = `https://zkillboard.com/kill/${killmail.killmail_id}/`;

      // ADDED LOGGING: show when a killmail is sent to Discord
      console.log(`[ZKILL] Sending killmail ${killmail.killmail_id} to Discord channel ${channelId} for feed "${feedName}".`);

      await channelObj.send(`New killmail matching feed \`${feedName}\`!\n${link}`);
    } catch (e) {
      // ADDED LOGGING: catch and show parse errors or send errors
      console.error('[ZKILL] Error processing killmail:', e);
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Closed for ${wsKey}`);
    liveWebsockets.delete(wsKey);
  });

  ws.on('error', err => {
    console.error(`[WS] Error for ${wsKey}:`, err);
    liveWebsockets.delete(wsKey);
  });
}

function stopZKillWebSocket(feedName, channelId, liveWebsockets) {
  const wsKey = `${channelId}:${feedName}`;
  const ws = liveWebsockets.get(wsKey);
  if (ws) {
    ws.close();
    liveWebsockets.delete(wsKey);
  }
}

module.exports = { startZKillWebSocket, stopZKillWebSocket };
