let fetchFn;
try {
  fetchFn = fetch; // Try native fetch (Node 18+)
} catch (e) {
  fetchFn = require('node-fetch'); // Fallback to node-fetch
}
const db = require('./db');

const BASE_URL = 'https://eveuniverse.app/api/';

function cacheGet(endpoint, queryOrId) {
  const row = db.prepare('SELECT data_json FROM eve_cache WHERE endpoint = ? AND query = ?')
    .get(endpoint, queryOrId || '');
  return row ? JSON.parse(row.data_json) : null;
}

function cacheSet(endpoint, queryOrId, data) {
  db.prepare('INSERT OR REPLACE INTO eve_cache (endpoint, query, data_json) VALUES (?, ?, ?)')
    .run(endpoint, queryOrId || '', JSON.stringify(data));
}

async function cachedFetch(endpoint, queryOrId, byId = false) {
  const cached = cacheGet(endpoint, queryOrId);
  if (cached) return cached;

  let url;
  if (byId) {
    url = BASE_URL + endpoint + `/${queryOrId}/`;
  } else {
    url = BASE_URL + endpoint + '/';
    if (queryOrId) url += `?name=${encodeURIComponent(queryOrId)}`;
  }

  let data = null;
  try {
    const res = await fetchFn(url);
    if (!res.ok) return null;
    data = await res.json();
    cacheSet(endpoint, queryOrId, data);
  } catch (err) {
    console.error('[EVEUNIVERSE] API error:', endpoint, queryOrId, err);
  }
  return data;
}

async function resolveRegion(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    const data = await cachedFetch('regions', input, true);
    return data && data.id ? data : null;
  }
  const data = await cachedFetch('regions', input);
  return data && data.items && data.items.length > 0 ? data.items[0] : null;
}

async function resolveSystem(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    const data = await cachedFetch('solar_systems', input, true);
    return data && data.id ? data : null;
  }
  const data = await cachedFetch('solar_systems', input);
  return data && data.items && data.items.length > 0 ? data.items[0] : null;
}

async function resolveShipType(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    const data = await cachedFetch('types', input, true);
    return data && data.id ? data : null;
  }
  const data = await cachedFetch('types', input);
  if (data && data.items && data.items.length > 0) {
    return data.items.find(t => t.category_id === 6 && t.published) || data.items[0];
  }
  return null;
}

async function resolveAlliance(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    const data = await cachedFetch('alliances', input, true);
    return data && data.id ? data : null;
  }
  const data = await cachedFetch('alliances', input);
  return data && data.items && data.items.length > 0 ? data.items[0] : null;
}

async function resolveCorporation(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    const data = await cachedFetch('corporations', input, true);
    return data && data.id ? data : null;
  }
  const data = await cachedFetch('corporations', input);
  return data && data.items && data.items.length > 0 ? data.items[0] : null;
}

async function resolveCharacter(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    const data = await cachedFetch('characters', input, true);
    return data && data.id ? data : null;
  }
  const data = await cachedFetch('characters', input);
  return data && data.items && data.items.length > 0 ? data.items[0] : null;
}

module.exports = {
  resolveRegion,
  resolveSystem,
  resolveShipType,
  resolveAlliance,
  resolveCorporation,
  resolveCharacter,
};
