/**
 * Determines if a killmail matches the given filters.
 * The filter object uses normalized fields (arrays for IDs, numbers for minValue/minAttackers/maxAttackers, etc).
 *
 * @param {Object} killmail - The killmail object from RedisQ/zkillboard.
 * @param {Object} filters - The normalized filters object.
 * @returns {boolean} True if the killmail matches the filters, false otherwise.
 */
function filterKillmail(killmail, filters) {
  // If filters is empty or all arrays are empty and all numbers undefined, match everything
  const hasActiveFilters = Object.values(filters).some(
    v => (Array.isArray(v) && v.length > 0) || (typeof v === 'number')
  );
  if (!hasActiveFilters) return true;

  const victim = killmail.victim || {};
  const attackers = killmail.attackers || [];
  const zkb = killmail.zkb || {};

  // Helper to match a value against allowed IDs (if array is empty, pass)
  function matchId(val, arr) {
    if (!arr || arr.length === 0) return true;
    return arr.includes(val);
  }

  // Victim filters
  if (filters.regionIds && !matchId(killmail.region_id, filters.regionIds)) return false;
  if (filters.systemIds && !matchId(killmail.solar_system_id, filters.systemIds)) return false;
  if (filters.shipTypeIds && !matchId(victim.ship_type_id, filters.shipTypeIds)) return false;

  if (filters.allianceIds && !matchId(victim.alliance_id, filters.allianceIds)) return false;
  if (filters.corporationIds && !matchId(victim.corporation_id, filters.corporationIds)) return false;
  if (filters.characterIds && !matchId(victim.character_id, filters.characterIds)) return false;

  // Attacker filters (at least one attacker must match if filter set)
  if (filters.attackerAllianceIds && filters.attackerAllianceIds.length > 0) {
    if (!attackers.some(a => matchId(a.alliance_id, filters.attackerAllianceIds))) return false;
  }
  if (filters.attackerCorporationIds && filters.attackerCorporationIds.length > 0) {
    if (!attackers.some(a => matchId(a.corporation_id, filters.attackerCorporationIds))) return false;
  }
  if (filters.attackerCharacterIds && filters.attackerCharacterIds.length > 0) {
    if (!attackers.some(a => matchId(a.character_id, filters.attackerCharacterIds))) return false;
  }
  if (filters.attackerShipTypeIds && filters.attackerShipTypeIds.length > 0) {
    if (!attackers.some(a => matchId(a.ship_type_id, filters.attackerShipTypeIds))) return false;
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
