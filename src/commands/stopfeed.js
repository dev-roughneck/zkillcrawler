const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getFeeds, deleteFeed } = require('../feeds');
const { stopZKillWebSocket } = require('../zkill/websocket');
const { liveWebsockets } = require('./addfeed');

function isAdmin(member) {
  return member && member.permissions && (member.permissions.has('Administrator') || member.permissions.has('ManageGuild'));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stopfeed')
    .setDescription('Remove a zKillboard feed from this channel (Admins only)'),
  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: 'Only server admins may use this command.', ephemeral: true });
    }
    const feeds = getFeeds(interaction.channel.id);
    const feedNames = Object.keys(feeds);
    if (!feedNames.length) {
      return interaction.reply({ content: 'No feeds to remove in this channel.', ephemeral: true });
    }
    // If only one feed, remove it directly
    if (feedNames.length === 1) {
      const feedName = feedNames[0];
      stopZKillWebSocket(feedName, interaction.channel.id, liveWebsockets);
      deleteFeed(interaction.channel.id, feedName);
      return interaction.reply({ content: `Feed \`${feedName}\` removed.`, ephemeral: true });
    }
    // More than one feed: show a select menu
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

  // Handler for menu selection
  async handleSelect(interaction) {
    if (interaction.customId !== 'stopfeed-select') return;
    const feedName = interaction.values[0];
    const feeds = getFeeds(interaction.channel.id);
    if (!feeds[feedName]) {
      return interaction.update({ content: `Feed \`${feedName}\` not found.`, components: [] });
    }
    stopZKillWebSocket(feedName, interaction.channel.id, liveWebsockets);
    deleteFeed(interaction.channel.id, feedName);
    await interaction.update({ content: `Feed \`${feedName}\` removed.`, components: [] });
  }
};
