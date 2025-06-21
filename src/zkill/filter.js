const { calculateLyDistance } = require('../eveuniverse');

/**
 * Filter a normalized killmail according to filters.
 * Only non-empty filter fields are applied.
 * This version uses strict matching: if a filter array is present and non-empty,
 * the killmail must match at least one value in the array (no logic modes).
 * @param {Object} killmail
 * @param {Object} filters
 * @returns {Promise<boolean>}
 */
async function filterKillmail(killmail, filters) {
  // Helper: returns true if the filter is empty (i.e. not used), or if target matches any in arr.
  function strictMatch(arr, target) {
    if (!arr || arr.length === 0) return true; // No filter, always match
    if (target == null) return false;
    if (Array.isArray(target)) {
      return arr.some(id => target.includes(id));
    }
    return arr.includes(target);
  }

  // Victim fields
  if (filters.corporationIds?.length > 0 &&
      !strictMatch(filters.corporationIds, killmail.victim.corporation_id)) return false;
  if (filters.characterIds?.length > 0 &&
      !strictMatch(filters.characterIds, killmail.victim.character_id)) return false;
  if (filters.allianceIds?.length > 0 &&
      !strictMatch(filters.allianceIds, killmail.victim.alliance_id)) return false;
  if (filters.regionIds?.length > 0 &&
      !strictMatch(filters.regionIds, killmail.region_id)) return false;
  if (filters.systemIds?.length > 0 &&
      !strictMatch(filters.systemIds, killmail.solar_system_id)) return false;
  if (filters.shipTypeIds?.length > 0 &&
      !strictMatch(filters.shipTypeIds, killmail.victim.ship_type_id)) return false;

  // Attacker-side filters (arrays of attackers)
  const attackers = killmail.attackers || [];
  if (filters.attackerCorporationIds?.length > 0) {
    const attackerCorpIds = attackers.map(a => a.corporation_id).filter(Boolean);
    if (!strictMatch(filters.attackerCorporationIds, attackerCorpIds)) return false;
  }
  if (filters.attackerCharacterIds?.length > 0) {
    const attackerCharIds = attackers.map(a => a.character_id).filter(Boolean);
    if (!strictMatch(filters.attackerCharacterIds, attackerCharIds)) return false;
  }
  if (filters.attackerAllianceIds?.length > 0) {
    const attackerAllianceIds = attackers.map(a => a.alliance_id).filter(Boolean);
    if (!strictMatch(filters.attackerAllianceIds, attackerAllianceIds)) return false;
  }

  // ISK value/attacker count filters (only if defined)
  if (typeof filters.minValue === 'number' && killmail.zkb?.totalValue < filters.minValue) return false;
  if (typeof filters.maxValue === 'number' && killmail.zkb?.totalValue > filters.maxValue) return false;
  if (typeof filters.minAttackers === 'number' && attackers.length < filters.minAttackers) return false;
  if (typeof filters.maxAttackers === 'number' && attackers.length > filters.maxAttackers) return false;

  // Security class filter
  if (Array.isArray(filters.securityClass) && filters.securityClass.length > 0) {
    let sec = typeof killmail.solar_system_security === 'number'
      ? killmail.solar_system_security
      : (killmail.system_security || 0);
    let secClass = 'nullsec';
    if (typeof sec === 'number') {
      if (sec >= 0.5) secClass = 'highsec';
      else if (sec >= 0.1) secClass = 'lowsec';
      else if (sec > -0.99) secClass = 'nullsec';
      else secClass = 'wh';
    }
    if (!filters.securityClass.includes(secClass)) return false;
  }

  // Lightyear distance filter
  if (
    typeof filters.distanceFromSystemId === 'number' &&
    typeof filters.maxDistanceLy === 'number'
  ) {
    try {
      const dist = await calculateLyDistance(filters.distanceFromSystemId, killmail.solar_system_id);
      if (dist === null || dist > filters.maxDistanceLy) return false;
    } catch (err) {
      console.error('[filterKillmail] LY distance calculation failed:', err);
      return false;
    }
  }

  return true;
}

module.exports = { filterKillmail };
