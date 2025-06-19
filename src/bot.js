require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Create Discord client
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

// Bot ready event
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

// Main interaction handler
client.on('interactionCreate', async interaction => {
  try {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
    }

    // Handle modals from commands (editfeed, zkillsetup, addfeed, etc)
    else if (interaction.isModalSubmit()) {
      // Route to command file based on modal customId prefix
      if (interaction.customId.startsWith('addfeed-modal')) {
        // addfeed.js exports a handleModal
        const addfeed = require('./commands/addfeed');
        await addfeed.handleModal(interaction);
      } else if (interaction.customId === 'zkill-filters') {
        // zkillsetup.js exports a handleModal
        const zkillsetup = require('./commands/zkillsetup');
        await zkillsetup.handleModal(interaction);
      } else if (interaction.customId.startsWith('editfeed-modal')) {
        // editfeed.js exports a handleModal
        const editfeed = require('./commands/editfeed');
        await editfeed.handleModal(interaction);
      }
    }

    // Handle select menus
    else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'stopfeed-select') {
        // stopfeed.js exports a handleSelect
        const stopfeed = require('./commands/stopfeed');
        await stopfeed.handleSelect(interaction);
      }
      // Add more select menu handlers if needed
    }

    // Add other interaction types as needed (buttons, etc)

  } catch (err) {
    console.error('Interaction error:', err);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'There was an error while executing this interaction.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'There was an error while executing this interaction.', ephemeral: true });
      }
    } catch (err2) {
      console.error('Error sending error reply:', err2);
    }
  }
});

// Start the bot
client.login(process.env.DISCORD_TOKEN);
