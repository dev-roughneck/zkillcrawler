const { EmbedBuilder } = require('discord.js');
const eveu = require('./eveuniverse');

async function formatKillmailEmbed(killmail) {
  // Look up names using cache or API
  const [system, region, ship, alliance, corp] = await Promise.all([
    killmail.solar_system_id ? eveu.resolveSystem(killmail.solar_system_id) : undefined,
    killmail.region_id ? eveu.resolveRegion(killmail.region_id) : undefined,
    killmail.victim?.ship_type_id ? eveu.resolveShipType(killmail.victim.ship_type_id) : undefined,
    killmail.victim?.alliance_id ? eveu.resolveAlliance(killmail.victim.alliance_id) : undefined,
    killmail.victim?.corporation_id ? eveu.resolveCorporation(killmail.victim.corporation_id) : undefined,
  ]);

  const victim = killmail.victim || {};
  const zkb = killmail.zkb || {};
  const attackers = killmail.attackers || [];
  const finalBlow = attackers.find(a => a.final_blow) || {};
  const finalBlowAlliance = finalBlow.alliance_id ? await eveu.resolveAlliance(finalBlow.alliance_id) : undefined;
  const finalBlowCorp = finalBlow.corporation_id ? await eveu.resolveCorporation(finalBlow.corporation_id) : undefined;

  // Victim details
  const victimPilot = victim.character_id
    ? await eveu.resolveCharacter(victim.character_id).then(c => c?.name).catch(() => undefined)
    : undefined;
  const victimCorp = corp ? corp.name : 'Unknown Corp';
  const victimAlliance = alliance ? alliance.name : 'None';

  // Final blow details
  const finalBlowPilot = finalBlow.character_id
    ? await eveu.resolveCharacter(finalBlow.character_id).then(c => c?.name).catch(() => undefined)
    : undefined;
  const finalBlowCorpName = finalBlowCorp ? finalBlowCorp.name : (finalBlow.corporation_id || 'Unknown Corp');
  const finalBlowAllianceName = finalBlowAlliance ? finalBlowAlliance.name : (finalBlow.alliance_id ? finalBlow.alliance_id : 'None');

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
          `**Corp:** ${finalBlowCorpName}`,
          `**Alliance:** ${finalBlowAllianceName}`
        ].join('\n'),
        inline: false
      }
    )
    .setColor(0xff0000)
    .setTimestamp(new Date(killmail.killmail_time))
    .setFooter({ text: 'zKillboard.com', iconURL: 'https://zkillboard.com/img/favicon.png' });

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
