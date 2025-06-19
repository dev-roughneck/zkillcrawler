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
  const finalBlow = attackers.find(a => a.final_blow);

  let desc = `**Victim:** ${victim.character_id || 'Unknown'} (${corp ? corp.name : 'Unknown Corp'})\n`;
  desc += `**Ship:** ${ship ? ship.name : 'Unknown'}\n`;
  desc += `**System:** ${system ? system.name : 'Unknown'}\n`;
  if (region) desc += `**Region:** ${region.name}\n`;
  desc += `**Time:** ${killmail.killmail_time || ''}\n`;
  desc += `**Value:** ${zkb.totalValue ? zkb.totalValue.toLocaleString() + ' ISK' : 'Unknown'}\n`;
  if (finalBlow) {
    desc += `**Final blow by:** ${finalBlow.character_id || 'Unknown'} (${finalBlow.corporation_id || 'Unknown Corp'})\n`;
  }
  if (alliance) desc += `**Alliance:** ${alliance.name}\n`;

  const embed = new EmbedBuilder()
    .setTitle('💥 Killmail!')
    .setURL(zkb.url || 'https://zkillboard.com/')
    .setDescription(desc)
    .setTimestamp(new Date(killmail.killmail_time))
    .setFooter({ text: 'zKillboard.com', iconURL: 'https://zkillboard.com/img/favicon.png' });

  if (victim.ship_type_id)
    embed.setThumbnail('https://images.evetech.net/types/' + victim.ship_type_id + '/render?size=64');

  return embed;
}

module.exports = { formatKillmailEmbed };