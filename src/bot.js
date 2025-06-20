require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { listenToRedisQ } = require('./zkill/redisq');
const { getAllFeeds } = require('./feeds');
const {
  resolveCharacter,
  resolveCorporation,
  resolveAlliance,
  resolveShipType,
  resolveSystem,
} = require('./eveuniverse');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

// Load commands dynamically from src/commands/
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  // Start single RedisQ poller for all feeds
  listenToRedisQ(async (killmail) => {
    try {
      // Log every killmail for debugging
      console.log("Received killmail payload:", JSON.stringify(killmail, null, 2));

      // --- Name resolution for victim, ship, system, corp, alliance ---
      const victim = killmail.killmail?.victim || {};
      const systemId = killmail.killmail?.solar_system_id;
      const shipTypeId = victim.ship_type_id;
      const corpId = victim.corporation_id;
      const allianceId = victim.alliance_id;
      const charId = victim.character_id;

      // These may be undefined (especially alliance)
      const [victimChar, victimCorp, victimAlliance, victimShip, system] = await Promise.all([
        charId ? resolveCharacter(charId) : null,
        corpId ? resolveCorporation(corpId) : null,
        allianceId ? resolveAlliance(allianceId) : null,
        shipTypeId ? resolveShipType(shipTypeId) : null,
        systemId ? resolveSystem(systemId) : null,
      ]);

      // Enrich for filters and output
      const killmailWithNames = {
        ...killmail,
        victim: {
          ...victim,
          character: victimChar?.name,
          corporation: victimCorp?.name,
          alliance: victimAlliance?.name,
          ship_type: victimShip?.name,
        },
        solar_system: system ? { name: system.name } : {},
        // attackers: to be filled below if needed
      };

      // Optionally resolve attacker info if filters use attacker names
      let attackersWithNames = [];
      const feeds = getAllFeeds();
      const needsAttackerNames = feeds.some(feed => {
        const f = feed.filters || {};
        return f.attacker_alliance || f.attacker_corp || f.attacker_character;
      });
      if (needsAttackerNames) {
        attackersWithNames = await Promise.all(
          (killmail.killmail?.attackers || []).map(async atk => {
            const char = atk.character_id ? await resolveCharacter(atk.character_id) : null;
            const corp = atk.corporation_id ? await resolveCorporation(atk.corporation_id) : null;
            const alliance = atk.alliance_id ? await resolveAlliance(atk.alliance_id) : null;
            return {
              ...atk,
              character: char?.name,
              corporation: corp?.name,
              alliance: alliance?.name,
            };
          })
        );
        killmailWithNames.attackers = attackersWithNames;
      } else {
        killmailWithNames.attackers = killmail.killmail?.attackers || [];
      }

      console.log("Loaded feeds:", feeds.map(f => f.feed_name).join(", "));
      for (const { channel_id, feed_name, filters } of feeds) {
        try {
          const passes = await applyFilters(killmailWithNames, filters);
          console.log(`Feed ${feed_name} (channel ${channel_id}) filter result: ${passes}`);
          if (passes) {
            // Attempt to fetch and post to the channel
            const channel = await client.channels.fetch(channel_id).catch((err) => {
              console.error(`Could not fetch channel ${channel_id}:`, err);
              return null;
            });
            if (channel) {
              console.log(`Posting killmail to channel ${channel_id}`);
              const embed = new EmbedBuilder()
                .setTitle(`Killmail: ${killmail.killID}`)
                .setURL(`https://zkillboard.com/kill/${killmail.killID}/`)
                .setDescription(`New killmail for feed \`${feed_name}\``)
                .setColor(0xff0000)
                .addFields(
                  { name: 'Victim', value: victimChar?.name || 'Unknown', inline: true },
                  { name: 'Corporation', value: victimCorp?.name || 'Unknown', inline: true },
                  { name: 'Alliance', value: victimAlliance?.name || 'Unknown', inline: true },
                  { name: 'Ship', value: victimShip?.name || 'Unknown', inline: true },
                  { name: 'System', value: system?.name || 'Unknown', inline: true },
                  { name: 'ISK Value', value: (killmail.zkb?.totalValue ? killmail.zkb.totalValue.toLocaleString() + ' ISK' : 'Unknown'), inline: true }
                );
              await channel.send({ embeds: [embed] });
              console.log("Posted embed to Discord.");
            } else {
              console.error(`Channel ${channel_id} not found or bot has no access.`);
            }
          }
        } catch (err) {
          console.error(`Error posting killmail for feed ${feed_name} in channel ${channel_id}:`, err);
        }
      }
    } catch (err) {
      console.error("Error in killmail handler:", err);
    }
  });
});

// Main interaction handler (unchanged)
client.on('interactionCreate', async interaction => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (command) await command.execute(interaction);
    }
    // Modal submits
    else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('addfeed-modal')) {
        const addfeed = require('./commands/addfeed');
        await addfeed.handleModal(interaction);
      } else if (interaction.customId === 'zkill-filters') {
        const zkillsetup = require('./commands/zkillsetup');
        await zkillsetup.handleModal(interaction);
      } else if (interaction.customId.startsWith('editfeed-modal')) {
        const editfeed = require('./commands/editfeed');
        await editfeed.handleModal(interaction);
      }
    }
    // Button clicks (step buttons for addfeed)
    else if (interaction.isButton()) {
      if (interaction.customId.startsWith('addfeed-next-step')) {
        const addfeed = require('./commands/addfeed');
        await addfeed.handleButton(interaction);
      }
    }
    // String select menus (stopfeed)
    else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'stopfeed-select') {
        const stopfeed = require('./commands/stopfeed');
        await stopfeed.handleSelect(interaction);
      }
    }
  } catch (err) {
    console.error('Interaction error:', err);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'There was an error while executing this interaction.', flags: 1 << 6 });
      } else {
        await interaction.reply({ content: 'There was an error while executing this interaction.', flags: 1 << 6 });
      }
    } catch (err2) {
      console.error('Error sending error reply:', err2);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

// --- Helper: filter logic ---
async function applyFilters(killmail, filters) {
  // If no filters, always match
  if (!filters || Object.keys(filters).length === 0) return true;

  function toArray(str) {
    if (!str) return [];
    return str.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Region
  if (filters.region) {
    const allowedRegions = toArray(filters.region).map(x => x.toLowerCase());
    if (!allowedRegions.includes((killmail.solar_system?.region?.toLowerCase()) || '')) {
      return false;
    }
  }

  // System
  if (filters.system) {
    const allowedSystems = toArray(filters.system).map(x => x.toLowerCase());
    if (!allowedSystems.includes((killmail.solar_system?.name?.toLowerCase()) || '')) {
      return false;
    }
  }

  // Ship Type
  if (filters.shiptype) {
    const allowedShips = toArray(filters.shiptype).map(x => x.toLowerCase());
    if (!allowedShips.includes((killmail.victim?.ship_type?.toLowerCase()) || '')) {
      return false;
    }
  }

  // Victim Alliance
  if (filters.alliance) {
    const allowedAlliances = toArray(filters.alliance).map(x => x.toLowerCase());
    if (!allowedAlliances.includes((killmail.victim?.alliance?.toLowerCase()) || '')) {
      return false;
    }
  }

  // Victim Corp
  if (filters.corp) {
    const allowedCorps = toArray(filters.corp).map(x => x.toLowerCase());
    if (!allowedCorps.includes((killmail.victim?.corporation?.toLowerCase()) || '')) {
      return false;
    }
  }

  // Victim Character
  if (filters.character) {
    const allowedChars = toArray(filters.character).map(x => x.toLowerCase());
    if (!allowedChars.includes((killmail.victim?.character?.toLowerCase()) || '')) {
      return false;
    }
  }

  // Attacker Alliance
  if (filters.attacker_alliance) {
    const allowedAA = toArray(filters.attacker_alliance).map(x => x.toLowerCase());
    const attackersMatch = (killmail.attackers || []).some(a =>
      a.alliance && allowedAA.includes(a.alliance.toLowerCase())
    );
    if (!attackersMatch) return false;
  }

  // Attacker Corp
  if (filters.attacker_corp) {
    const allowedAC = toArray(filters.attacker_corp).map(x => x.toLowerCase());
    const attackersMatch = (killmail.attackers || []).some(a =>
      a.corporation && allowedAC.includes(a.corporation.toLowerCase())
    );
    if (!attackersMatch) return false;
  }

  // Attacker Character
  if (filters.attacker_character) {
    const allowedAChar = toArray(filters.attacker_character).map(x => x.toLowerCase());
    const attackersMatch = (killmail.attackers || []).some(a =>
      a.character && allowedAChar.includes(a.character.toLowerCase())
    );
    if (!attackersMatch) return false;
  }

  // ISK value minimum/maximum
  if (filters.min_isk) {
    const minVal = parseFloat(filters.min_isk.replace(/,/g, ''));
    if (!isNaN(minVal) && (killmail.zkb?.totalValue || 0) < minVal) return false;
  }
  if (filters.max_isk) {
    const maxVal = parseFloat(filters.max_isk.replace(/,/g, ''));
    if (!isNaN(maxVal) && (killmail.zkb?.totalValue || 0) > maxVal) return false;
  }

  // Minimum/maximum attackers
  if (filters.min_attackers) {
    const minAtk = parseInt(filters.min_attackers);
    if (!isNaN(minAtk) && (killmail.attackers?.length || 0) < minAtk) return false;
  }
  if (filters.max_attackers) {
    const maxAtk = parseInt(filters.max_attackers);
    if (!isNaN(maxAtk) && (killmail.attackers?.length || 0) > maxAtk) return false;
  }

  // If passed all filters: MATCH
  return true;
}
