/**
 * Determines if a killmail matches the given filters.
 * Supports AND/OR/IF logic modes for each filter array.
 *
 * @param {Object} killmail - The killmail object from RedisQ/zkillboard, normalized/flattened.
 * @param {Object} filters - The normalized filters object.
 * @returns {boolean} True if the killmail matches the filters, false otherwise.
 */
function filterKillmail(killmail, filters) {
  // If filters is empty or all arrays are empty and all numbers undefined, match NOTHING
  const hasActiveFilters = Object.values(filters).some(
    v => (Array.isArray(v) && v.length > 0) || (typeof v === 'number')
  );
  if (!hasActiveFilters) return false; // only match if filters are set

  const victim = killmail.victim || {};
  const attackers = killmail.attackers || [];
  const zkb = killmail.zkb || {};

  // Helper to match a value against allowed IDs (if array is empty, pass)
  function matchId(val, arr) {
    if (!arr || arr.length === 0) return true;
    return arr.includes(val);
  }
  // Helper for 'AND' logic: all IDs in arr must match
  function matchAllIds(valArr, arr) {
    if (!arr || arr.length === 0) return true;
    return arr.every(id => valArr.includes(id));
  }
  // Helper for attacker array: get array of field values for all attackers
  function attackerFieldArray(field) {
    return attackers.map(a => a[field]).filter(x => x !== undefined);
  }

  // Victim filters
  const victimFilters = [
    { field: "regionIds",      value: killmail.region_id },
    { field: "systemIds",      value: killmail.solar_system_id },
    { field: "shipTypeIds",    value: victim.ship_type_id },
    { field: "allianceIds",    value: victim.alliance_id },
    { field: "corporationIds", value: victim.corporation_id },
    { field: "characterIds",   value: victim.character_id }
  ];

  for (const { field, value } of victimFilters) {
    const mode = filters[`${field}Mode`] || "OR";
    const arr = filters[field] || [];
    if (arr.length === 0) continue; // Ignore empty filters

    if (mode === "OR") {
      if (!arr.includes(value)) return false;
    }
    else if (mode === "AND") {
      // For victim, only one value possible, so treat as OR
      if (!arr.includes(value)) return false;
    }
    else if (mode === "IF") {
      // Only enforce if array is non-empty (already checked)
      if (!arr.includes(value)) return false;
    }
  }

  // Attacker filters: for each, apply OR/AND/IF logic
  const attackerFilterFields = [
    { filterKey: "attackerAllianceIds", field: "alliance_id" },
    { filterKey: "attackerCorporationIds", field: "corporation_id" },
    { filterKey: "attackerCharacterIds", field: "character_id" },
    { filterKey: "attackerShipTypeIds", field: "ship_type_id" }
  ];

  for (const { filterKey, field } of attackerFilterFields) {
    const arr = filters[filterKey] || [];
    if (arr.length === 0) continue;
    const mode = filters[`${filterKey}Mode`] || "OR";
    const attackerVals = attackerFieldArray(field);

    if (mode === "OR") {
      if (!attackerVals.some(val => arr.includes(val))) return false;
    } else if (mode === "AND") {
      // Every ID in arr must appear in at least one attacker
      if (!arr.every(id => attackerVals.includes(id))) return false;
    } else if (mode === "IF") {
      // Only enforce if array is non-empty (already checked)
      if (!attackerVals.some(val => arr.includes(val))) return false;
    }
  }

  // ISK value filters
  if (typeof filters.minValue === 'number' && zkb.totalValue !== undefined) {
    if (zkb.totalValue < filters.minValue) return false;
  }
  if (typeof filters.maxValue === 'number' && zkb.totalValue !== undefined) {
    if (zkb.totalValue > filters.maxValue) return false;
  }

  // Number of attackers
  if (typeof filters.minAttackers === 'number') {
    if (attackers.length < filters.minAttackers) return false;
  }
  if (typeof filters.maxAttackers === 'number') {
    if (attackers.length > filters.maxAttackers) return false;
  }

  return true;
}

module.exports = { filterKillmail };
