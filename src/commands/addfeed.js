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
        return interaction.reply({ content: 'Feed name is required.', ephemeral: true });
      }
      if (feedExists(interaction.channel.id, feedName)) {
        return interaction.reply({ content: `Feed \`${feedName}\` already exists in this channel.`, ephemeral: true });
      }

      // Gather first set of fields
      const victimFiltersPart1 = {
        feedName,
        region: interaction.fields.getTextInputValue('region').trim(),
        system: interaction.fields.getTextInputValue('system').trim(),
        shiptype: interaction.fields.getTextInputValue('shiptype').trim(),
        alliance: interaction.fields.getTextInputValue('alliance').trim(),
      };
      const encodedPart1 = Buffer.from(JSON.stringify(victimFiltersPart1)).toString('base64');

      // Prompt Next button for Step 2
      return interaction.reply({
        content: `Feed name and basic victim filters set for \`${feedName}\`. Click **Next** to set more filters.`,
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`addfeed-next-step2|${encodedPart1}`)
              .setLabel('Next')
              .setStyle(ButtonStyle.Primary)
          )
        ]
      });
    }

    // STEP 2: Victim Corp/Char + Attacker Alliance/Corp/Char
    if (interaction.customId.startsWith('addfeed-modal-step2|')) {
      const [ , encodedPart1 ] = interaction.customId.split('|');
      const victimFiltersPart1 = JSON.parse(Buffer.from(encodedPart1, 'base64').toString('utf8'));
      const feedName = victimFiltersPart1.feedName;

      // Gather next set of fields
      const victimFiltersPart2 = {
        corp: interaction.fields.getTextInputValue('corp').trim(),
        character: interaction.fields.getTextInputValue('character').trim(),
        attacker_alliance: interaction.fields.getTextInputValue('attacker_alliance').trim(),
        attacker_corp: interaction.fields.getTextInputValue('attacker_corp').trim(),
        attacker_character: interaction.fields.getTextInputValue('attacker_character').trim(),
      };

      // Merge parts 1 and 2 for next step
      const allFiltersPart1And2 = { ...victimFiltersPart1, ...victimFiltersPart2 };
      const encoded1And2 = Buffer.from(JSON.stringify(allFiltersPart1And2)).toString('base64');

      // Prompt Next button for Step 3
      return interaction.reply({
        content: `More victim and attacker filters set for \`${feedName}\`. Click **Next** to set ISK and attacker limits.`,
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`addfeed-next-step3|${encoded1And2}`)
              .setLabel('Next')
              .setStyle(ButtonStyle.Primary)
          )
        ]
      });
    }

    // STEP 3: ISK/attacker limits, finalize and save feed
    if (interaction.customId.startsWith('addfeed-modal-step3|')) {
      const [ , encoded1And2 ] = interaction.customId.split('|');
      const filters = JSON.parse(Buffer.from(encoded1And2, 'base64').toString('utf8'));
      const feedName = filters.feedName;

      // Gather last fields
      filters.min_isk = interaction.fields.getTextInputValue('min_isk').trim();
      filters.max_isk = interaction.fields.getTextInputValue('max_isk').trim();
      filters.min_attackers = interaction.fields.getTextInputValue('min_attackers').trim();
      filters.max_attackers = interaction.fields.getTextInputValue('max_attackers').trim();

      // Remove feedName from filters to avoid redundancy in DB
      delete filters.feedName;

      // Save feed config (wrap in { filters } for DB)
      setFeed(interaction.channel.id, feedName, { filters });

      // Start polling (stop previous if exists)
      stopRedisQPolling(feedName, interaction.channel.id, livePolls);
      startRedisQPolling(feedName, interaction.channel.id, filters, interaction.channel, `${interaction.channel.id}-${feedName}`, livePolls);

      return interaction.reply({ content: `Feed \`${feedName}\` created and polling started!`, ephemeral: true });
    }
  },

  // Button handler for stepping between modals
  async handleButton(interaction) {
    // Step 2: Corp/Char/Attacker modal
    if (interaction.customId.startsWith('addfeed-next-step2|')) {
      const [ , encodedPart1 ] = interaction.customId.split('|');
      const modal = new ModalBuilder()
        .setCustomId(`addfeed-modal-step2|${encodedPart1}`)
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
      const [ , encoded1And2 ] = interaction.customId.split('|');
      const modal = new ModalBuilder()
        .setCustomId(`addfeed-modal-step3|${encoded1And2}`)
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
