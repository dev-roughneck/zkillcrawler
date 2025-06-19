let fetchFn;
try {
  fetchFn = fetch; // Node 18+
} catch (e) {
  fetchFn = require('node-fetch');
}

const ESI_BASE = 'https://esi.evetech.net/latest';

// Helper to resolve a numeric ID to a name/type/category using /universe/names/
async function resolveESIById(id) {
  const res = await fetchFn(`${ESI_BASE}/universe/names/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([Number(id)]),
  });
  if (!res.ok) throw new Error(`ESI error: ${res.status}`);
  const data = await res.json();
  return data && data.length > 0 ? data[0] : null;
}

// Helper to resolve a name to ID using ESI /search/
async function resolveESIByName(name, category) {
  const res = await fetchFn(
    `${ESI_BASE}/search/?categories=${category}&search=${encodeURIComponent(name)}&strict=true`
  );
  if (!res.ok) throw new Error(`ESI error: ${res.status}`);
  const data = await res.json();
  if (data && data[category] && data[category].length > 0) {
    const id = data[category][0];
    return resolveESIById(id);
  }
  return null;
}

// Entity resolvers

async function resolveAlliance(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    const data = await resolveESIById(input);
    if (data && data.category === 'alliance') return { id: data.id, name: data.name };
    return null;
  }
  // Lookup by name
  const data = await resolveESIByName(input, 'alliance');
  if (data && data.category === 'alliance') return { id: data.id, name: data.name };
  return null;
}

async function resolveCorporation(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    const data = await resolveESIById(input);
    if (data && data.category === 'corporation') return { id: data.id, name: data.name };
    return null;
  }
  const data = await resolveESIByName(input, 'corporation');
  if (data && data.category === 'corporation') return { id: data.id, name: data.name };
  return null;
}

async function resolveCharacter(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    const data = await resolveESIById(input);
    if (data && data.category === 'character') return { id: data.id, name: data.name };
    return null;
  }
  const data = await resolveESIByName(input, 'character');
  if (data && data.category === 'character') return { id: data.id, name: data.name };
  return null;
}

async function resolveRegion(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    const data = await resolveESIById(input);
    if (data && data.category === 'region') return { id: data.id, name: data.name };
    return null;
  }
  const data = await resolveESIByName(input, 'region');
  if (data && data.category === 'region') return { id: data.id, name: data.name };
  return null;
}

async function resolveSystem(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    const data = await resolveESIById(input);
    if (data && data.category === 'solar_system') return { id: data.id, name: data.name };
    return null;
  }
  const data = await resolveESIByName(input, 'solar_system');
  if (data && data.category === 'solar_system') return { id: data.id, name: data.name };
  return null;
}

async function resolveShipType(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    // ESI doesn't return category for type_id, so we fetch the type info
    const res = await fetchFn(`${ESI_BASE}/universe/types/${input}/`);
    if (!res.ok) return null;
    const data = await res.json();
    // Category 6 = Ship
    if (data && data.category_id === 6) return { id: data.type_id, name: data.name };
    return null;
  }
  // Fuzzy search (strict=false) in /search/ for 'inventory_type'
  const res = await fetchFn(
    `${ESI_BASE}/search/?categories=inventory_type&search=${encodeURIComponent(input)}&strict=false`
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (data && data.inventory_type && data.inventory_type.length > 0) {
    for (const typeId of data.inventory_type) {
      const res2 = await fetchFn(`${ESI_BASE}/universe/types/${typeId}/`);
      if (!res2.ok) continue;
      const t = await res2.json();
      if (t.category_id === 6) return { id: t.type_id, name: t.name };
    }
  }
  return null;
}

module.exports = {
  resolveAlliance,
  resolveCorporation,
  resolveCharacter,
  resolveRegion,
  resolveSystem,
  resolveShipType,
};
