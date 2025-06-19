const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { startRedisQPolling, stopRedisQPolling } = require('../zkill/redisq');
const { formatKillmailEmbed } = require('../embeds');

// In-memory storage for channel filters and polling
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
      { id: 'region', label: 'Region (optional)' },
      { id: 'system', label: 'Solar System (optional)' },
      { id: 'alliance', label: 'Alliance (optional)' },
      { id: 'corp', label: 'Corporation (optional)' },
      { id: 'character', label: 'Character (optional)' },
      { id: 'shiptype', label: 'Defender Shiptype (optional)' },
      { id: 'attackers', label: 'Attacker Shiptype (optional)' },
      { id: 'defenders', label: 'Defender Shiptype (optional)' },
      { id: 'minisk', label: 'Minimum ISK Value (optional)' },
      { id: 'minattackers', label: 'Min # of Attackers (optional)' },
      { id: 'maxattackers', label: 'Max # of Attackers (optional)' },
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
    // Gather filters from modal
    const filters = {};
    for (const field of ['region', 'system', 'alliance', 'corp', 'character', 'shiptype', 'attackers', 'defenders', 'minisk', 'minattackers', 'maxattackers']) {
      const val = interaction.fields.getTextInputValue(field);
      if (val && val.trim() !== '') filters[field] = val.trim();
    }

    const channelId = interaction.channel.id;
    // Stop previous polling, if any
    if (channelConfigs.has(channelId) && channelConfigs.get(channelId).pollTag) {
      stopRedisQPolling(channelConfigs.get(channelId).pollTag, channelId, channelConfigs);
    }

    // Tag for this poll (unique for this channel)
    const pollTag = `zkillsetup-${channelId}`;
    // Start RedisQ polling for this channel
    startRedisQPolling(
      pollTag,
      channelId,
      filters,
      interaction.channel,
      pollTag,
      channelConfigs,
      async (killmail) => {
        try {
          const embed = formatKillmailEmbed(killmail);
          await interaction.channel.send({ embeds: [embed] });
        } catch (err) {
          console.error('Failed to send embed:', err);
        }
      }
    );

    // Store config
    channelConfigs.set(channelId, { filters, pollTag });

    await interaction.reply({
      content: `Filters set!\n\`\`\`json\n${JSON.stringify(filters, null, 2)}\n\`\`\`\nKillmail polling started for this channel.`,
      ephemeral: true
    });
  }
};
