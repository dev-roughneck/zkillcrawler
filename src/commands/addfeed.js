const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { getFeeds, setFeed, feedExists } = require('../feeds');
const { startRedisQPolling, stopRedisQPolling } = require('../zkill/redisq');

// In-memory cache for multi-step modal data
const addfeedCache = new Map();
const livePolls = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addfeed')
    .setDescription('Add a new zKillboard feed to this channel, with advanced filters.'),

  async execute(interaction) {
    // STEP 1: Feed Name + 4 Victim Filters
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
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('region')
            .setLabel('Region(s)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('system')
            .setLabel('System(s)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('shiptype')
            .setLabel('Ship Type(s)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('alliance')
            .setLabel('Victim Alliance(s)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        )
      );
    await interaction.showModal(modal);
  },

  // Modal handler for all steps
  async handleModal(interaction) {
    // STEP 1: Feed Name + 4 Victim Filters
    if (interaction.customId === 'addfeed-modal-step1') {
      const feedName = interaction.fields.getTextInputValue('feedname').trim();
      if (!feedName) {
        return interaction.reply({ content: 'Feed name is required.', flags: 1 << 6 });
      }
      if (feedExists(interaction.channel.id, feedName)) {
        return interaction.reply({ content: `Feed \`${feedName}\` already exists in this channel.`, flags: 1 << 6 });
      }

      // Gather first set of fields and cache by a short key
      const step1 = {
        feedName,
        region: interaction.fields.getTextInputValue('region').trim(),
        system: interaction.fields.getTextInputValue('system').trim(),
        shiptype: interaction.fields.getTextInputValue('shiptype').trim(),
        alliance: interaction.fields.getTextInputValue('alliance').trim()
      };
      const cacheKey = `${interaction.user.id}-${Date.now()}`;
      addfeedCache.set(cacheKey, { step1 });

      // Prompt Next button for Step 2
      return interaction.reply({
        content: `Feed name and basic victim filters set for \`${feedName}\`. Click **Next** to set more filters.`,
        flags: 1 << 6,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`addfeed-next-step2|${cacheKey}`)
              .setLabel('Next')
              .setStyle(ButtonStyle.Primary)
          )
        ]
      });
    }

    // STEP 2: Victim Corp/Char + Attacker Alliance/Corp/Char
    if (interaction.customId.startsWith('addfeed-modal-step2|')) {
      const [ , cacheKey ] = interaction.customId.split('|');
      const cache = addfeedCache.get(cacheKey);
      if (!cache || !cache.step1) {
        return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
      }
      const feedName = cache.step1.feedName;

      // Gather next set of fields
      const step2 = {
        corp: interaction.fields.getTextInputValue('corp').trim(),
        character: interaction.fields.getTextInputValue('character').trim(),
        attacker_alliance: interaction.fields.getTextInputValue('attacker_alliance').trim(),
        attacker_corp: interaction.fields.getTextInputValue('attacker_corp').trim(),
        attacker_character: interaction.fields.getTextInputValue('attacker_character').trim()
      };
      addfeedCache.set(cacheKey, { ...cache, step2 });

      // Prompt Next button for Step 3
      return interaction.reply({
        content: `More victim and attacker filters set for \`${feedName}\`. Click **Next** to set ISK and attacker limits.`,
        flags: 1 << 6,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`addfeed-next-step3|${cacheKey}`)
              .setLabel('Next')
              .setStyle(ButtonStyle.Primary)
          )
        ]
      });
    }

    // STEP 3: ISK/attacker limits, finalize and save feed
    if (interaction.customId.startsWith('addfeed-modal-step3|')) {
      const [ , cacheKey ] = interaction.customId.split('|');
      const cache = addfeedCache.get(cacheKey);
      if (!cache || !cache.step1 || !cache.step2) {
        return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
      }
      const feedName = cache.step1.feedName;

      // Gather last fields
      const step3 = {
        min_isk: interaction.fields.getTextInputValue('min_isk').trim(),
        max_isk: interaction.fields.getTextInputValue('max_isk').trim(),
        min_attackers: interaction.fields.getTextInputValue('min_attackers').trim(),
        max_attackers: interaction.fields.getTextInputValue('max_attackers').trim()
      };

      // Merge all steps
      const filters = { ...cache.step1, ...cache.step2, ...step3 };
      delete filters.feedName; // Don't store feedName in filters

      // Save feed config (wrap in { filters } for DB)
      setFeed(interaction.channel.id, feedName, { filters });

      // Start polling (stop previous if exists)
      stopRedisQPolling(feedName, interaction.channel.id, livePolls);
      startRedisQPolling(feedName, interaction.channel.id, filters, interaction.channel, `${interaction.channel.id}-${feedName}`, livePolls);

      // Clean up cache
      addfeedCache.delete(cacheKey);

      return interaction.reply({ content: `Feed \`${feedName}\` created and polling started!`, flags: 1 << 6 });
    }
  },

  // Button handler for stepping between modals
  async handleButton(interaction) {
    // Step 2: Corp/Char/Attacker modal
    if (interaction.customId.startsWith('addfeed-next-step2|')) {
      const [ , cacheKey ] = interaction.customId.split('|');
      const cache = addfeedCache.get(cacheKey);
      if (!cache || !cache.step1) {
        return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
      }
      const modal = new ModalBuilder()
        .setCustomId(`addfeed-modal-step2|${cacheKey}`)
        .setTitle('Add zKillboard Feed (2/3)')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('corp')
              .setLabel('Victim Corp(s)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('character')
              .setLabel('Victim Character(s)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('attacker_alliance')
              .setLabel('Attacker Alliance(s)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('attacker_corp')
              .setLabel('Attacker Corp(s)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('attacker_character')
              .setLabel('Attacker Character(s)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          )
        );
      return interaction.showModal(modal);
    }

    // Step 3: ISK/attacker limits modal
    if (interaction.customId.startsWith('addfeed-next-step3|')) {
      const [ , cacheKey ] = interaction.customId.split('|');
      const cache = addfeedCache.get(cacheKey);
      if (!cache || !cache.step1 || !cache.step2) {
        return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
      }
      const modal = new ModalBuilder()
        .setCustomId(`addfeed-modal-step3|${cacheKey}`)
        .setTitle('Add zKillboard Feed (3/3)')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('min_isk')
              .setLabel('Minimum ISK Value')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('max_isk')
              .setLabel('Maximum ISK Value')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('min_attackers')
              .setLabel('Minimum Attackers')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('max_attackers')
              .setLabel('Maximum Attackers')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          )
        );
      return interaction.showModal(modal);
    }
  },

  // For external use (e.g. stopfeed, reloadfeed)
  livePolls,
};
