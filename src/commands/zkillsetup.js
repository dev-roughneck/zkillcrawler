const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const redisq = require('../zkill/redisq');
const { formatKillmailEmbed } = require('../embeds');

// In-memory storage for channel filters and WebSocket instances
const channelConfigs = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('zkillsetup')
    .setDescription('Set up zKillboard killmail filters for this channel'),
  async execute(interaction) {
    // Modal with all filter fields
    const modal = new ModalBuilder()
      .setCustomId('zkill-filters')
      .setTitle('zKillboard Filter Setup');

    const fields = [
      { id: 'region', label: 'Region (optional)', required: false },
      { id: 'system', label: 'Solar System (optional)', required: false },
      { id: 'alliance', label: 'Alliance (optional)', required: false },
      { id: 'corp', label: 'Corporation (optional)', required: false },
      { id: 'character', label: 'Character (optional)', required: false },
      { id: 'shiptype', label: 'Defender Shiptype (optional)', required: false },
      { id: 'attackers', label: 'Attacker Shiptype (optional)', required: false },
      { id: 'defenders', label: 'Defender Shiptype (optional)', required: false },
      { id: 'minisk', label: 'Minimum ISK Value (optional)', required: false },
      { id: 'minattackers', label: 'Min # of Attackers (optional)', required: false },
      { id: 'maxattackers', label: 'Max # of Attackers (optional)', required: false },
    ];

    modal.addComponents(...fields.map(f =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(f.id)
          .setLabel(f.label)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      )
    ));

    await interaction.showModal(modal);
  },

  async handleModal(interaction) {
    const filters = {};
    for (const field of ['region', 'system', 'alliance', 'corp', 'character', 'shiptype', 'attackers', 'defenders', 'minisk', 'minattackers', 'maxattackers']) {
      filters[field] = interaction.fields.getTextInputValue(field) || undefined;
    }

    // Save config and start zkill stream for this channel
    const channelId = interaction.channel.id;
    if (channelConfigs.has(channelId)) {
      // Clean up previous websocket if already running
      const ws = channelConfigs.get(channelId).ws;
      if (ws) ws.close();
    }

    // Start zKill WebSocket for this channel with filters
    const ws = startZKillWebSocket(filters, async (killmail) => {
      try {
        const embed = formatKillmailEmbed(killmail);
        await interaction.channel.send({ embeds: [embed] });
      } catch (err) {
        console.error('Failed to send embed:', err);
      }
    });

    channelConfigs.set(channelId, { filters, ws });

    await interaction.reply({
      content: `Filters set!\n\`\`\`json\n${JSON.stringify(filters, null, 2)}\n\`\`\`\nKillmail stream started for this channel.`,
      ephemeral: true
    });
  }
};
