const fetch = require('node-fetch');

/**
 * Polls the RedisQ API for killmails and calls your handler for each one.
 * @param {string} feedName - The name of the RedisQ queue.
 * @param {function} handler - Callback for each killmail.
 */
async function listenToRedisQ(feedName, handler) {
  while (true) {
    try {
      const response = await fetch('https://redisq.zkillboard.com/listen.php?queue=' + encodeURIComponent(feedName));
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
