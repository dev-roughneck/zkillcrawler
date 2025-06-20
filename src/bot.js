require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { listenToRedisQ } = require('./zkill/redisq'); // <-- Must match correct export!
const { getAllFeeds } = require('./feeds');
const { formatKillmailEmbed } = require('./embeds'); // <-- Use your enhanced embed function

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
    console.log('[BOT] Handling killmail:', killmail.killID || killmail.killmail_id);
    // Get all feeds (channelId, feedName, filters)
    const feeds = getAllFeeds();
    for (const { channelId, feedName, filters } of feeds) {
      try {
        if (applyFilters(killmail, filters)) {
          const channel = await client.channels.fetch(channelId).catch(() => null);
          if (channel) {
            // Use the embed!
            const embed = await formatKillmailEmbed(killmail, feedName);
            await channel.send({ embeds: [embed] });
          }
        }
      } catch (err) {
        console.error(`Error posting killmail for feed ${feedName} in channel ${channelId}:`, err);
      }
    }
  });
});

// Main interaction handler
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
    // String select menus (stopfeed and addfeed logic)
    else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'stopfeed-select') {
        const stopfeed = require('./commands/stopfeed');
        await stopfeed.handleSelect(interaction);
      }
      // Addfeed select logic (AND/OR/IF for advanced filtering)
      else if (interaction.customId.startsWith('logicmode-')) {
        const addfeed = require('./commands/addfeed');
        await addfeed.handleSelect(interaction);
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
function checkFilter(ids, killmailIds, mode = "OR") {
  if (!ids || ids.length === 0) return true;
  if (!killmailIds || killmailIds.length === 0) return false;
  if (mode === "AND") return ids.every(id => killmailIds.includes(id));
  if (mode === "OR") return ids.some(id => killmailIds.includes(id));
  if (mode === "IF") return ids.length === 0 || ids.some(id => killmailIds.includes(id));
  return true;
}

function applyFilters(killmail, filters) {
  // If no filters, allow everything
  if (!filters || Object.keys(filters).length === 0) return true;

  // Corporation filter
  if (filters.corporationIds && filters.corporationIds.length > 0) {
    const involvedCorpIds = [
      killmail.victim?.corporation_id,
      ...(killmail.attackers?.map(a => a.corporation_id) ?? [])
    ].filter(Boolean);
    if (!checkFilter(filters.corporationIds, involvedCorpIds, filters.corporationIdsMode || "OR")) return false;
  }

  // Character filter
  if (filters.characterIds && filters.characterIds.length > 0) {
    const involvedCharIds = [
      killmail.victim?.character_id,
      ...(killmail.attackers?.map(a => a.character_id) ?? [])
    ].filter(Boolean);
    if (!checkFilter(filters.characterIds, involvedCharIds, filters.characterIdsMode || "OR")) return false;
  }

  // Alliance filter
  if (filters.allianceIds && filters.allianceIds.length > 0) {
    const involvedAllianceIds = [
      killmail.victim?.alliance_id,
      ...(killmail.attackers?.map(a => a.alliance_id) ?? [])
    ].filter(Boolean);
    if (!checkFilter(filters.allianceIds, involvedAllianceIds, filters.allianceIdsMode || "OR")) return false;
  }

  // Attacker Corporation filter
  if (filters.attackerCorporationIds && filters.attackerCorporationIds.length > 0) {
    const attackerCorpIds = (killmail.attackers ?? []).map(a => a.corporation_id).filter(Boolean);
    if (!checkFilter(filters.attackerCorporationIds, attackerCorpIds, filters.attackerCorporationIdsMode || "OR")) return false;
  }

  // Attacker Character filter
  if (filters.attackerCharacterIds && filters.attackerCharacterIds.length > 0) {
    const attackerCharIds = (killmail.attackers ?? []).map(a => a.character_id).filter(Boolean);
    if (!checkFilter(filters.attackerCharacterIds, attackerCharIds, filters.attackerCharacterIdsMode || "OR")) return false;
  }

  // Attacker Alliance filter
  if (filters.attackerAllianceIds && filters.attackerAllianceIds.length > 0) {
    const attackerAllianceIds = (killmail.attackers ?? []).map(a => a.alliance_id).filter(Boolean);
    if (!checkFilter(filters.attackerAllianceIds, attackerAllianceIds, filters.attackerAllianceIdsMode || "OR")) return false;
  }

  // Region filter (by regionId, not region_name)
  if (filters.regionIds && filters.regionIds.length > 0) {
    const regionId = killmail.region_id || null;
    if (!checkFilter(filters.regionIds, [regionId].filter(Boolean), filters.regionIdsMode || "OR")) return false;
  }

  // System filter
  if (filters.systemIds && filters.systemIds.length > 0) {
    const systemId = killmail.solar_system_id || null;
    if (!checkFilter(filters.systemIds, [systemId].filter(Boolean), filters.systemIdsMode || "OR")) return false;
  }

  // Ship Type filter
  if (filters.shipTypeIds && filters.shipTypeIds.length > 0) {
    const shipTypeId = killmail.victim?.ship_type_id || null;
    if (!checkFilter(filters.shipTypeIds, [shipTypeId].filter(Boolean), filters.shipTypeIdsMode || "OR")) return false;
  }

  // Minimum ISK value filter
  if (filters.minValue && killmail.zkb?.totalValue) {
    if (killmail.zkb.totalValue < filters.minValue) return false;
  }
  // Maximum ISK value filter
  if (filters.maxValue && killmail.zkb?.totalValue) {
    if (killmail.zkb.totalValue > filters.maxValue) return false;
  }

  // Minimum attackers filter
  if (filters.minAttackers && Array.isArray(killmail.attackers)) {
    if (killmail.attackers.length < filters.minAttackers) return false;
  }
  // Maximum attackers filter
  if (filters.maxAttackers && Array.isArray(killmail.attackers)) {
    if (killmail.attackers.length > filters.maxAttackers) return false;
  }

  // Backward compatibility: regions as string array (region_name)
  if (filters.regions && Array.isArray(filters.regions) && filters.regions.length > 0 && killmail.region_name) {
    if (!filters.regions.includes(killmail.region_name)) return false;
  }

  // If all filters passed
  return true;
}
