/**
 * Determines if a killmail matches the given filters.
 * The filter object uses normalized fields (arrays for IDs, numbers for minisk/minattackers/maxattackers).
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

  // Region/system/shiptype filters (victim)
  if (!matchId(killmail.region_id, filters.region_id)) return false;
  if (!matchId(killmail.solar_system_id, filters.system_id)) return false;
  if (!matchId(victim.ship_type_id, filters.shiptype_id)) return false;

  // Alliance/corp/char filters (victim)
  if (!matchId(victim.alliance_id, filters.alliance_id)) return false;
  if (!matchId(victim.corporation_id, filters.corp_id)) return false;
  if (!matchId(victim.character_id, filters.character_id)) return false;

  // Attacker alliance/corp/char/shiptype filters (on any attacker)
  if (filters.attacker_alliance_id && filters.attacker_alliance_id.length > 0) {
    if (!attackers.some(a => matchId(a.alliance_id, filters.attacker_alliance_id))) return false;
  }
  if (filters.attacker_corp_id && filters.attacker_corp_id.length > 0) {
    if (!attackers.some(a => matchId(a.corporation_id, filters.attacker_corp_id))) return false;
  }
  if (filters.attacker_character_id && filters.attacker_character_id.length > 0) {
    if (!attackers.some(a => matchId(a.character_id, filters.attacker_character_id))) return false;
  }
  if (filters.attacker_shiptype_id && filters.attacker_shiptype_id.length > 0) {
    if (!attackers.some(a => matchId(a.ship_type_id, filters.attacker_shiptype_id))) return false;
  }

  // minisk (minimum ISK value)
  if (typeof filters.minisk === 'number' && zkb.totalValue !== undefined) {
    if (zkb.totalValue < filters.minisk) return false;
  }

  // minattackers / maxattackers (number of attackers)
  if (typeof filters.minattackers === 'number') {
    if (attackers.length < filters.minattackers) return false;
  }
  if (typeof filters.maxattackers === 'number') {
    if (attackers.length > filters.maxattackers) return false;
  }

  return true;
}

module.exports = { filterKillmail };
