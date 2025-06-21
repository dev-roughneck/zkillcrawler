const { calculateLyDistance } = require('../eveuniverse');

/**
 * Filter a normalized killmail according to filters.
 * @param {Object} killmail
 * @param {Object} filters
 * @returns {Promise<boolean>}
 */
async function filterKillmail(killmail, filters) {
  // Helper for matching arrays of IDs (OR/AND/IF)
  function matchIds(arr, target, mode = 'OR') {
    if (!arr || arr.length === 0) return true;
    if (!target) return false;
    if (Array.isArray(target)) {
      // for attackers, target is an array
      if (mode === 'AND') return arr.every(id => target.includes(id));
      if (mode === 'OR') return arr.some(id => target.includes(id));
      if (mode === 'IF') return arr.length === 0 || arr.some(id => target.includes(id));
      return false;
    } else {
      if (mode === 'AND') return arr.every(id => id === target);
      if (mode === 'OR') return arr.includes(target);
      if (mode === 'IF') return arr.length === 0 || arr.includes(target);
      return false;
    }
  }

  // Victim-side filters
  if (!matchIds(filters.corporationIds, killmail.victim.corporation_id, filters.corporationIdsMode)) return false;
  if (!matchIds(filters.characterIds, killmail.victim.character_id, filters.characterIdsMode)) return false;
  if (!matchIds(filters.allianceIds, killmail.victim.alliance_id, filters.allianceIdsMode)) return false;
  if (!matchIds(filters.regionIds, killmail.region_id, filters.regionIdsMode)) return false;
  if (!matchIds(filters.systemIds, killmail.solar_system_id, filters.systemIdsMode)) return false;
  if (!matchIds(filters.shipTypeIds, killmail.victim.ship_type_id, filters.shipTypeIdsMode)) return false;

  // Attacker-side filters (arrays of attackers)
  const attackers = killmail.attackers || [];
  if (filters.attackerCorporationIds && filters.attackerCorporationIds.length > 0) {
    const attackerCorpIds = attackers.map(a => a.corporation_id).filter(Boolean);
    if (!matchIds(filters.attackerCorporationIds, attackerCorpIds, filters.attackerCorporationIdsMode)) return false;
  }
  if (filters.attackerCharacterIds && filters.attackerCharacterIds.length > 0) {
    const attackerCharIds = attackers.map(a => a.character_id).filter(Boolean);
    if (!matchIds(filters.attackerCharacterIds, attackerCharIds, filters.attackerCharacterIdsMode)) return false;
  }
  if (filters.attackerAllianceIds && filters.attackerAllianceIds.length > 0) {
    const attackerAllianceIds = attackers.map(a => a.alliance_id).filter(Boolean);
    if (!matchIds(filters.attackerAllianceIds, attackerAllianceIds, filters.attackerAllianceIdsMode)) return false;
  }

  // ISK value/attacker count filters
  if (typeof filters.minValue === 'number' && killmail.zkb?.totalValue < filters.minValue) return false;
  if (typeof filters.maxValue === 'number' && killmail.zkb?.totalValue > filters.maxValue) return false;
  if (typeof filters.minAttackers === 'number' && attackers.length < filters.minAttackers) return false;
  if (typeof filters.maxAttackers === 'number' && attackers.length > filters.maxAttackers) return false;

  // Security class filter
  if (Array.isArray(filters.securityClass) && filters.securityClass.length > 0) {
    // Use pre-normalized killmail.solar_system_security if available
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
    typeof filters.maxDistanceLy === 'number' &&
    !isNaN(filters.distanceFromSystemId) &&
    !isNaN(filters.maxDistanceLy)
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
