const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const filters = require('./zkill/filter');
const models = require('./feeds');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.log(`[WARNING] The command at ${filePath} is missing required "data" or "execute".`);
  }
}

// Mock killmail fetcher - replace with real ESI fetch logic
async function fetchKillmails() {
  return [
    {
      id: '123',
      victim: { corp: 'Brave', alliance: 'Test Alliance' },
      attacker: { alliance: 'Goonswarm' },
    },
  ];
}

function killmailMatchesFilters(killmail, filtersObj) {
  for (const key in filtersObj) {
    const [side, field] = key.split('.');
    const target = killmail[side]?.[field];
    const values = filtersObj[key];
    if (!target || !values.includes(target)) return false;
  }
  return true;
}

async function pollFeeds() {
  const feeds = models.listFeeds();
  const killmails = await fetchKillmails();

  for (const feed of feeds) {
    let filterObj;
    try {
      filterObj = JSON.parse(feed.filters);
    } catch (e) {
      console.error(`Invalid filter JSON for feed ${feed.id}`);
      continue;
    }

    const matches = killmails.filter(k => killmailMatchesFilters(k, filterObj));
    const channel = await client.channels.fetch(feed.channel_id).catch(() => null);

    if (!channel) continue;

    for (const match of matches) {
      channel.send(`Matched killmail: ID ${match.id}`);
    }
  }
}

client.once('ready', () => {
  console.log(`Ready! Logged in as ${client.user.tag}`);
  setInterval(pollFeeds, 5000); // every 5s
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing ${interaction.commandName}`);
    console.error(error);
  }
});

client.login(process.env.DISCORD_TOKEN);
