const { EmbedBuilder } = require('discord.js');
const eveu = require('./eveuniverse');

/**
 * Formats a killmail as a Discord Embed using a wide, compact, information-rich layout.
 * Shows: Victim (link, corp, alliance, ship), system (w/ region), ISK value, attackers, final blow, time, images.
 * Now also shows system security class and (if present in filters) distance from reference system.
 * @param {Object} killmail
 * @param {Object} [filters] - (optional) Feed filters, to display reference system/distance if present
 * @returns {EmbedBuilder}
 */
async function formatKillmailEmbed(killmail, filters = null) {
  const victim = killmail.victim || {};
  const zkb = killmail.zkb || {};
  const attackers = Array.isArray(killmail.attackers) ? killmail.attackers : [];
  const finalBlow = attackers.find(a => a.final_blow) || {};

  // --- Victim Resolution ---
  let [victimChar, victimCorp, victimAlliance, victimShip, systemObj, regionObj] = await Promise.all([
    victim.character_id ? eveu.resolveCharacter(victim.character_id) : null,
    victim.corporation_id ? eveu.resolveCorporation(victim.corporation_id) : null,
    victim.alliance_id ? eveu.resolveAlliance(victim.alliance_id) : null,
    victim.ship_type_id ? eveu.resolveShipType(victim.ship_type_id) : null,
    killmail.solar_system_id ? eveu.resolveSystem(killmail.solar_system_id) : null,
    null // regionObj will be resolved below
  ]);

  // --- Region Resolution ---
  if (killmail.region_id) {
    regionObj = await eveu.resolveRegion(killmail.region_id);
  } else if (systemObj && systemObj.region_id) {
    regionObj = await eveu.resolveRegion(systemObj.region_id);
  }

  // --- Links ---
  const victimCharLink = victimChar
    ? `[${victimChar.name}](https://evewho.com/character/${victimChar.id})`
    : (victim.character_id ? `[${victim.character_id}](https://evewho.com/character/${victim.character_id})` : 'Unknown');

  // --- Final blow attacker ---
  let finalAttackerChar, finalAttackerCorp, finalAttackerAlliance, finalAttackerShip, finalAttackerWeapon;
  if (finalBlow && (finalBlow.character_id || finalBlow.corporation_id || finalBlow.alliance_id)) {
    [finalAttackerChar, finalAttackerCorp, finalAttackerAlliance, finalAttackerShip, finalAttackerWeapon] = await Promise.all([
      finalBlow.character_id ? eveu.resolveCharacter(finalBlow.character_id) : null,
      finalBlow.corporation_id ? eveu.resolveCorporation(finalBlow.corporation_id) : null,
      finalBlow.alliance_id ? eveu.resolveAlliance(finalBlow.alliance_id) : null,
      finalBlow.ship_type_id ? eveu.resolveShipType(finalBlow.ship_type_id) : null,
      finalBlow.weapon_type_id ? eveu.resolveShipType(finalBlow.weapon_type_id) : null,
    ]);
  }

  // --- Values ---
  const iskValue = zkb.totalValue ? `${Math.round(zkb.totalValue).toLocaleString()} ISK` : 'Unknown';

  // Ship image (left side)
  const shipImage = victimShip
    ? `https://images.evetech.net/types/${victimShip.id}/render?size=256`
    : null;

  // Alliance/corp logo (right side, wide format)
  let logo = null;
  if (victimAlliance && victimAlliance.id) {
    logo = `https://images.evetech.net/alliances/${victimAlliance.id}/logo?size=128`;
  } else if (victimCorp && victimCorp.id) {
    logo = `https://images.evetech.net/corporations/${victimCorp.id}/logo?size=128`;
  }

  // Killmail URL
  const killID = killmail.killID || killmail.killmail_id;
  const killUrl = killID ? `https://zkillboard.com/kill/${killID}/` : "https://zkillboard.com/";

  // System w/ region
  const systemStr = systemObj && systemObj.name
    ? regionObj && regionObj.name
      ? `${systemObj.name} (${regionObj.name})`
      : systemObj.name
    : "Unknown";

  // System security status/class
  let systemSec = typeof systemObj?.security_status === 'number' ? systemObj.security_status : null;
  let secClass = "Unknown";
  if (typeof systemSec === 'number') {
    if (systemSec >= 0.5) secClass = 'High Sec';
    else if (systemSec >= 0.1) secClass = 'Low Sec';
    else if (systemSec > -0.99) secClass = 'Null Sec';
    else secClass = 'Wormhole';
  }

  // If filters specify a reference system for LY filtering, show distance
  let lyDistanceStr = null;
  if (
    filters &&
    typeof filters.distanceFromSystemId === 'number' &&
    typeof filters.maxDistanceLy === 'number' &&
    systemObj &&
    systemObj.id
  ) {
    try {
      const dist = await eveu.calculateLyDistance(filters.distanceFromSystemId, systemObj.id);
      if (dist !== null) {
        lyDistanceStr = `${dist.toFixed(2)} ly from ${filters.distanceFromSystemName || "reference system"}`;
      }
    } catch (err) {
      lyDistanceStr = "Distance: error";
    }
  }

  // Final blow attacker section
  const attackerLink = finalAttackerChar
    ? `[${finalAttackerChar.name}](https://evewho.com/character/${finalAttackerChar.id})`
    : (finalBlow.character_id ? `[${finalBlow.character_id}](https://evewho.com/character/${finalBlow.character_id})` : "Unknown");

  const finalBlowStr =
    `${attackerLink}\n` +
    `Corp: ${finalAttackerCorp?.name || finalBlow.corporation_id || "Unknown"}\n` +
    `Alliance: ${finalAttackerAlliance?.name || finalBlow.alliance_id || "None"}\n` +
    `Ship: ${finalAttackerShip?.name || finalBlow.ship_type_id || "Unknown"}\n` +
    `Weapon: ${finalAttackerWeapon?.name || finalBlow.weapon_type_id || "Unknown"}`;

  // Build the embed
  const embed = new EmbedBuilder()
    .setTitle(`Killmail: ${killID}`)
    .setURL(killUrl)
    .setColor(0xff0000)
    .addFields(
      { name: 'Victim', value: victimCharLink, inline: true },
      { name: 'Corp', value: victimCorp?.name || 'Unknown', inline: true },
      { name: 'Alliance', value: victimAlliance?.name || 'None', inline: true },
      { name: 'Ship', value: victimShip?.name || 'Unknown', inline: true },
      { name: 'System', value: systemStr, inline: true },
      { name: 'Sec Class', value: secClass, inline: true },
      { name: 'ISK Value', value: iskValue, inline: true },
      { name: 'Attackers', value: attackers.length.toString(), inline: true },
      { name: 'Final Blow', value: finalBlowStr, inline: true },
      { name: 'Time', value: killmail.killmail_time ? new Date(killmail.killmail_time).toUTCString() : "Unknown", inline: true }
    )
    .setFooter({ text: "zKillboard.com", iconURL: "https://zkillboard.com/img/favicon.png" });

  if (lyDistanceStr) {
    embed.addFields({ name: 'Distance', value: lyDistanceStr, inline: true });
  }
  if (shipImage) embed.setThumbnail(shipImage);
  if (logo) embed.setImage(logo);

  // Set timestamp if valid
  const timestamp = killmail.killmail_time ? new Date(killmail.killmail_time) : null;
  if (timestamp && !isNaN(timestamp.getTime())) {
    embed.setTimestamp(timestamp);
  }

  // Debug logging for unresolved info
  if (!victimChar) console.warn('[EMBED] Victim character unresolved', victim.character_id);
  if (!victimCorp) console.warn('[EMBED] Victim corp unresolved', victim.corporation_id);
  if (!victimAlliance && victim.alliance_id) console.warn('[EMBED] Victim alliance unresolved', victim.alliance_id);
  if (!victimShip) console.warn('[EMBED] Victim ship unresolved', victim.ship_type_id);
  if (!systemObj) console.warn('[EMBED] System unresolved', killmail.solar_system_id);
  if (!regionObj) console.warn('[EMBED] Region unresolved', killmail.region_id, systemObj?.region_id);

  return embed;
}

module.exports = { formatKillmailEmbed };
