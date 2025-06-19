const { SlashCommandBuilder } = require('discord.js');
const { getFeeds } = require('../feeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listfeed')
    .setDescription('List all zKillboard feeds in this channel'),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const feeds = getFeeds(interaction.channel.id);
    const names = Object.keys(feeds);
    if (!names.length) {
      return interaction.editReply({ content: 'No feeds in this channel.' });
    }
    let msg = '**Feeds:**\n';
    for (const name of names) {
      msg += `\`${name}\`\n`;
    }
    await interaction.editReply({ content: msg });
  }
};