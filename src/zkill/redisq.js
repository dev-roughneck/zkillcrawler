const fetch = require('node-fetch');

function listenToRedisQ(queueID, onKillmail) {
  async function poll() {
    try {
      const res = await fetch(`https://redisq.zkillboard.com/listen.php?queueID=${queueID}`);
      if (!res.ok) throw new Error(`RedisQ HTTP error: ${res.status}`);
      const data = await res.json();
      if (data && data.package && data.package.killID) {
        onKillmail(data.package);
      }
    } catch (err) {
      console.error('[REDISQ] Error polling RedisQ:', err);
    } finally {
      setTimeout(poll, 1000); // Poll every second
    }
  }
  poll();
}

module.exports = { listenToRedisQ };
