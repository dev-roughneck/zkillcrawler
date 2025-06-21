// EVE Universe Entity Resolver using batch POST endpoints and direct ESI for best practice

let fetchFn;
try {
  fetchFn = fetch; // Node 18+ has global fetch
} catch (e) {
  fetchFn = require('node-fetch');
}

const ESI_BASE = 'https://esi.evetech.net/latest';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const LY_IN_METERS = 9.4607e15;

// Simple in-memory cache { key: { value, expire } }
const cache = {};

function cacheKey(type, idOrName) {
  return `${type}:${idOrName}`.toLowerCase();
}
function setCache(type, idOrName, value) {
  cache[cacheKey(type, idOrName)] = { value, expire: Date.now() + CACHE_TTL };
}
function getCache(type, idOrName) {
  const entry = cache[cacheKey(type, idOrName)];
  if (entry && entry.expire > Date.now()) return entry.value;
  return null;
}

// --- Batch ESI helpers ---

// Batch resolve IDs to names (returns array of {category, id, name})
async function idsToNames(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const url = `${ESI_BASE}/universe/names/`;
  const data = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ids.map(Number)),
  });
  return Array.isArray(data) ? data : [];
}

// Batch resolve names to IDs (returns object: { characters: [], corporations: [], ... })
async function namesToIds(names) {
  if (!Array.isArray(names) || names.length === 0) return {};
  const url = `${ESI_BASE}/universe/ids/`;
  const data = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(names),
  });
  return typeof data === "object" && data !== null ? data : {};
}

// General fetch with retries and error logging
async function fetchWithRetry(url, options = {}, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchFn(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      if (attempt < retries) {
        const delay = 500 + Math.random() * 500;
        console.warn(`[EVEU] Retry ${attempt + 1} for ${url}: ${e.message}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error(`[EVEU] Failed after ${retries + 1} attempts: ${url}`, e);
        return null;
      }
    }
  }
}

// --- Resolvers: ID to Name ---

async function resolveById(id, category) {
  if (!id || !category) return null;
  const cached = getCache(category, id);
  if (cached) return cached;
  // Ships, systems, and regions have direct endpoints for more data
  if (category === 'shiptype') return await resolveShipType(id);
  if (category === 'solar_system') return await resolveSystem(id);
  if (category === 'region') return await resolveRegion(id);
  // Batch names for others
  const results = await idsToNames([id]);
  const entity = results.find(e => e.category === category && e.id == id);
  if (entity) {
    setCache(category, id, { id: entity.id, name: entity.name });
    return { id: entity.id, name: entity.name };
  }
  return null;
}

// --- Resolvers: Name to ID ---

async function resolveByName(name, category) {
  if (!name || !category) return null;
  const cached = getCache(category, name.toLowerCase());
  if (cached) return cached;
  const ids = await namesToIds([name]);
  if (!ids || !ids[category + 's'] || ids[category + 's'].length === 0) {
    console.warn(`[EVEU] namesToIds: No ${category} found for "${name}"`, ids);
  }
  if (ids && ids[category + 's'] && ids[category + 's'].length > 0) {
    const entity = ids[category + 's'][0];
    setCache(category, name.toLowerCase(), { id: entity.id, name: entity.name });
    return { id: entity.id, name: entity.name };
  }
  // Fallback to /search for fuzzy
  const url = `${ESI_BASE}/search/?categories=${category}&search=${encodeURIComponent(name)}&strict=false`;
  const data = await fetchWithRetry(url);
  if (!data || !data[category] || data[category].length === 0) {
    console.warn(`[EVEU] /search: No ${category} match for "${name}"`, data);
  }
  if (data && data[category] && data[category].length > 0) {
    const id = data[category][0];
    return await resolveById(id, category);
  }
  return null;
}

// --- Entity-specific functions ---

async function resolveAlliance(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) return await resolveById(input, 'alliance');
  return await resolveByName(input, 'alliance');
}
async function resolveCorporation(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) return await resolveById(input, 'corporation');
  return await resolveByName(input, 'corporation');
}
async function resolveCharacter(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) return await resolveById(input, 'character');
  return await resolveByName(input, 'character');
}
async function resolveRegion(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    // /universe/regions/{region_id}/
    const cached = getCache('region', input);
    if (cached) return cached;
    const url = `${ESI_BASE}/universe/regions/${input}/`;
    const data = await fetchWithRetry(url);
    if (data && data.region_id) {
      const result = { id: data.region_id, name: data.name };
      setCache('region', input, result);
      return result;
    }
    return null;
  }
  return await resolveByName(input, 'region');
}
async function resolveSystem(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    // /universe/systems/{system_id}/
    const cached = getCache('solar_system', input);
    if (cached) return cached;
    const url = `${ESI_BASE}/universe/systems/${input}/`;
    const data = await fetchWithRetry(url);
    if (data && data.solar_system_id) {
      const result = {
        id: data.solar_system_id,
        name: data.name,
        region_id: data.region_id,
        position: data.position,
        security_status: data.security_status ?? null, // << add this field!
      };
      setCache('solar_system', input, result);
      return result;
    }
    return null;
  }
  return await resolveByName(input, 'solar_system');
}
async function resolveShipType(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    // /universe/types/{type_id}/ to check for category_id === 6 (ship)
    const cached = getCache('shiptype', input);
    if (cached) return cached;
    const url = `${ESI_BASE}/universe/types/${input}/`;
    const data = await fetchWithRetry(url);
    if (data && data.category_id === 6) {
      const result = { id: data.type_id, name: data.name };
      setCache('shiptype', input, result);
      return result;
    }
    return null;
  }
  // For name, use inventory_type
  const cached = getCache('shiptype', input.toLowerCase());
  if (cached) return cached;
  // Try with namesToIds first
  const ids = await namesToIds([input]);
  if (ids && ids.inventory_types && ids.inventory_types.length > 0) {
    for (const typeObj of ids.inventory_types) {
      // For each inventory_type, check /universe/types/{id}/ for category_id === 6
      const t = await fetchWithRetry(`${ESI_BASE}/universe/types/${typeObj.id}/`);
      if (t && t.category_id === 6) {
        const result = { id: t.type_id, name: t.name };
        setCache('shiptype', input.toLowerCase(), result);
        return result;
      }
    }
  }
  // Fallback to /search for fuzzy
  const url = `${ESI_BASE}/search/?categories=inventory_type&search=${encodeURIComponent(input)}&strict=false`;
  const data = await fetchWithRetry(url);
  if (data && data.inventory_type && data.inventory_type.length > 0) {
    for (const typeId of data.inventory_type) {
      const t = await fetchWithRetry(`${ESI_BASE}/universe/types/${typeId}/`);
      if (t && t.category_id === 6) {
        const result = { id: t.type_id, name: t.name };
        setCache('shiptype', input.toLowerCase(), result);
        return result;
      }
    }
  }
  return null;
}

// --- Bulk resolve helpers ---
async function resolveIds(input, type) {
  if (!input || typeof input !== 'string') return [];
  const entries = input.split(',').map(s => s.trim()).filter(Boolean);
  if (entries.length === 0) return [];
  const ids = [];
  for (const entry of entries) {
    let obj = null;
    switch (type) {
      case 'corporation':
        obj = await resolveCorporation(entry); break;
      case 'character':
        obj = await resolveCharacter(entry); break;
      case 'alliance':
        obj = await resolveAlliance(entry); break;
      case 'region':
        obj = await resolveRegion(entry); break;
      case 'system':
        obj = await resolveSystem(entry); break;
      case 'shiptype':
        obj = await resolveShipType(entry); break;
      default:
        obj = null;
    }
    if (!obj) {
      console.warn(`[EVEU] Could not resolve ${type}: "${entry}"`);
    } else if (obj.id) {
      ids.push(obj.id);
    }
  }
  return ids;
}

// --- Utility for getting region_id from a system ---
async function getRegionIdForSystem(systemId) {
  if (!systemId) return null;
  const system = await resolveSystem(systemId);
  return system && system.region_id ? system.region_id : null;
}

// --- Utility: get system position (x, y, z) ---
async function getSystemPosition(systemId) {
  if (!systemId) return null;
  const system = await resolveSystem(systemId);
  if (system && system.position) return system.position;
  return null;
}

// --- Utility: Calculate lightyear distance between two systems ---
async function calculateLyDistance(systemIdA, systemIdB) {
  const posA = await getSystemPosition(systemIdA);
  const posB = await getSystemPosition(systemIdB);
  if (!posA || !posB) return null;
  const dx = posA.x - posB.x;
  const dy = posA.y - posB.y;
  const dz = posA.z - posB.z;
  const meters = Math.sqrt(dx*dx + dy*dy + dz*dz);
  return meters / LY_IN_METERS;
}

module.exports = {
  resolveAlliance,
  resolveCorporation,
  resolveCharacter,
  resolveRegion,
  resolveSystem,
  resolveShipType,
  resolveIds,
  idsToNames,
  namesToIds,
  getRegionIdForSystem,
  getSystemPosition,
  calculateLyDistance,
  LY_IN_METERS
};
