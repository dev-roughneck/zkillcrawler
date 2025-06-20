const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const { setFeed, feedExists } = require('../feeds');
const { resolveIds } = require('../eveuniverse'); // Helper to resolve names to IDs

// In-memory cache for multi-step modal data
const addfeedCache = new Map();

// List of filters that support AND/OR/IF logic
const filterLogicFields = [
  { key: 'corporationIds', label: 'Victim Corp(s)' },
  { key: 'characterIds', label: 'Victim Character(s)' },
  { key: 'allianceIds', label: 'Victim Alliance(s)' },
  { key: 'attackerCorporationIds', label: 'Attacker Corp(s)' },
  { key: 'attackerCharacterIds', label: 'Attacker Character(s)' },
  { key: 'attackerAllianceIds', label: 'Attacker Alliance(s)' },
  { key: 'regionIds', label: 'Region(s)' },
  { key: 'systemIds', label: 'System(s)' },
  { key: 'shipTypeIds', label: 'Ship Type(s)' }
];

function makeLogicSelect(customId, label, defaultValue = 'OR') {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(`${label} logic (default: OR)`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions([
        { label: 'OR (match any)', value: 'OR', default: defaultValue === 'OR' },
        { label: 'AND (match all)', value: 'AND', default: defaultValue === 'AND' },
        { label: 'IF (match if present)', value: 'IF', default: defaultValue === 'IF' }
      ])
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addfeed')
    .setDescription('Add a new zKillboard feed to this channel, with advanced filters.'),

  async execute(interaction) {
    // STEP 1: Feed Name + Victim/Location Filters
    try {
      const modal = new ModalBuilder()
        .setCustomId('addfeed-modal-step1')
        .setTitle('Add zKillboard Feed (1/4)')
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
              .setCustomId('corporations')
              .setLabel('Victim Corp(s) (name or ID, comma-sep)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('characters')
              .setLabel('Victim Character(s) (name or ID, comma-sep)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('alliances')
              .setLabel('Victim Alliance(s) (name or ID, comma-sep)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('regions')
              .setLabel('Region(s) (name or ID, comma-sep)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          )
        );
      await interaction.showModal(modal);
    } catch (err) {
      console.error('Error in /addfeed:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({content: 'Error: Could not show modal', ephemeral: true});
      }
    }
  },

  // Modal handler for all steps
  async handleModal(interaction) {
    // STEP 1: Victim/Location Filters
    if (interaction.customId === 'addfeed-modal-step1') {
      const feedName = interaction.fields.getTextInputValue('feedname').trim();
      if (!feedName) {
        return interaction.reply({ content: 'Feed name is required.', flags: 1 << 6 });
      }
      if (feedExists(interaction.channel.id, feedName)) {
        return interaction.reply({ content: `Feed \`${feedName}\` already exists in this channel.`, flags: 1 << 6 });
      }

      const step1 = {
        feedName,
        corporations: interaction.fields.getTextInputValue('corporations').trim(),
        characters: interaction.fields.getTextInputValue('characters').trim(),
        alliances: interaction.fields.getTextInputValue('alliances').trim(),
        regions: interaction.fields.getTextInputValue('regions').trim()
      };
      const cacheKey = `${interaction.user.id}-${Date.now()}`;
      addfeedCache.set(cacheKey, { step1 });

      // Prompt Next button for Step 2
      return interaction.reply({
        content: `Basic victim and region filters set for \`${feedName}\`. Click **Next** to set attacker/location filters.`,
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

    // STEP 2: Attacker/Location Filters
    if (interaction.customId.startsWith('addfeed-modal-step2|')) {
      const [ , cacheKey ] = interaction.customId.split('|');
      const cache = addfeedCache.get(cacheKey);
      if (!cache || !cache.step1) {
        return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
      }
      const step2 = {
        attacker_corporations: interaction.fields.getTextInputValue('attacker_corporations').trim(),
        attacker_characters: interaction.fields.getTextInputValue('attacker_characters').trim(),
        attacker_alliances: interaction.fields.getTextInputValue('attacker_alliances').trim(),
        systems: interaction.fields.getTextInputValue('systems').trim(),
        shiptypes: interaction.fields.getTextInputValue('shiptypes').trim()
      };
      addfeedCache.set(cacheKey, { ...cache, step2 });

      // Prompt Next button for Step 3 (logic selectors)
      return interaction.reply({
        content: `Attacker and location filters set. Now select AND/OR/IF logic for each filter.`,
        flags: 1 << 6,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`addfeed-next-step3|${cacheKey}`)
              .setLabel('Set Filter Logic')
              .setStyle(ButtonStyle.Primary)
          )
        ]
      });
    }

    // STEP 3: ISK/attacker limits
    if (interaction.customId.startsWith('addfeed-modal-step3|')) {
      const [ , cacheKey ] = interaction.customId.split('|');
      const cache = addfeedCache.get(cacheKey);
      if (!cache || !cache.step1 || !cache.step2 || !cache.logicModes) {
        return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
      }
      const step3 = {
        min_isk: interaction.fields.getTextInputValue('min_isk').trim(),
        max_isk: interaction.fields.getTextInputValue('max_isk').trim(),
        min_attackers: interaction.fields.getTextInputValue('min_attackers').trim(),
        max_attackers: interaction.fields.getTextInputValue('max_attackers').trim()
      };
      addfeedCache.set(cacheKey, { ...cache, step3 });

      // Finalize: resolve IDs, build filters, save
      const { step1, step2, logicModes } = addfeedCache.get(cacheKey);
      const feedName = step1.feedName;
      const filters = await buildFilterObject(step1, step2, step3, logicModes);

      setFeed(interaction.channel.id, feedName, { filters });
      addfeedCache.delete(cacheKey);

      return interaction.reply({ content: `Feed \`${feedName}\` created!`, flags: 1 << 6 });
    }
  },

  // Button handler for stepping between modals and logic selectors
  async handleButton(interaction) {
    // Step 2: Attacker/location modal
    if (interaction.customId.startsWith('addfeed-next-step2|')) {
      const [ , cacheKey ] = interaction.customId.split('|');
      const cache = addfeedCache.get(cacheKey);
      if (!cache || !cache.step1) {
        return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
      }

      const modal = new ModalBuilder()
        .setCustomId(`addfeed-modal-step2|${cacheKey}`)
        .setTitle('Add zKillboard Feed (2/4)')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('attacker_corporations')
              .setLabel('Attacker Corp(s) (name or ID, comma-sep)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('attacker_characters')
              .setLabel('Attacker Character(s) (name or ID, comma-sep)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('attacker_alliances')
              .setLabel('Attacker Alliance(s) (name or ID, comma-sep)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('systems')
              .setLabel('System(s) (name or ID, comma-sep)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('shiptypes')
              .setLabel('Ship Type(s) (name or ID, comma-sep)')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          )
        );
      return interaction.showModal(modal);
    }

    // Step 3: Filter logic mode (AND/OR/IF) selectors
    if (interaction.customId.startsWith('addfeed-next-step3|')) {
      const [ , cacheKey ] = interaction.customId.split('|');
      const cache = addfeedCache.get(cacheKey);
      if (!cache || !cache.step1 || !cache.step2) {
        return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
      }

      // Build selects for each filter with labels as placeholders
      const components = filterLogicFields.map(f =>
        makeLogicSelect(`logicmode-${f.key}|${cacheKey}`, f.label)
      );

      // Discord allows max 5 components per message, so batch if needed
      let replyComponents = components.slice(0, 5);
      let more = components.length > 5;

      // Always add the submit button in a new ActionRow
      replyComponents.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`addfeed-next-step4|${cacheKey}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
        )
      );

      return interaction.reply({
        content:
          'Select AND/OR/IF logic for each filter type below. ' +
          (more
            ? 'For more filters, repeat the process after submitting these.'
            : ''),
        flags: 1 << 6,
        components: replyComponents
      });
    }

    // Step 4: ISK/attacker limits modal
    if (interaction.customId.startsWith('addfeed-next-step4|')) {
      const [ , cacheKey ] = interaction.customId.split('|');
      const cache = addfeedCache.get(cacheKey);
      if (!cache || !cache.step1 || !cache.step2 || !cache.logicModes) {
        return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
      }
      const modal = new ModalBuilder()
        .setCustomId(`addfeed-modal-step3|${cacheKey}`)
        .setTitle('Add zKillboard Feed (4/4)')
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

  // Select menu logic (AND/OR/IF) handler
  async handleSelect(interaction) {
    if (interaction.customId.startsWith('logicmode-')) {
      const [prefix, cacheKey] = interaction.customId.split('|');
      const filterKey = prefix.replace('logicmode-', '');
      const cache = addfeedCache.get(cacheKey);
      if (!cache) {
        return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
      }
      if (!cache.logicModes) cache.logicModes = {};
      cache.logicModes[filterKey] = interaction.values[0];
      addfeedCache.set(cacheKey, cache);

      // Check if all logic modes are set
      const allSet = filterLogicFields.every(f => cache.logicModes && cache.logicModes[f.key]);
      if (allSet) {
        // If all are set, enable the "Next" button for user to proceed
        return interaction.reply({
          content: 'All filter logics selected. Click **Next** to set ISK/attacker limits and save.',
          flags: 1 << 6,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`addfeed-next-step4|${cacheKey}`)
                .setLabel('Next')
                .setStyle(ButtonStyle.Primary)
            )
          ]
        });
      } else {
        // Otherwise, ask the user to continue selecting
        return interaction.reply({
          content: `Selected logic for ${filterKey}. Continue selecting logics for all filters.`,
          flags: 1 << 6,
          components: [] // No more selects
        });
      }
    }
  }
};

// Build the filter object with IDs and logic modes
async function buildFilterObject(step1, step2, step3, logicModes) {
  const filters = {};

  // Victim
  filters.corporationIds = await resolveIds(step1.corporations, 'corporation');
  filters.corporationIdsMode = logicModes?.corporationIds || 'OR';

  filters.characterIds = await resolveIds(step1.characters, 'character');
  filters.characterIdsMode = logicModes?.characterIds || 'OR';

  filters.allianceIds = await resolveIds(step1.alliances, 'alliance');
  filters.allianceIdsMode = logicModes?.allianceIds || 'OR';

  // Location
  filters.regionIds = await resolveIds(step1.regions, 'region');
  filters.regionIdsMode = logicModes?.regionIds || 'OR';

  filters.systemIds = await resolveIds(step2.systems, 'system');
  filters.systemIdsMode = logicModes?.systemIds || 'OR';

  // Ship type
  filters.shipTypeIds = await resolveIds(step2.shiptypes, 'shiptype');
  filters.shipTypeIdsMode = logicModes?.shipTypeIds || 'OR';

  // Attacker
  filters.attackerCorporationIds = await resolveIds(step2.attacker_corporations, 'corporation');
  filters.attackerCorporationIdsMode = logicModes?.attackerCorporationIds || 'OR';

  filters.attackerCharacterIds = await resolveIds(step2.attacker_characters, 'character');
  filters.attackerCharacterIdsMode = logicModes?.attackerCharacterIds || 'OR';

  filters.attackerAllianceIds = await resolveIds(step2.attacker_alliances, 'alliance');
  filters.attackerAllianceIdsMode = logicModes?.attackerAllianceIds || 'OR';

  // ISK/attackers
  filters.minValue = parseFloat(step3.min_isk.replace(/,/g, '')) || undefined;
  filters.maxValue = parseFloat(step3.max_isk.replace(/,/g, '')) || undefined;
  filters.minAttackers = parseInt(step3.min_attackers) || undefined;
  filters.maxAttackers = parseInt(step3.max_attackers) || undefined;

  return filters;
}
