const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionType } = require('discord.js');
const { getFeeds, saveFeed, feedExists } = require('../feeds');
const { startRedisQPolling, stopRedisQPolling } = require('../zkill/redisq');

const livePolls = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addfeed')
    .setDescription('Add a new zKillboard feed to this channel, with advanced filters.'),

  async execute(interaction) {
    // STEP 1: Feed name
    const modal = new ModalBuilder()
      .setCustomId('addfeed-modal-step1')
      .setTitle('Add zKillboard Feed (1/3)')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('feedname')
            .setLabel('Feed Name (unique)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
  },

  // Modal handler for all steps
  async handleModal(interaction) {
    // STEP 1: Name
    if (interaction.customId === 'addfeed-modal-step1') {
      const feedName = interaction.fields.getTextInputValue('feedname').trim();
      if (!feedName) {
        return interaction.reply({ content: 'Feed name is required.', ephemeral: true });
      }
      if (feedExists(interaction.channel.id, feedName)) {
        return interaction.reply({ content: `Feed \`${feedName}\` already exists in this channel.`, ephemeral: true });
      }
      // Show STEP 2: Victim filters
      const modal = new ModalBuilder()
        .setCustomId(`addfeed-modal-step2|${feedName}`)
        .setTitle('Add zKillboard Feed (2/3)')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('region')
              .setLabel('Region Name(s), comma separated')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('system')
              .setLabel('System Name(s), comma separated')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('shiptype')
              .setLabel('Victim Ship Type(s), comma separated')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('alliance')
              .setLabel('Victim Alliance Name(s), comma separated')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('corp')
              .setLabel('Victim Corp Name(s), comma separated')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('character')
              .setLabel('Victim Character Name(s), comma separated')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          )
        );
      return interaction.reply({ content: 'Feed name accepted! Now set victim filters.', ephemeral: true, components: [], fetchReply: true })
        .then(() => interaction.showModal(modal));
    }

    // STEP 2: Attacker filters
    if (interaction.customId.startsWith('addfeed-modal-step2|')) {
      const feedName = interaction.customId.split('|')[1];
      // Save victim filter responses in interaction's ephemeral state
      const victimFilters = {
        region: interaction.fields.getTextInputValue('region').trim(),
        system: interaction.fields.getTextInputValue('system').trim(),
        shiptype: interaction.fields.getTextInputValue('shiptype').trim(),
        alliance: interaction.fields.getTextInputValue('alliance').trim(),
        corp: interaction.fields.getTextInputValue('corp').trim(),
        character: interaction.fields.getTextInputValue('character').trim()
      };
      // Show STEP 3: Attacker filters + ISK/attacker counts
      const modal = new ModalBuilder()
        .setCustomId(`addfeed-modal-step3|${feedName}|${Buffer.from(JSON.stringify(victimFilters)).toString('base64')}`)
        .setTitle('Add zKillboard Feed (3/3)')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('attacker_alliance')
              .setLabel('Attacker Alliance Name(s), comma separated')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('attacker_corp')
              .setLabel('Attacker Corp Name(s), comma separated')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('attacker_character')
              .setLabel('Attacker Character Name(s), comma separated')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('attacker_shiptype')
              .setLabel('Attacker Ship Type(s), comma separated')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('minisk')
              .setLabel('Minimum ISK Value')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('minattackers')
              .setLabel('Minimum Attackers')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('maxattackers')
              .setLabel('Maximum Attackers')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          )
        );
      return interaction.reply({ content: 'Victim filters accepted! Now set attacker filters.', ephemeral: true, components: [], fetchReply: true })
        .then(() => interaction.showModal(modal));
    }

    // STEP 3: Finalize and save feed
    if (interaction.customId.startsWith('addfeed-modal-step3|')) {
      const [ , feedName, encodedVictimFilters ] = interaction.customId.split('|');
      const victimFilters = JSON.parse(Buffer.from(encodedVictimFilters, 'base64').toString('utf8'));
      // Gather all filters
      const filters = {
        ...victimFilters,
        attacker_alliance: interaction.fields.getTextInputValue('attacker_alliance').trim(),
        attacker_corp: interaction.fields.getTextInputValue('attacker_corp').trim(),
        attacker_character: interaction.fields.getTextInputValue('attacker_character').trim(),
        attacker_shiptype: interaction.fields.getTextInputValue('attacker_shiptype').trim(),
        minisk: interaction.fields.getTextInputValue('minisk').trim(),
        minattackers: interaction.fields.getTextInputValue('minattackers').trim(),
        maxattackers: interaction.fields.getTextInputValue('maxattackers').trim()
      };

      // Save feed config
      saveFeed(interaction.channel.id, feedName, filters);

      // Start polling (stop previous if exists)
      stopRedisQPolling(feedName, interaction.channel.id, livePolls);
      startRedisQPolling(feedName, interaction.channel.id, filters, interaction.channel, `${interaction.channel.id}-${feedName}`, livePolls);

      return interaction.reply({ content: `Feed \`${feedName}\` created and polling started!`, ephemeral: true });
    }
  },

  // For external use (e.g. stopfeed, reloadfeed)
  livePolls,
};
