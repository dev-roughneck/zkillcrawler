require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { listenToRedisQ } = require('./zkill/redisq');
const { getAllFeeds } = require('./feeds');
const { filterKillmail } = require('./zkill/filter');
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
      // Only log that a killmail was received (no full payload)
      console.log("Receiving a new killmail from RedisQ...");

      // Fetch all feeds (each has channel_id, feed_name, filters)
      const feeds = getAllFeeds();

      console.log("Loaded feeds:", feeds.map(f => f.feed_name).join(", "));

      for (const { channel_id, feed_name, filters } of feeds) {
        try {
          // Use only the normalized, ID-based filters
          const passes = filterKillmail(killmail.killmail, filters);
          console.log(`Feed ${feed_name} (channel ${channel_id}) filter result: ${passes}`);

          if (passes) {
            // Attempt to fetch and post to the channel
            const channel = await client.channels.fetch(channel_id).catch((err) => {
              console.error(`Could not fetch channel ${channel_id}:`, err);
              return null;
            });
            if (channel) {
              console.log(`Posting killmail to channel ${channel_id}`);
              // Pass only the minimum killmail data needed; embed will do ESI lookups as needed
              const formattedKillmail = {
                ...killmail.killmail,
                zkb: killmail.zkb,
                killID: killmail.killID,
                region_id: killmail.killmail?.region_id // pass region for embed formatting if present
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
