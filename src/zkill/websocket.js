const WebSocket = require('ws');
const { filterKillmail } = require('./filter');

function startZKillWebSocket(feedName, channelId, filters, channelObj, liveWebsockets) {
  const wsKey = `${channelId}:${feedName}`;
  if (liveWebsockets.has(wsKey)) {
    return;
  }
  const ws = new WebSocket('wss://zkillboard.com/websocket/');
  liveWebsockets.set(wsKey, ws);

  ws.on('open', () => {
    console.log(`[WS] Opened for ${wsKey}`);
    ws.send(JSON.stringify({ 'action': 'sub', 'channel': 'killstream' }));
  });

  ws.on('message', async data => {
    try {
      const killmail = JSON.parse(data);
      if (!filterKillmail(killmail, filters)) return;
      const link = `https://zkillboard.com/kill/${killmail.killmail_id}/`;
      await channelObj.send(`New killmail matching feed \`${feedName}\`!\n${link}`);
    } catch (e) {
      // Ignore parse errors
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