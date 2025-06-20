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

const SESSION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

// Full list of possible logic fields, with step and modal key mapping
const filterLogicFieldsMaster = [
  { key: 'corporationIds', label: 'Victim Corp(s)', inputKey: 'corporations', step: 1 },
  { key: 'characterIds', label: 'Victim Character(s)', inputKey: 'characters', step: 1 },
  { key: 'allianceIds', label: 'Victim Alliance(s)', inputKey: 'alliances', step: 1 },
  { key: 'regionIds', label: 'Region(s)', inputKey: 'regions', step: 1 },
  { key: 'attackerCorporationIds', label: 'Attacker Corp(s)', inputKey: 'attacker_corporations', step: 2 },
  { key: 'attackerCharacterIds', label: 'Attacker Character(s)', inputKey: 'attacker_characters', step: 2 },
  { key: 'attackerAllianceIds', label: 'Attacker Alliance(s)', inputKey: 'attacker_alliances', step: 2 },
  { key: 'systemIds', label: 'System(s)', inputKey: 'systems', step: 2 },
  { key: 'shipTypeIds', label: 'Ship Type(s)', inputKey: 'shiptypes', step: 2 }
];

// In-memory cache for multi-step modal data
const addfeedCache = new Map();

function makeLogicSelect(customId, label, defaultValue = 'OR') {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(`Choose logic for ${label}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions([
        { label: 'OR (match any)', value: 'OR', default: defaultValue === 'OR' },
        { label: 'AND (match all)', value: 'AND', default: defaultValue === 'AND' },
        { label: 'IF (match if present)', value: 'IF', default: defaultValue === 'IF' }
      ])
  );
}

function sessionExpired(cache) {
  if (!cache || !cache.createdAt) return true;
  return Date.now() - cache.createdAt > SESSION_TIMEOUT_MS;
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
      addfeedCache.set(cacheKey, { step1, createdAt: Date.now() });

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
      if (sessionExpired(cache)) {
        addfeedCache.delete(cacheKey);
        return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
      }
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
      addfeedCache.set(cacheKey, { ...cache, step2, createdAt: cache.createdAt });

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

    // STEP 4: ISK/attacker limits
    if (interaction.customId.startsWith('addfeed-modal-step3|')) {
      const [ , cacheKey ] = interaction.customId.split('|');
      const cache = addfeedCache.get(cacheKey);
      if (sessionExpired(cache)) {
        addfeedCache.delete(cacheKey);
        return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
      }
      if (!cache || !cache.step1 || !cache.step2 /*| !cache.logicModes*/) {
        return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
      }
      const step3 = {
        min_isk: interaction.fields.getTextInputValue('min_isk').trim(),
        max_isk: interaction.fields.getTextInputValue('max_isk').trim(),
        min_attackers: interaction.fields.getTextInputValue('min_attackers').trim(),
        max_attackers: interaction.fields.getTextInputValue('max_attackers').trim()
      };
      addfeedCache.set(cacheKey, { ...cache, step3, createdAt: cache.createdAt });

      const { step1, step2, logicModes, activeLogicFields } = addfeedCache.get(cacheKey);
      const feedName = step1.feedName;
      const filters = await buildFilterObject(step1, step2, step3, logicModes, activeLogicFields);

      setFeed(interaction.channel.id, feedName, { filters });
      addfeedCache.delete(cacheKey);

      return interaction.reply({ content: `Feed \`${feedName}\` created!`, flags: 1 << 6 });
    }
  },

  async handleButton(interaction) {
    const [ , cacheKey ] = interaction.customId.split('|');
    const cache = addfeedCache.get(cacheKey);
    if (sessionExpired(cache)) {
      addfeedCache.delete(cacheKey);
      return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
    }

    // Step 2: Attacker/location modal
    if (interaction.customId.startsWith('addfeed-next-step2|')) {
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

    // Step 3: Prompt logic for one non-empty filter at a time
    if (interaction.customId.startsWith('addfeed-next-step3|')) {
      if (!cache || !cache.step1 || !cache.step2) {
        return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
      }

      const step1 = cache.step1, step2 = cache.step2;
      const logicFields = filterLogicFieldsMaster.filter(f => {
        if (f.step === 1) return step1[f.inputKey] && step1[f.inputKey].length > 0;
        if (f.step === 2) return step2[f.inputKey] && step2[f.inputKey].length > 0;
        return false;
      });

      if (logicFields.length === 0) {
        return interaction.reply({
          content: 'No filters set that need logic selection. Proceeding to the next step.',
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
      }

      // Store active fields and progress index in cache
      cache.activeLogicFields = logicFields;
      cache.logicProgressIndex = 0;
      addfeedCache.set(cacheKey, cache);

      // Prompt for the first logic select
      const field = logicFields[0];
      return interaction.reply({
        content: `Select logic for **${field.label}**:`,
        flags: 1 << 6,
        components: [
          makeLogicSelect(`logicmode-${field.key}|${cacheKey}`, field.label)
        ]
      });
    }

    // Step 4: ISK/attacker limits modal
    if (interaction.customId.startsWith('addfeed-next-step4|')) {
      if (!cache || !cache.step1 || !cache.step2 /*| !cache.logicModes*/) {
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

  async handleSelect(interaction) {
    const [prefix, cacheKey] = interaction.customId.split('|');
    const filterKey = prefix.replace('logicmode-', '');
    const cache = addfeedCache.get(cacheKey);
    if (sessionExpired(cache)) {
      addfeedCache.delete(cacheKey);
      return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
    }
    if (!cache) {
      return interaction.reply({ content: 'Session expired. Please restart /addfeed.', flags: 1 << 6 });
    }
    if (!cache.logicModes) cache.logicModes = {};
    cache.logicModes[filterKey] = interaction.values[0];

    // Advance to next logic field, or show Next button if done
    const logicFields = cache.activeLogicFields || [];
    let idx = (cache.logicProgressIndex || 0) + 1;
    cache.logicProgressIndex = idx;
    addfeedCache.set(cacheKey, cache);

    if (idx < logicFields.length) {
      // Prompt next logic select
      const field = logicFields[idx];
      return interaction.reply({
        content: `Select logic for **${field.label}**:`,
        flags: 1 << 6,
        components: [
          makeLogicSelect(`logicmode-${field.key}|${cacheKey}`, field.label)
        ]
      });
    } else {
      // All set, show Next button
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
    }
  }
};

// Build the filter object with IDs and logic modes
async function buildFilterObject(step1, step2, step3, logicModes, activeLogicFields) {
  const filters = {};

  // Victim
  filters.corporationIds = await resolveIds(step1.corporations, 'corporation');
  filters.corporationIdsMode = logicModes?.corporationIds || 'OR';
  filters.characterIds = await resolveIds(step1.characters, 'character');
  filters.characterIdsMode = logicModes?.characterIds || 'OR';
  filters.allianceIds = await resolveIds(step1.alliances, 'alliance');
  filters.allianceIdsMode = logicModes?.allianceIds || 'OR';
  filters.regionIds = await resolveIds(step1.regions, 'region');
  filters.regionIdsMode = logicModes?.regionIds || 'OR';

  // Attacker/location
  filters.attackerCorporationIds = await resolveIds(step2.attacker_corporations, 'corporation');
  filters.attackerCorporationIdsMode = logicModes?.attackerCorporationIds || 'OR';
  filters.attackerCharacterIds = await resolveIds(step2.attacker_characters, 'character');
  filters.attackerCharacterIdsMode = logicModes?.attackerCharacterIds || 'OR';
  filters.attackerAllianceIds = await resolveIds(step2.attacker_alliances, 'alliance');
  filters.attackerAllianceIdsMode = logicModes?.attackerAllianceIds || 'OR';
  filters.systemIds = await resolveIds(step2.systems, 'system');
  filters.systemIdsMode = logicModes?.systemIds || 'OR';
  filters.shipTypeIds = await resolveIds(step2.shiptypes, 'shiptype');
  filters.shipTypeIdsMode = logicModes?.shipTypeIds || 'OR';

  // Only override logic modes for the active fields
  if (Array.isArray(activeLogicFields)) {
    for (const f of activeLogicFields) {
      if (logicModes && logicModes[f.key] !== undefined) {
        filters[`${f.key}Mode`] = logicModes[f.key];
      }
    }
  }

  // ISK/attackers
  filters.minValue = parseFloat(step3.min_isk.replace(/,/g, '')) || undefined;
  filters.maxValue = parseFloat(step3.max_isk.replace(/,/g, '')) || undefined;
  filters.minAttackers = parseInt(step3.min_attackers) || undefined;
  filters.maxAttackers = parseInt(step3.max_attackers) || undefined;

  return filters;
}
