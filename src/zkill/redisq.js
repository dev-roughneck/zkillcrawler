const fetch = require('node-fetch');

/**
 * Polls the new community RedisQ API for killmails and calls your handler for each one.
 * @param {function} handler - Callback for each killmail.
 */
async function listenToRedisQ(handler) {
  const queueId = 'misery engine'; // your queue ID
  while (true) {
    try {
      const response = await fetch('https://zkillredisq.stream/listen.php?queueID=' + encodeURIComponent(queueId), {
        timeout: 65000 // set a timeout in case the server hangs
      });
      if (!response.ok) {
        throw new Error(`[RedisQ] HTTP error: ${response.status}`);
      }
      const data = await response.json();
      if (data && data.package && Object.keys(data.package).length > 0) {
        try {
          await handler(data.package);
        } catch (err) {
          console.error('[RedisQ] Handler error:', err);
        }
      }
    } catch (e) {
      console.error('[RedisQ] Error:', e);
      // Wait before retrying to avoid hammering the endpoint
      await new Promise(res => setTimeout(res, 5000));
    }
  }
}

module.exports = { listenToRedisQ };
