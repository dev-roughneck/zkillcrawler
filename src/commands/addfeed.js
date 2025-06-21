const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
} = require('discord.js');
const { setFeed, feedExists } = require('../feeds');
const { resolveIds } = require('../eveuniverse');

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

async function promptForText(interaction, question, cacheKey, fieldKey, allowBlank = false) {
  await interaction.followUp({
    content: question,
    ephemeral: true
  });

  const filter = msg => msg.author.id === interaction.user.id && msg.channel.id === interaction.channel.id;
  try {
    const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
    const value = collected.first().content.trim();
    if (!allowBlank && !value) {
      await interaction.followUp({ content: `${fieldKey.replace(/_/g, ' ')} is required. Please run /addfeed again.`, ephemeral: true });
      addfeedCache.delete(cacheKey);
      throw new Error('Input is empty');
    }
    const cache = addfeedCache.get(cacheKey);
    cache[fieldKey] = value;
    addfeedCache.set(cacheKey, cache);
    return value;
  } catch {
    await interaction.followUp({ content: 'Timed out waiting for input. Please run /addfeed again.', ephemeral: true });
    addfeedCache.delete(cacheKey);
    throw new Error('Input timed out');
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addfeed')
    .setDescription('Add a new zKillboard feed to this channel, with advanced filters.')
    .addStringOption(option =>
      option.setName('feedname')
        .setDescription('The unique name for this feed')
        .setRequired(true)
    ),
  async execute(interaction) {
    try {
      // Step 1: Get feed name from slash command option
     const feedNameRaw = interaction.options.getString('feedname');
const feedName = feedNameRaw ? feedNameRaw.trim() : '';
if (!feedName) {
  await interaction.reply({ content: 'Feed name is required. Please run /addfeed again.', ephemeral: true });
  return;
}
      if (feedExists(interaction.channel.id, feedName)) {
        await interaction.reply({ content: `Feed \`${feedName}\` already exists in this channel.`, ephemeral: true });
        return;
      }

      // Step 2: Present select menu for which filters to set
      await interaction.reply({
        content: 'Select the filters you wish to set for this feed (you will provide values for each):',
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('addfeed-selectfilters')
              .setPlaceholder('Select filters')
              .addOptions([
                { label: 'Victim Corp(s)', value: 'corporations' },
                { label: 'Victim Character(s)', value: 'characters' },
                { label: 'Victim Alliance(s)', value: 'alliances' },
                { label: 'Region(s)', value: 'regions' },
                { label: 'Attacker Corp(s)', value: 'attacker_corporations' },
                { label: 'Attacker Character(s)', value: 'attacker_characters' },
                { label: 'Attacker Alliance(s)', value: 'attacker_alliances' },
                { label: 'System(s)', value: 'systems' },
                { label: 'Ship Type(s)', value: 'shiptypes' }
              ])
              .setMinValues(1)
          )
        ],
        ephemeral: true,
      });

      // Wait for select menu interaction
      const selectInt = await interaction.channel.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id && i.customId === 'addfeed-selectfilters', time: 60000 });
      const selectedFilters = selectInt.values;

      // Cache initial state
      const cacheKey = `${interaction.user.id}-${Date.now()}`;
      const cache = {
        feedName,
        selectedFilters,
        createdAt: Date.now()
      };
      addfeedCache.set(cacheKey, cache);
      await selectInt.reply({ content: `You selected: ${selectedFilters.join(', ')}`, ephemeral: true });

      // Step 3: Prompt for each selected filter value (text-based)
      for (const filterField of selectedFilters) {
        const label = filterLogicFieldsMaster.find(o => o.inputKey === filterField)?.label || filterField;
        let prompt = `Enter value(s) for **${label}** (comma-separated, or leave blank for none):`;
        await promptForText(selectInt, prompt, cacheKey, filterField, true);
      }

      // Step 4: Prompt for ISK/attacker limits (allow blank)
      await promptForText(selectInt, 'Enter minimum ISK value (or leave blank):', cacheKey, 'min_isk', true);
      await promptForText(selectInt, 'Enter maximum ISK value (or leave blank):', cacheKey, 'max_isk', true);
      await promptForText(selectInt, 'Enter minimum attackers (or leave blank):', cacheKey, 'min_attackers', true);
      await promptForText(selectInt, 'Enter maximum attackers (or leave blank):', cacheKey, 'max_attackers', true);

      // Step 5: For each filter, ask for AND/OR/IF logic via select menu
      const logicModes = {};
      for (const filterField of selectedFilters) {
        const logicField = filterLogicFieldsMaster.find(f => f.inputKey === filterField);
        if (!logicField) continue;
        const logicSelectRow = makeLogicSelect(`logicmode-${logicField.key}|${cacheKey}`, logicField.label);
        await selectInt.followUp({
          content: `Select logic for **${logicField.label}**:`,
          components: [logicSelectRow],
          ephemeral: true
        });
        const logicInt = await interaction.channel.awaitMessageComponent({
          filter: i => i.user.id === interaction.user.id && i.customId.startsWith(`logicmode-${logicField.key}|`),
          time: 60000
        });
        logicModes[logicField.key] = logicInt.values[0];
        await logicInt.reply({ content: `Set logic for ${logicField.label}: ${logicInt.values[0]}`, ephemeral: true });
      }

      // Step 6: Build filter object and save
      const cacheFinal = addfeedCache.get(cacheKey);
      const step1 = {
        feedName: cacheFinal.feedName,
        corporations: cacheFinal.corporations || '',
        characters: cacheFinal.characters || '',
        alliances: cacheFinal.alliances || '',
        regions: cacheFinal.regions || ''
      };
      const step2 = {
        attacker_corporations: cacheFinal.attacker_corporations || '',
        attacker_characters: cacheFinal.attacker_characters || '',
        attacker_alliances: cacheFinal.attacker_alliances || '',
        systems: cacheFinal.systems || '',
        shiptypes: cacheFinal.shiptypes || ''
      };
      const step3 = {
        min_isk: cacheFinal.min_isk || '',
        max_isk: cacheFinal.max_isk || '',
        min_attackers: cacheFinal.min_attackers || '',
        max_attackers: cacheFinal.max_attackers || ''
      };
      const filters = await buildFilterObject(step1, step2, step3, logicModes, filterLogicFieldsMaster.filter(f => selectedFilters.includes(f.inputKey)));
      setFeed(interaction.channel.id, feedName, { filters });
      addfeedCache.delete(cacheKey);
      await interaction.followUp({ content: `Feed \`${feedName}\` created and saved!`, ephemeral: true });
    } catch (err) {
      console.error('Error in addfeed wizard:', err);
      try {
        await interaction.followUp({ content: 'An error occurred. Please try again.', ephemeral: true });
      } catch {}
    }
  }
};

async function buildFilterObject(step1, step2, step3, logicModes, activeLogicFields) {
  const filters = {};
  filters.corporationIds = await resolveIds(step1.corporations, 'corporation');
  filters.corporationIdsMode = logicModes?.corporationIds || 'OR';
  filters.characterIds = await resolveIds(step1.characters, 'character');
  filters.characterIdsMode = logicModes?.characterIds || 'OR';
  filters.allianceIds = await resolveIds(step1.alliances, 'alliance');
  filters.allianceIdsMode = logicModes?.allianceIds || 'OR';
  filters.regionIds = await resolveIds(step1.regions, 'region');
  filters.regionIdsMode = logicModes?.regionIds || 'OR';

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

  if (Array.isArray(activeLogicFields)) {
    for (const f of activeLogicFields) {
      if (logicModes && logicModes[f.key] !== undefined) {
        filters[`${f.key}Mode`] = logicModes[f.key];
      }
    }
  }

  filters.minValue = step3.min_isk && !isNaN(parseFloat(step3.min_isk.replace(/,/g, ''))) ? parseFloat(step3.min_isk.replace(/,/g, '')) : undefined;
  filters.maxValue = step3.max_isk && !isNaN(parseFloat(step3.max_isk.replace(/,/g, ''))) ? parseFloat(step3.max_isk.replace(/,/g, '')) : undefined;
  filters.minAttackers = step3.min_attackers && !isNaN(parseInt(step3.min_attackers)) ? parseInt(step3.min_attackers) : undefined;
  filters.maxAttackers = step3.max_attackers && !isNaN(parseInt(step3.max_attackers)) ? parseInt(step3.max_attackers) : undefined;

  return filters;
}
