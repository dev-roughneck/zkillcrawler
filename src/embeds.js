const { EmbedBuilder } = require('discord.js');
const eveu = require('./eveuniverse');

/**
 * Attempts to resolve an entity (character, corp, alliance, system, etc.) by ID or name.
 * Falls back to reverse search if direct resolution fails.
 */
async function resolveEntity(type, idOrName) {
  if (!idOrName) return undefined;
  try {
    // Try resolving by ID first
    switch (type) {
      case 'character':
        return await eveu.resolveCharacter(idOrName);
      case 'corporation':
        return await eveu.resolveCorporation(idOrName);
      case 'alliance':
        return await eveu.resolveAlliance(idOrName);
      case 'system':
        return await eveu.resolveSystem(idOrName);
      case 'region':
        return await eveu.resolveRegion(idOrName);
      case 'shiptype':
        return await eveu.resolveShipType(idOrName);
      default:
        return undefined;
    }
  } catch {
    // Fallback: attempt reverse search by name if possible
    try {
      switch (type) {
        case 'character':
          return await eveu.reverseCharacter(idOrName);
        case 'corporation':
          return await eveu.reverseCorporation(idOrName);
        case 'alliance':
          return await eveu.reverseAlliance(idOrName);
        case 'system':
          return await eveu.reverseSystem(idOrName);
        case 'region':
          return await eveu.reverseRegion(idOrName);
        case 'shiptype':
          return await eveu.reverseShipType(idOrName);
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }
}

/**
 * Formats a killmail as a Discord Embed with maximum resolution.
 */
async function formatKillmailEmbed(killmail) {
  // Resolve victim details
  const victim = killmail.victim || {};
  const zkb = killmail.zkb || {};
  const attackers = killmail.attackers || [];
  const finalBlow = attackers.find(a => a.final_blow) || {};

  // Resolve as much as possible (with fallbacks)
  const [system, region, ship, alliance, corp] = await Promise.all([
    resolveEntity('system', killmail.solar_system_id),
    resolveEntity('region', killmail.region_id),
    resolveEntity('shiptype', victim.ship_type_id),
    resolveEntity('alliance', victim.alliance_id),
    resolveEntity('corporation', victim.corporation_id)
  ]);

  const victimPilot = victim.character_id
    ? (await resolveEntity('character', victim.character_id))?.name
    : undefined;
  const victimCorp = corp ? corp.name : 'Unknown Corp';
  const victimAlliance = alliance ? alliance.name : 'None';

  const finalBlowPilot = finalBlow.character_id
    ? (await resolveEntity('character', finalBlow.character_id))?.name
    : undefined;
  const finalBlowCorp = finalBlow.corporation_id
    ? await resolveEntity('corporation', finalBlow.corporation_id)
    : undefined;
  const finalBlowAlliance = finalBlow.alliance_id
    ? await resolveEntity('alliance', finalBlow.alliance_id)
    : undefined;

  // ISK Value
  const iskValue = zkb.totalValue ? `${Math.round(zkb.totalValue).toLocaleString()} ISK` : 'Unknown';

  // Ship image
  const shipImage = victim.ship_type_id
    ? `https://images.evetech.net/types/${victim.ship_type_id}/render?size=128`
    : undefined;

  // Killmail URL
  const killUrl = zkb.url || (killmail.killmail_id && killmail.hash
    ? `https://zkillboard.com/kill/${killmail.killmail_id}/`
    : 'https://zkillboard.com/');

  // Build the embed
  const embed = new EmbedBuilder()
    .setTitle(`${victimPilot || 'Unknown pilot'} lost a ${ship ? ship.name : 'Unknown Ship'}`)
    .setURL(killUrl)
    .setThumbnail(shipImage)
    .addFields(
      { name: 'Pilot', value: victimPilot || 'Unknown', inline: true },
      { name: 'Corporation', value: victimCorp, inline: true },
      { name: 'Alliance', value: victimAlliance, inline: true },
      { name: 'ISK Lost', value: iskValue, inline: true },
      { name: 'Attackers', value: attackers.length.toString(), inline: true },
      {
        name: 'Final Blow',
        value: [
          finalBlowPilot || 'Unknown',
          `**Corp:** ${finalBlowCorp ? finalBlowCorp.name : (finalBlow.corporation_id || 'Unknown Corp')}`,
          `**Alliance:** ${finalBlowAlliance ? finalBlowAlliance.name : (finalBlow.alliance_id || 'None')}`
        ].join('\n'),
        inline: false
      }
    )
    .setColor(0xff0000)
    .setFooter({ text: "zKillboard.com", iconURL: "https://zkillboard.com/img/favicon.png" });

  // Set timestamp if valid
  const timestamp = killmail.killmail_time ? new Date(killmail.killmail_time) : null;
  if (timestamp && !isNaN(timestamp.getTime())) {
    embed.setTimestamp(timestamp);
  }

  // Location field
  if (system || region) {
    embed.addFields({
      name: 'Location',
      value: [
        system ? `${system.name}` : '',
        region ? `(${region.name})` : ''
      ].filter(Boolean).join(' '),
      inline: false
    });
  }

  return embed;
}

module.exports = { formatKillmailEmbed };
