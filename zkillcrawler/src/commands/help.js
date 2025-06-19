const { SlashCommandBuilder } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help for the zKillboard bot'),
  async execute(interaction) {
    await interaction.reply({
      content:
        "**zKillboard Discord Bot Help**\n\n" +
        "This bot streams EVE Online killmails from zKillboard to Discord channels with advanced filtering.\n\n" +
        "**Commands:**\n" +
        "- `/addfeed` — Add a new killmail feed (Admins only). You can specify multiple values or negations for any field using commas and ! (e.g. `!Goonswarm Federation,TEST Alliance`).\n" +
        "- `/editfeed` — Edit a feed's name or filters (Admins only).\n" +
        "- `/listfeed` — List all feeds in the channel (Admins only).\n" +
        "- `/stopfeed` — Stop and delete a feed (Admins only).\n" +
        "- `/reloadfeeds` — Reload feeds from disk (Admins only).\n" +
        "- `/help` — This help message.\n\n" +
        "**Filter Syntax:**\n" +
        "- Most fields accept names or IDs. Multiple values: separate with commas.\n" +
        "- Negation: prefix value with ! (e.g. `!Delve` to exclude Delve region).\n" +
        "- Supported fields: Region, System, Shiptype, Alliance, Corporation, Character, Min ISK, Min/Max Attackers.\n\n" +
        "**Output:**\n" +
        "- Each killmail is posted as a zKillboard URL (Discord unfurls it) and a rich embed with system, region, ship, ISK value, and more.\n\n" +
        "**More info:** See the README in the repository for full usage and filter examples.",
      ephemeral: true
    });
  }
};