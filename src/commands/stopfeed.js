const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getFeeds, deleteFeed } = require('../feeds');
const { stopRedisQPolling } = require('../zkill/redisq');
const { livePolls } = require('./addfeed'); // If you use livePolls for per-feed state

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stopfeed')
    .setDescription('Remove a zKillboard feed from this channel'),

  async execute(interaction) {
    const feeds = getFeeds(interaction.channel.id);
    const feedNames = Object.keys(feeds);
    if (!feedNames.length) {
      return interaction.reply({ content: 'No feeds to remove in this channel.', ephemeral: true });
    }
    // If only one feed, remove directly
    if (feedNames.length === 1) {
      const feedName = feedNames[0];
      const pollTag = `${interaction.channel.id}-${feedName}`;
      stopRedisQPolling(pollTag);
      deleteFeed(interaction.channel.id, feedName);
      return interaction.reply({ content: `Feed \`${feedName}\` removed from this channel.`, ephemeral: true });
    }
    // Multiple feeds: let user select which to remove
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('stopfeed-select')
      .setPlaceholder('Select a feed to remove')
      .addOptions(feedNames.map(name => ({
        label: name,
        value: name
      })));
    const row = new ActionRowBuilder().addComponents(selectMenu);
    await interaction.reply({
      content: 'Select the feed you want to remove:',
      components: [row],
      ephemeral: true
    });
  },

  // Handle select menu for feed removal
  async handleSelect(interaction) {
    if (interaction.customId !== 'stopfeed-select') return;
    const feedName = interaction.values[0];
    const feeds = getFeeds(interaction.channel.id);
    if (!feeds[feedName]) {
      return interaction.update({ content: `Feed \`${feedName}\` not found.`, components: [] });
    }
    const pollTag = `${interaction.channel.id}-${feedName}`;
    stopRedisQPolling(pollTag);
    deleteFeed(interaction.channel.id, feedName);
    await interaction.update({ content: `Feed \`${feedName}\` removed from this channel.`, components: [] });
  }
};
