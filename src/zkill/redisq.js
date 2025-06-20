// src/zkill/redisq.js
const fetch = require('node-fetch');

// Store pollers globally, keyed by pollTag (e.g. `${channelId}-${feedName}`)
const activePolls = {};

/**
 * Listens to zKillboard RedisQ for killmail events.
 * @param {string} queueID - The RedisQ queue ID (pollTag, e.g. `${channelId}-${feedName}`).
 * @param {function} onKillmail - Callback for each killmail.
 */
function startRedisQPolling(queueID, onKillmail) {
  // If already polling, stop and restart
  if (activePolls[queueID]) {
    stopRedisQPolling(queueID);
  }
  let stopped = false;
  let delay = 1000;
  const maxDelay = 10 * 60 * 1000;
  let lastError = null;
  let lastErrorLogTime = 0;

  async function poll() {
    if (stopped) return;
    try {
      const res = await fetch(`https://zkillredisq.stream/listen.php?queueID=${queueID}`);
      if (!res.ok) throw new Error(`RedisQ HTTP error: ${res.status}`);
      const data = await res.json();
      if (data && data.package && (data.package.killID || data.package.killmail_id)) {
        console.log(`[REDISQ] (${queueID}) Received killmail: ${data.package.killID || data.package.killmail_id}`);
        onKillmail(data.package);
      }
      delay = 1000;
      lastError = null;
    } catch (err) {
      const now = Date.now();
      if (
        !lastError ||
        err.code !== lastError.code ||
        now - lastErrorLogTime > 5 * 60 * 1000
      ) {
        console.error(`[REDISQ] (${queueID}) Error polling RedisQ:`, err);
        lastError = err;
        lastErrorLogTime = now;
      }
      delay = Math.min(delay * 2, maxDelay);
    } finally {
      if (!stopped) {
        activePolls[queueID].timeout = setTimeout(poll, delay);
      }
    }
  }

  activePolls[queueID] = {
    stop() {
      stopped = true;
      if (activePolls[queueID].timeout) {
        clearTimeout(activePolls[queueID].timeout);
      }
      delete activePolls[queueID];
      console.log(`[REDISQ] (${queueID}) Polling stopped.`);
    },
    timeout: null,
  };

  poll();
}

/**
 * Stops polling for a given queueID (pollTag).
 * @param {string} queueID
 */
function stopRedisQPolling(queueID) {
  if (activePolls[queueID]) {
    activePolls[queueID].stop();
  }
}

module.exports = {
  listenToRedisQ: startRedisQPolling, // alias for backward compatibility
  startRedisQPolling,
  stopRedisQPolling,
  // Optionally export activePolls for debugging
};
