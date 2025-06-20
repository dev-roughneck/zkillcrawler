const fetch = require('node-fetch');

function listenToRedisQ(queueID, onKillmail) {
  let delay = 1000; // start with 1 second
  const maxDelay = 10 * 60 * 1000; // up to 10 minutes
  let lastError = null;
  let lastErrorLogTime = 0;
  let started = false;

  async function poll() {
    if (!started) {
      console.log(`[REDISQ] Polling started with queueID: ${queueID}`);
      started = true;
    }
    try {
      const res = await fetch(`https://redisq.zkillboard.com/listen.php?queueID=${queueID}`);
      if (!res.ok) throw new Error(`RedisQ HTTP error: ${res.status}`);
      const data = await res.json();
      // Handles both killID (legacy) and killmail_id (ESI)
      if (data && data.package && (data.package.killID || data.package.killmail_id)) {
        console.log(`[REDISQ] Received killmail: ${data.package.killID || data.package.killmail_id}`);
        onKillmail(data.package);
      }
      delay = 1000; // reset delay on success
      lastError = null;
    } catch (err) {
      const now = Date.now();
      if (
        !lastError ||
        err.code !== lastError.code ||
        now - lastErrorLogTime > 5 * 60 * 1000
      ) {
        console.error('[REDISQ] Error polling RedisQ:', err);
        lastError = err;
        lastErrorLogTime = now;
      }
      // Exponential backoff
      delay = Math.min(delay * 2, maxDelay);
    } finally {
      setTimeout(poll, delay);
    }
  }
  poll();
}

module.exports = { listenToRedisQ };
