const { SlashCommandBuilder } = require('discord.js');
const { getFeeds } = require('../feeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listfeed')
    .setDescription('List all zKillboard feeds in this channel'),
  async execute(interaction) {
    const feeds = getFeeds(interaction.channel.id);
    const names = Object.keys(feeds);
    if (!names.length) {
      return interaction.reply({ content: 'No feeds in this channel.', ephemeral: true });
    }
    let msg = '**Feeds:**\n';
    for (const name of names) {
      msg += `\`${name}\`\n`;
    }
    await interaction.reply({ content: msg, ephemeral: true });
  }
};