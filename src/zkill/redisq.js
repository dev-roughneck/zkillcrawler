const fetch = require('node-fetch');

/**
 * Start polling RedisQ for killmails and send to channelObj.
 * @param {string} feedName
 * @param {string} channelId
 * @param {object} filters
 * @param {object} channelObj - Discord.js channel object
 * @param {string} queueId - Unique queue ID for this feed/channel
 * @param {Map} livePolls - Map to store polling state for cleanup
 */
async function startRedisQPolling(feedName, channelId, filters, channelObj, queueId, livePolls) {
  let stopped = false;
  livePolls.set(`${channelId}:${feedName}`, () => { stopped = true; });

  async function poll() {
    while (!stopped) {
      try {
        const url = `https://redisq.zkillboard.com/listen.php?queueID=${queueId}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data && data.package && data.package.killID) {
          const killmail = data.package;
          console.log(`[REDISQ] Received killmail for feed "${feedName}" in channel ${channelId}:`);
          // Optional: console.log(JSON.stringify(killmail, null, 2));

          // Filter
          const { filterKillmail } = require('./filter');
          if (!filterKillmail(killmail, filters)) {
            console.log(`[REDISQ] Killmail ${killmail.killID} did not match filters for feed "${feedName}".`);
          } else {
            const link = `https://zkillboard.com/kill/${killmail.killID}/`;
            console.log(`[REDISQ] Sending killmail ${killmail.killID} to Discord channel ${channelId} for feed "${feedName}".`);
            await channelObj.send(`New killmail matching feed \`${feedName}\`!\n${link}`);
          }
        }
      } catch (e) {
        console.error('[REDISQ] Error polling RedisQ:', e);
      }
      // Wait 1 second before polling again (avoid hammering the API)
      await new Promise(res => setTimeout(res, 1000));
    }
    console.log(`[REDISQ] Polling stopped for ${channelId}:${feedName}`);
  }

  poll();
}

function stopRedisQPolling(feedName, channelId, livePolls) {
  const key = `${channelId}:${feedName}`;
  const stopFn = livePolls.get(key);
  if (stopFn) {
    stopFn();
    livePolls.delete(key);
  }
}

module.exports = { startRedisQPolling, stopRedisQPolling };
