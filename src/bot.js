require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
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
  resolveRegion
} = require('./eveuniverse');
const { formatKillmailEmbed } = require('./embeds');

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
      // === NEW LOGGING: Log the full raw killmail as received ===
      console.log("=== RAW KILLMAIL RECEIVED ===");
      try {
        console.log(JSON.stringify(killmail, null, 2));
      } catch (e) {
        console.log("Killmail log error:", e);
      }
      console.log("=============================");

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

      // Try to resolve region, fallback to system.region_id if available
      let region = null;
      if (killmail.killmail?.region_id) {
        region = await resolveRegion(killmail.killmail.region_id);
      } else if (system && system.region_id) {
        region = await resolveRegion(system.region_id);
      }

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
        solar_system: system ? { name: system.name, region: region?.name } : {},
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
          // Extra debug: log the filters for this feed
          console.log(`Feed: ${feed_name}, Channel: ${channel_id}, Filters:`, JSON.stringify(filters, null, 2));
          // ADDITION: Log just the filters for clarity in debugging
          console.log("FEED FILTERS:", JSON.stringify(filters, null, 2));
          const passes = await applyFilters(killmail, filters);
          console.log(`Feed ${feed_name} (channel ${channel_id}) filter result: ${passes}`);
          if (passes) {
            // Attempt to fetch and post to the channel
            const channel = await client.channels.fetch(channel_id).catch((err) => {
              console.error(`Could not fetch channel ${channel_id}:`, err);
              return null;
            });
            if (channel) {
              console.log(`Posting killmail to channel ${channel_id}`);
              const formattedKillmail = {
                ...killmail.killmail,
                zkb: killmail.zkb,
                victim,
                attackers: killmail.killmail.attackers || [],
                killID: killmail.killID,
                region_id: region?.id // pass region for embed formatting
              };
              const embed = await formatKillmailEmbed(formattedKillmail);
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

  // Helper for "match if array is empty or contains value"
  function matchId(val, arr) {
    if (!arr || arr.length === 0) return true;
    return arr.map(Number).includes(Number(val));
  }

  // Victim filters
  const victim = killmail.killmail?.victim || {};
  if (filters.regionIds && filters.regionIds.length > 0) {
    if (!matchId(killmail.killmail?.region_id, filters.regionIds)) return false;
  }
  if (filters.systemIds && filters.systemIds.length > 0) {
    if (!matchId(killmail.killmail?.solar_system_id, filters.systemIds)) return false;
  }
  if (filters.shipTypeIds && filters.shipTypeIds.length > 0) {
    if (!matchId(victim.ship_type_id, filters.shipTypeIds)) return false;
  }
  if (filters.allianceIds && filters.allianceIds.length > 0) {
    if (!matchId(victim.alliance_id, filters.allianceIds)) return false;
  }
  if (filters.corporationIds && filters.corporationIds.length > 0) {
    if (!matchId(victim.corporation_id, filters.corporationIds)) return false;
  }
  if (filters.characterIds && filters.characterIds.length > 0) {
    if (!matchId(victim.character_id, filters.characterIds)) return false;
  }

  // Attacker filters - at least one attacker must match
  const attackers = killmail.killmail?.attackers || [];
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
  if (typeof filters.minValue === 'number' && killmail.zkb?.totalValue !== undefined) {
    if (killmail.zkb.totalValue < filters.minValue) return false;
  }
  if (typeof filters.maxValue === 'number' && killmail.zkb?.totalValue !== undefined) {
    if (killmail.zkb.totalValue > filters.maxValue) return false;
  }

  // Number of attackers
  if (typeof filters.minAttackers === 'number') {
    if (attackers.length < filters.minAttackers) return false;
  }
  if (typeof filters.maxAttackers === 'number') {
    if (attackers.length > filters.maxAttackers) return false;
  }

  // If all checks passed:
  return true;
}
