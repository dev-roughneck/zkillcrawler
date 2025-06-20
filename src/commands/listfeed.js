const { SlashCommandBuilder } = require('discord.js');
const { getFeeds } = require('../feeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listfeeds')
    .setDescription('List all zKillboard feeds in this channel'),

  async execute(interaction) {
    const feeds = getFeeds(interaction.channel.id);
    const feedNames = Object.keys(feeds);
    if (!feedNames.length) {
      return interaction.reply({ content: 'No feeds in this channel.', ephemeral: true });
    }
    let msg = '**Feeds in this channel:**\n';
    for (const name of feedNames) {
      const { filters } = feeds[name];
      // Clean up display: show only non-empty filters for brevity
      const filterDisplay = Object.entries(filters)
        .filter(([k, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('; ');
      msg += `• \`${name}\` — ${filterDisplay ? `Filters: \`${filterDisplay}\`` : 'No filters'}\n`;
    }
    await interaction.reply({ content: msg, ephemeral: true });
  }
};
