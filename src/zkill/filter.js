function parseFilterField(val) {
  if (!val) return [];
  if (typeof val === 'string') val = val.split(',').map(v => v.trim()).filter(Boolean);
  return Array.isArray(val) ? val : [val];
}

function matchField(candidate, filterVals) {
  if (!filterVals.length) return true;
  let match = false;
  for (const val of filterVals) {
    if (val.startsWith('!')) {
      if (String(candidate) === val.slice(1)) return false;
    } else {
      if (String(candidate) === val) match = true;
    }
  }
  if (filterVals.every(v => v.startsWith('!'))) return true;
  return match;
}

function matchAnyAttackerField(attackers, key, filterVals) {
  if (!filterVals.length) return true;
  if (!Array.isArray(attackers) || attackers.length === 0) return false;
  let anyMatch = false;
  for (const attacker of attackers) {
    if (matchField(attacker[key], filterVals)) {
      anyMatch = true;
      break;
    }
  }
  if (filterVals.every(v => v.startsWith('!'))) {
    for (const attacker of attackers) {
      for (const val of filterVals) {
        if (String(attacker[key]) === val.slice(1)) return false;
      }
    }
    return true;
  }
  return anyMatch;
}

function filterKillmail(killmail, filters) {
  if (filters.minisk && killmail.zkb && killmail.zkb.totalValue < Number(filters.minisk)) return false;
  if (!matchField(killmail.region_id, parseFilterField(filters.region_id))) return false;
  if (!matchField(killmail.solar_system_id, parseFilterField(filters.system_id))) return false;
  if (!matchField(killmail.victim.alliance_id, parseFilterField(filters.alliance_id))) return false;
  if (!matchField(killmail.victim.corporation_id, parseFilterField(filters.corp_id))) return false;
  if (!matchField(killmail.victim.character_id, parseFilterField(filters.character_id))) return false;
  if (!matchField(killmail.victim.ship_type_id, parseFilterField(filters.shiptype_id))) return false;

  if (!matchAnyAttackerField(killmail.attackers, 'alliance_id', parseFilterField(filters.attacker_alliance_id))) return false;
  if (!matchAnyAttackerField(killmail.attackers, 'corporation_id', parseFilterField(filters.attacker_corp_id))) return false;
  if (!matchAnyAttackerField(killmail.attackers, 'character_id', parseFilterField(filters.attacker_character_id))) return false;
  if (!matchAnyAttackerField(killmail.attackers, 'ship_type_id', parseFilterField(filters.attacker_shiptype_id))) return false;

  if (filters.minattackers && killmail.attackers.length < Number(filters.minattackers)) return false;
  if (filters.maxattackers && killmail.attackers.length > Number(filters.maxattackers)) return false;

  return true;
}

module.exports = { filterKillmail, parseFilterField, matchField, matchAnyAttackerField };