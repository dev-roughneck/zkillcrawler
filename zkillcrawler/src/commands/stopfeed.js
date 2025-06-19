const { SlashCommandBuilder } = require('discord.js');
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
    let feedName = feedNames[0];
    if (feedNames.length > 1) {
      await interaction.reply({ content: `Feeds:\n${feedNames.map(f => `\`${f}\``).join('\n')}\nReply with the feed name to remove.`, ephemeral: true });
      return;
    }
    stopZKillWebSocket(feedName, interaction.channel.id, liveWebsockets);
    deleteFeed(interaction.channel.id, feedName);
    await interaction.reply({ content: `Feed \`${feedName}\` removed.`, ephemeral: true });
  }
};