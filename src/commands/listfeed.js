const { SlashCommandBuilder } = require('discord.js');
const { getFeeds } = require('../feeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listfeed')
    .setDescription('List all zKillboard feeds in this channel'),

  async execute(interaction) {
    const feeds = getFeeds(interaction.channel.id);
    const feedNames = Object.keys(feeds);
    if (!feedNames.length) {
      return interaction.reply({ content: 'No feeds in this channel.', ephemeral: true });
    }
    let msg = '**Feeds in this channel:**\n';
    for (const name of feedNames) {
      const f = feeds[name];
      msg += `• \`${name}\` — Filters: \`${JSON.stringify(f)}\`\n`;
    }
    await interaction.reply({ content: msg, ephemeral: true });
  }
};
