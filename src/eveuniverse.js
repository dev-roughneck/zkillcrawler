// EVE Universe Entity Resolver with logging, retries, in-memory cache, and reverse ID/name lookup

let fetchFn;
try {
  fetchFn = fetch; // Node 18+
} catch (e) {
  fetchFn = require('node-fetch');
}

const ESI_BASE = 'https://esi.evetech.net/latest';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

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

// --- ESI Resolvers ---

// /universe/names/ POST { [id] }
async function resolveESIById(id) {
  if (!id) return null;
  const ckey = cacheKey('id', id);
  const cached = getCache('id', id);
  if (cached) return cached;

  const url = `${ESI_BASE}/universe/names/`;
  const body = JSON.stringify([Number(id)]);
  const data = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (Array.isArray(data) && data.length > 0) {
    setCache('id', id, data[0]);
    return data[0];
  }
  return null;
}

// /search/?categories=...&search=...&strict=true
async function resolveESIByName(name, category) {
  if (!name || !category) return null;
  const ckey = cacheKey(category, name.toLowerCase());
  const cached = getCache(category, name.toLowerCase());
  if (cached) return cached;

  const url = `${ESI_BASE}/search/?categories=${category}&search=${encodeURIComponent(name)}&strict=true`;
  const data = await fetchWithRetry(url);
  if (data && data[category] && data[category].length > 0) {
    const id = data[category][0];
    const entity = await resolveESIById(id);
    setCache(category, name.toLowerCase(), entity);
    return entity;
  }
  return null;
}

// --- Reverse resolvers: try to get ID from a name if direct lookup fails ---

// For alliance/corp/char/region/system/shiptype, reverse search if direct fails
async function reverseAlliance(nameOrId) {
  // Try to resolve by name strictly, then fallback to fuzzy
  if (!nameOrId) return null;
  const ckey = cacheKey('alliance', nameOrId);
  let cached = getCache('alliance', nameOrId);
  if (cached) return cached;

  // Try strict search
  let entity = await resolveESIByName(nameOrId, 'alliance');
  if (entity && entity.category === 'alliance') {
    setCache('alliance', nameOrId, { id: entity.id, name: entity.name });
    return { id: entity.id, name: entity.name };
  }
  // Try fuzzy search
  const url = `${ESI_BASE}/search/?categories=alliance&search=${encodeURIComponent(nameOrId)}&strict=false`;
  const data = await fetchWithRetry(url);
  if (data && data.alliance && data.alliance.length > 0) {
    let id = data.alliance[0];
    entity = await resolveESIById(id);
    if (entity && entity.category === 'alliance') {
      setCache('alliance', nameOrId, { id: entity.id, name: entity.name });
      return { id: entity.id, name: entity.name };
    }
  }
  return null;
}
async function reverseCorporation(nameOrId) {
  if (!nameOrId) return null;
  const ckey = cacheKey('corporation', nameOrId);
  let cached = getCache('corporation', nameOrId);
  if (cached) return cached;

  let entity = await resolveESIByName(nameOrId, 'corporation');
  if (entity && entity.category === 'corporation') {
    setCache('corporation', nameOrId, { id: entity.id, name: entity.name });
    return { id: entity.id, name: entity.name };
  }
  const url = `${ESI_BASE}/search/?categories=corporation&search=${encodeURIComponent(nameOrId)}&strict=false`;
  const data = await fetchWithRetry(url);
  if (data && data.corporation && data.corporation.length > 0) {
    let id = data.corporation[0];
    entity = await resolveESIById(id);
    if (entity && entity.category === 'corporation') {
      setCache('corporation', nameOrId, { id: entity.id, name: entity.name });
      return { id: entity.id, name: entity.name };
    }
  }
  return null;
}
async function reverseCharacter(nameOrId) {
  if (!nameOrId) return null;
  const ckey = cacheKey('character', nameOrId);
  let cached = getCache('character', nameOrId);
  if (cached) return cached;

  let entity = await resolveESIByName(nameOrId, 'character');
  if (entity && entity.category === 'character') {
    setCache('character', nameOrId, { id: entity.id, name: entity.name });
    return { id: entity.id, name: entity.name };
  }
  const url = `${ESI_BASE}/search/?categories=character&search=${encodeURIComponent(nameOrId)}&strict=false`;
  const data = await fetchWithRetry(url);
  if (data && data.character && data.character.length > 0) {
    let id = data.character[0];
    entity = await resolveESIById(id);
    if (entity && entity.category === 'character') {
      setCache('character', nameOrId, { id: entity.id, name: entity.name });
      return { id: entity.id, name: entity.name };
    }
  }
  return null;
}
async function reverseRegion(nameOrId) {
  if (!nameOrId) return null;
  const ckey = cacheKey('region', nameOrId);
  let cached = getCache('region', nameOrId);
  if (cached) return cached;

  let entity = await resolveESIByName(nameOrId, 'region');
  if (entity && entity.category === 'region') {
    setCache('region', nameOrId, { id: entity.id, name: entity.name });
    return { id: entity.id, name: entity.name };
  }
  const url = `${ESI_BASE}/search/?categories=region&search=${encodeURIComponent(nameOrId)}&strict=false`;
  const data = await fetchWithRetry(url);
  if (data && data.region && data.region.length > 0) {
    let id = data.region[0];
    entity = await resolveESIById(id);
    if (entity && entity.category === 'region') {
      setCache('region', nameOrId, { id: entity.id, name: entity.name });
      return { id: entity.id, name: entity.name };
    }
  }
  return null;
}
async function reverseSystem(nameOrId) {
  if (!nameOrId) return null;
  const ckey = cacheKey('solar_system', nameOrId);
  let cached = getCache('solar_system', nameOrId);
  if (cached) return cached;

  let entity = await resolveESIByName(nameOrId, 'solar_system');
  if (entity && entity.category === 'solar_system') {
    setCache('solar_system', nameOrId, { id: entity.id, name: entity.name });
    return { id: entity.id, name: entity.name };
  }
  const url = `${ESI_BASE}/search/?categories=solar_system&search=${encodeURIComponent(nameOrId)}&strict=false`;
  const data = await fetchWithRetry(url);
  if (data && data.solar_system && data.solar_system.length > 0) {
    let id = data.solar_system[0];
    entity = await resolveESIById(id);
    if (entity && entity.category === 'solar_system') {
      setCache('solar_system', nameOrId, { id: entity.id, name: entity.name });
      return { id: entity.id, name: entity.name };
    }
  }
  return null;
}
async function reverseShipType(nameOrId) {
  if (!nameOrId) return null;
  const ckey = cacheKey('shiptype', nameOrId);
  let cached = getCache('shiptype', nameOrId);
  if (cached) return cached;

  // Try strict
  let entity = await resolveShipType(nameOrId);
  if (entity) {
    setCache('shiptype', nameOrId, entity);
    return entity;
  }
  // Try fuzzy
  const url = `${ESI_BASE}/search/?categories=inventory_type&search=${encodeURIComponent(nameOrId)}&strict=false`;
  const data = await fetchWithRetry(url);
  if (data && data.inventory_type && data.inventory_type.length > 0) {
    for (const typeId of data.inventory_type) {
      const t = await fetchWithRetry(`${ESI_BASE}/universe/types/${typeId}/`);
      if (t && t.category_id === 6) {
        const result = { id: t.type_id, name: t.name };
        setCache('shiptype', nameOrId, result);
        return result;
      }
    }
  }
  return null;
}

// --- Entity-specific functions ---

async function resolveAlliance(input) {
  if (!input) {
    console.warn('[EVEU] resolveAlliance: input missing');
    return null;
  }
  try {
    if (/^\d+$/.test(input)) {
      const data = await resolveESIById(input);
      if (data && data.category === 'alliance') return { id: data.id, name: data.name };
      // Try reverse search after failed direct lookup
      return await reverseAlliance(input);
    }
    const data = await resolveESIByName(input, 'alliance');
    if (data && data.category === 'alliance') return { id: data.id, name: data.name };
    // Try reverse search after failed direct lookup
    return await reverseAlliance(input);
  } catch (e) {
    console.error('[EVEU] resolveAlliance error', input, e);
    return null;
  }
}

async function resolveCorporation(input) {
  if (!input) {
    console.warn('[EVEU] resolveCorporation: input missing');
    return null;
  }
  try {
    if (/^\d+$/.test(input)) {
      const data = await resolveESIById(input);
      if (data && data.category === 'corporation') return { id: data.id, name: data.name };
      // Try reverse search after failed direct lookup
      return await reverseCorporation(input);
    }
    const data = await resolveESIByName(input, 'corporation');
    if (data && data.category === 'corporation') return { id: data.id, name: data.name };
    // Try reverse search after failed direct lookup
    return await reverseCorporation(input);
  } catch (e) {
    console.error('[EVEU] resolveCorporation error', input, e);
    return null;
  }
}

async function resolveCharacter(input) {
  if (!input) {
    console.warn('[EVEU] resolveCharacter: input missing');
    return null;
  }
  try {
    if (/^\d+$/.test(input)) {
      const data = await resolveESIById(input);
      if (data && data.category === 'character') return { id: data.id, name: data.name };
      // Try reverse search after failed direct lookup
      return await reverseCharacter(input);
    }
    const data = await resolveESIByName(input, 'character');
    if (data && data.category === 'character') return { id: data.id, name: data.name };
    // Try reverse search after failed direct lookup
    return await reverseCharacter(input);
  } catch (e) {
    console.error('[EVEU] resolveCharacter error', input, e);
    return null;
  }
}

async function resolveRegion(input) {
  if (!input) {
    console.warn('[EVEU] resolveRegion: input missing');
    return null;
  }
  try {
    if (/^\d+$/.test(input)) {
      const data = await resolveESIById(input);
      if (data && data.category === 'region') return { id: data.id, name: data.name };
      // Try reverse search after failed direct lookup
      return await reverseRegion(input);
    }
    const data = await resolveESIByName(input, 'region');
    if (data && data.category === 'region') return { id: data.id, name: data.name };
    // Try reverse search after failed direct lookup
    return await reverseRegion(input);
  } catch (e) {
    console.error('[EVEU] resolveRegion error', input, e);
    return null;
  }
}

async function resolveSystem(input) {
  if (!input) {
    console.warn('[EVEU] resolveSystem: input missing');
    return null;
  }
  try {
    if (/^\d+$/.test(input)) {
      const data = await resolveESIById(input);
      if (data && data.category === 'solar_system') return { id: data.id, name: data.name };
      // Try reverse search after failed direct lookup
      return await reverseSystem(input);
    }
    const data = await resolveESIByName(input, 'solar_system');
    if (data && data.category === 'solar_system') return { id: data.id, name: data.name };
    // Try reverse search after failed direct lookup
    return await reverseSystem(input);
  } catch (e) {
    console.error('[EVEU] resolveSystem error', input, e);
    return null;
  }
}

async function resolveShipType(input) {
  if (!input) {
    console.warn('[EVEU] resolveShipType: input missing');
    return null;
  }
  try {
    // Direct ID lookup
    if (/^\d+$/.test(input)) {
      const ckey = cacheKey('shiptype', input);
      const cached = getCache('shiptype', input);
      if (cached) return cached;
      // ESI doesn't return category for type_id, so we fetch the type info
      const url = `${ESI_BASE}/universe/types/${input}/`;
      const data = await fetchWithRetry(url);
      if (data && data.category_id === 6) {
        const result = { id: data.type_id, name: data.name };
        setCache('shiptype', input, result);
        return result;
      }
      // Try reverse search after failed direct lookup
      return await reverseShipType(input);
    }
    // Fuzzy search in /search/ for 'inventory_type'
    const ckey = cacheKey('shiptype', input.toLowerCase());
    const cached = getCache('shiptype', input.toLowerCase());
    if (cached) return cached;
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
    // Try reverse search after failed direct lookup
    return await reverseShipType(input);
  } catch (e) {
    console.error('[EVEU] resolveShipType error', input, e);
    return null;
  }
}

// --- Bulk Resolve Helper ---
async function resolveIds(input, type) {
  if (!input) return [];
  const entries = input.split(',').map(s => s.trim()).filter(Boolean);
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
    if (obj && obj.id) ids.push(obj.id);
  }
  return ids;
}

module.exports = {
  resolveAlliance,
  resolveCorporation,
  resolveCharacter,
  resolveRegion,
  resolveSystem,
  resolveShipType,
  resolveIds,
  reverseAlliance,
  reverseCorporation,
  reverseCharacter,
  reverseRegion,
  reverseSystem,
  reverseShipType,
};
