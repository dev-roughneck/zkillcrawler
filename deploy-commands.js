const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Load your token, clientId, and guildId from config or .env
const token = process.env.DISCORD_TOKEN;
const clientId = '1384656828847231057'; // Replace!
const guildId = '1384331616683425823';   // Replace!

const commands = [];
const commandsPath = path.join(__dirname, 'src', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
  }
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands for guild ${guildId}.`);
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();
