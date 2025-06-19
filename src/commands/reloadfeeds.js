const { SlashCommandBuilder } = require('discord.js');
const { loadFeeds } = require('../feeds');

// Only allow admins
function isAdmin(member) {
  return member.permissions.has('Administrator') || member.permissions.has('ManageGuild');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reloadfeeds')
    .setDescription('Reload feeds from storage (Admins only)'),
  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: 'Only server admins may use this command.', ephemeral: true });
    }
    loadFeeds();
    await interaction.reply({ content: 'Feeds reloaded from disk.', ephemeral: true });
  }
};