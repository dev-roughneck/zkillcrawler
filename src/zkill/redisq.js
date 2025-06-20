const fetch = require('node-fetch');

/**
 * Polls the new community RedisQ API for killmails and calls your handler for each one.
 * @param {function} handler - Callback for each killmail.
 */
async function listenToRedisQ(handler) {
  const queueId = 'misery engine'; // your queue ID
  while (true) {
    try {
      const response = await fetch('https://zkillredisq.stream/listen.php?queueID=' + encodeURIComponent(queueId));
      const data = await response.json();
      if (data && data.package && Object.keys(data.package).length > 0) {
        await handler(data.package);
      }
    } catch (e) {
      console.error('[RedisQ] Error:', e);
      // Wait before retrying to avoid hammering the endpoint
      await new Promise(res => setTimeout(res, 5000));
    }
  }
}

module.exports = { listenToRedisQ };
