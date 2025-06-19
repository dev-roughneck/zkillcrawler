const { SlashCommandBuilder } = require('discord.js');
const { getFeeds } = require('../feeds');
const { startRedisQPolling, stopRedisQPolling } = require('../zkill/redisq');
const { livePolls } = require('./addfeed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reloadfeed')
    .setDescription('Restart all zKillboard feeds in this channel'),

  async execute(interaction) {
    const feeds = getFeeds(interaction.channel.id);
    const feedNames = Object.keys(feeds);
    if (!feedNames.length) {
      return interaction.reply({ content: 'No feeds to reload in this channel.', ephemeral: true });
    }
    for (const feedName of feedNames) {
      stopRedisQPolling(feedName, interaction.channel.id, livePolls);
      startRedisQPolling(feedName, interaction.channel.id, feeds[feedName], interaction.channel, `${interaction.channel.id}-${feedName}`, livePolls);
    }
    await interaction.reply({ content: 'All feeds have been restarted for this channel.', ephemeral: true });
  }
};
