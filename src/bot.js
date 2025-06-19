require('dotenv').config();
const { Client, GatewayIntentBits, Collection, InteractionType } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(err);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'There was an error executing this command!', ephemeral: true });
      } else {
        await interaction.reply({ content: 'There was an error executing this command!', ephemeral: true });
      }
    }
  } else if (interaction.type === InteractionType.ModalSubmit) {
    // Multi-step modal handling: match customId prefix (e.g. addfeed-modal-step1, addfeed-modal-step2, etc.)
    let handled = false;
    for (const [name, command] of client.commands) {
      if (typeof command.handleModal === 'function' && interaction.customId.startsWith(name)) {
        try {
          await command.handleModal(interaction);
          handled = true;
          break;
        } catch (err) {
          console.error(err);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error processing the modal!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error processing the modal!', ephemeral: true });
          }
        }
      }
    }
    // Backward compatibility: fallback to old single-modal IDs
    if (!handled) {
      const modalHandlers = {
        'addfeed-modal': require('./commands/addfeed').handleModal,
        'editfeed-modal': require('./commands/editfeed').handleModal,
      };
      const handler = modalHandlers[interaction.customId];
      if (handler) {
        try {
          await handler(interaction);
        } catch (err) {
          console.error(err);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error processing the modal!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error processing the modal!', ephemeral: true });
          }
        }
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
