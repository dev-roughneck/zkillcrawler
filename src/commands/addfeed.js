const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
} = require('discord.js');
const { setFeed, feedExists } = require('../feeds');

const filterLogicFieldsMaster = [
  { key: 'corporationIds', label: 'Victim Corp(s)', inputKey: 'corporations', step: 1 },
  { key: 'characterIds', label: 'Victim Character(s)', inputKey: 'characters', step: 1 },
  { key: 'allianceIds', label: 'Victim Alliance(s)', inputKey: 'alliances', step: 1 },
  { key: 'regionIds', label: 'Region(s)', inputKey: 'regions', step: 1 },
  { key: 'attackerCorporationIds', label: 'Attacker Corp(s)', inputKey: 'attacker_corporations', step: 2 },
  { key: 'attackerCharacterIds', label: 'Attacker Character(s)', inputKey: 'attacker_characters', step: 2 },
  { key: 'attackerAllianceIds', label: 'Attacker Alliance(s)', inputKey: 'attacker_alliances', step: 2 },
  { key: 'systemIds', label: 'System(s)', inputKey: 'systems', step: 2 },
  { key: 'shipTypeIds', label: 'Ship Type(s)', inputKey: 'shiptypes', step: 2 },
  { key: 'securityClass', label: 'System Security Class', inputKey: 'security_class', step: 2 },
  { key: 'distanceFromSystem', label: 'Max Lightyears from System', inputKey: 'distance_from_system', step: 2 },
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

async function promptForText(interaction, question, cacheKey, fieldKey, allowBlank = false, idOnly = false) {
  let msg = question;
  if (idOnly) msg += '\n**Enter numeric ID(s) only, comma-separated. Names are not accepted.**';
  if (typeof msg === 'string' && msg.trim().length > 0) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: msg, ephemeral: true });
    } else {
      await interaction.followUp({ content: msg, ephemeral: true });
    }
  }
  const filter = msg => msg.author.id === interaction.user.id && msg.channel.id === interaction.channel.id;
  try {
    const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
    const value = collected.first().content.trim();
    if (!allowBlank && !value) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `${fieldKey.replace(/_/g, ' ')} is required. Please run /addfeed again.`, ephemeral: true });
      } else {
        await interaction.followUp({ content: `${fieldKey.replace(/_/g, ' ')} is required. Please run /addfeed again.`, ephemeral: true });
      }
      addfeedCache.delete(cacheKey);
      throw new Error('Input is empty');
    }
    if (idOnly && value) {
      const parts = value.split(',').map(v => v.trim());
      if (!parts.every(v => /^\d+$/.test(v))) {
        await interaction.followUp({
          content: '❌ Only numeric ID(s) are allowed. Names are not accepted. Please look up the correct ID and try again.',
          ephemeral: true
        });
        addfeedCache.delete(cacheKey);
        throw new Error('Non-numeric input for ID-only field');
      }
    }
    const cache = addfeedCache.get(cacheKey) || {};
    cache[fieldKey] = value;
    addfeedCache.set(cacheKey, cache);
    return value;
  } catch {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Timed out waiting for input. Please run /addfeed again.', ephemeral: true });
    } else {
      await interaction.followUp({ content: 'Timed out waiting for input. Please run /addfeed again.', ephemeral: true });
    }
    addfeedCache.delete(cacheKey);
    throw new Error('Input timed out');
  }
}

function parseIdArray(str) {
  if (!str || typeof str !== 'string') return [];
  return str
    .split(',')
    .map(s => s.trim())
    .filter(s => /^\d+$/.test(s))
    .map(Number);
}

function buildFilterObject(
  step1, step2, step3, logicModes, activeLogicFields, securityClass, distanceFromSystemId, maxDistanceLy
) {
  const filters = {};
  filters.corporationIds = parseIdArray(step1.corporations);
  filters.corporationIdsMode = logicModes?.corporationIds || 'OR';
  filters.characterIds = parseIdArray(step1.characters);
  filters.characterIdsMode = logicModes?.characterIds || 'OR';
  filters.allianceIds = parseIdArray(step1.alliances);
  filters.allianceIdsMode = logicModes?.allianceIds || 'OR';
  filters.regionIds = parseIdArray(step1.regions);
  filters.regionIdsMode = logicModes?.regionIds || 'OR';
  filters.attackerCorporationIds = parseIdArray(step2.attacker_corporations);
  filters.attackerCorporationIdsMode = logicModes?.attackerCorporationIds || 'OR';
  filters.attackerCharacterIds = parseIdArray(step2.attacker_characters);
  filters.attackerCharacterIdsMode = logicModes?.attackerCharacterIds || 'OR';
  filters.attackerAllianceIds = parseIdArray(step2.attacker_alliances);
  filters.attackerAllianceIdsMode = logicModes?.attackerAllianceIds || 'OR';
  filters.systemIds = parseIdArray(step2.systems);
  filters.systemIdsMode = logicModes?.systemIds || 'OR';
  filters.shipTypeIds = parseIdArray(step2.shiptypes);
  filters.shipTypeIdsMode = logicModes?.shipTypeIds || 'OR';
  if (Array.isArray(activeLogicFields)) {
    for (const f of activeLogicFields) {
      if (logicModes && logicModes[f.key] !== undefined) {
        filters[`${f.key}Mode`] = logicModes[f.key];
      }
    }
  }
  filters.minValue =
    step3.min_isk && !isNaN(parseFloat(step3.min_isk.replace(/,/g, '')))
      ? parseFloat(step3.min_isk.replace(/,/g, ''))
      : undefined;
  filters.maxValue =
    step3.max_isk && !isNaN(parseFloat(step3.max_isk.replace(/,/g, '')))
      ? parseFloat(step3.max_isk.replace(/,/g, ''))
      : undefined;
  filters.minAttackers =
    step3.min_attackers && !isNaN(parseInt(step3.min_attackers))
      ? parseInt(step3.min_attackers)
      : undefined;
  filters.maxAttackers =
    step3.max_attackers && !isNaN(parseInt(step3.max_attackers))
      ? parseInt(step3.max_attackers)
      : undefined;
  if (securityClass) {
    filters.securityClass = securityClass.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }
  if (distanceFromSystemId && /^\d+$/.test(distanceFromSystemId)) {
    filters.distanceFromSystemId = Number(distanceFromSystemId);
  }
  if (maxDistanceLy && !isNaN(Number(maxDistanceLy))) {
    filters.maxDistanceLy = Number(maxDistanceLy);
  }
  // Remove empty array fields so blank fields are ignored during filter matching
  Object.keys(filters).forEach(key => {
    if (Array.isArray(filters[key]) && filters[key].length === 0) delete filters[key];
  });
  return filters;
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

      const allFilterChoices = [
        { label: 'Victim Corp(s)', value: 'corporations' },
        { label: 'Victim Character(s)', value: 'characters' },
        { label: 'Victim Alliance(s)', value: 'alliances' },
        { label: 'Region(s)', value: 'regions' },
        { label: 'Attacker Corp(s)', value: 'attacker_corporations' },
        { label: 'Attacker Character(s)', value: 'attacker_characters' },
        { label: 'Attacker Alliance(s)', value: 'attacker_alliances' },
        { label: 'System(s)', value: 'systems' },
        { label: 'Ship Type(s)', value: 'shiptypes' },
        { label: 'System Security Class', value: 'security_class' },
        { label: 'Max Lightyears from System', value: 'distance_from_system' },
        { label: 'Done - no more filters', value: 'done' }
      ];

      const cacheKey = `${interaction.user.id}-${Date.now()}`;
      let selectedFilters = [];
      let cache = { feedName, selectedFilters: [], createdAt: Date.now() };
      addfeedCache.set(cacheKey, cache);

      await interaction.reply({
        content: 'Select a filter to add (or select "Done - no more filters" to finish):',
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('addfeed-selectfilters')
              .setPlaceholder('Select a filter')
              .addOptions(allFilterChoices)
              .setMinValues(1)
              .setMaxValues(1)
          )
        ],
        ephemeral: true,
      });

      let doneSelectingFilters = false;
      while (!doneSelectingFilters) {
        const selectInt = await interaction.channel.awaitMessageComponent({
          filter: i => i.user.id === interaction.user.id && i.customId === 'addfeed-selectfilters',
          time: 60000
        });

        if (!selectInt.replied && !selectInt.deferred) {
          await selectInt.deferReply({ ephemeral: true });
        }

        const selected = selectInt.values[0];
        if (selected === 'done') {
          await selectInt.followUp({ content: 'No more filters selected.', ephemeral: true });
          doneSelectingFilters = true;
          break;
        } else {
          if (!selectedFilters.includes(selected)) {
            selectedFilters.push(selected);
            cache = addfeedCache.get(cacheKey) || {};
            cache.selectedFilters = selectedFilters;
            addfeedCache.set(cacheKey, cache);

            const fieldDef = filterLogicFieldsMaster.find(o => o.inputKey === selected);
            let prompt;
            let idOnly = false;
            if (
              [
                'corporations',
                'characters',
                'alliances',
                'regions',
                'attacker_corporations',
                'attacker_characters',
                'attacker_alliances',
                'systems',
                'shiptypes'
              ].includes(selected)
            ) {
              prompt = `Enter numeric ID(s) for **${fieldDef.label}** (comma-separated, no names allowed, leave blank for none):`;
              idOnly = true;
              await promptForText(selectInt, prompt, cacheKey, selected, true, idOnly);
            } else if (selected === 'security_class') {
              const securityRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('addfeed-securityclass')
                  .setPlaceholder('Select system security class')
                  .addOptions([
                    { label: 'High Sec', value: 'highsec' },
                    { label: 'Low Sec', value: 'lowsec' },
                    { label: 'Null Sec', value: 'nullsec' },
                    { label: 'Wormhole', value: 'wh' }
                  ])
                  .setMinValues(1).setMaxValues(4)
              );
              await selectInt.followUp({
                content: 'Select one or more system security classes:',
                components: [securityRow],
                ephemeral: true
              });
              const secInt = await interaction.channel.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id && i.customId === 'addfeed-securityclass',
                time: 60000
              });
              if (!secInt.replied && !secInt.deferred) {
                await secInt.deferReply({ ephemeral: true });
              }
              cache = addfeedCache.get(cacheKey) || {};
              cache['security_class'] = secInt.values.join(',');
              addfeedCache.set(cacheKey, cache);
              await secInt.followUp({ content: `Selected security classes: ${secInt.values.join(', ')}`, ephemeral: true });
            } else if (selected === 'distance_from_system') {
              await promptForText(selectInt, 'Enter the numeric system ID to measure from:', cacheKey, 'distance_from_system_id', false, true);
              await promptForText(selectInt, 'Enter the maximum distance in lightyears (e.g. 10):', cacheKey, 'max_distance_ly', false);
            } else {
              prompt = `Enter value(s) for **${fieldDef ? fieldDef.label : selected}** (comma-separated, or leave blank for none):`;
              await promptForText(selectInt, prompt, cacheKey, selected, true);
            }
          } else {
            await selectInt.followUp({ content: `You already selected this filter. Please choose a different one.`, ephemeral: true });
          }
        }
        const remainingOptions = allFilterChoices.filter(opt => !selectedFilters.includes(opt.value) || opt.value === 'done');
        if (!doneSelectingFilters) {
          await interaction.followUp({
            content: 'Select another filter to add, or "Done - no more filters":',
            components: [
              new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('addfeed-selectfilters')
                  .setPlaceholder('Select a filter')
                  .addOptions(remainingOptions)
                  .setMinValues(1)
                  .setMaxValues(1)
              )
            ],
            ephemeral: true,
          });
        }
      }

      // Get final cache for user after all prompts
      const cacheFinal = addfeedCache.get(cacheKey) || {};

      await promptForText(interaction, 'Enter minimum ISK value (or leave blank):', cacheKey, 'min_isk', true);
      await promptForText(interaction, 'Enter maximum ISK value (or leave blank):', cacheKey, 'max_isk', true);
      await promptForText(interaction, 'Enter minimum attackers (or leave blank):', cacheKey, 'min_attackers', true);
      await promptForText(interaction, 'Enter maximum attackers (or leave blank):', cacheKey, 'max_attackers', true);

      // Re-fetch cache after last prompts
      const cacheFinal2 = addfeedCache.get(cacheKey) || {};

      const step1 = {
        feedName: cacheFinal2.feedName,
        corporations: cacheFinal2.corporations || '',
        characters: cacheFinal2.characters || '',
        alliances: cacheFinal2.alliances || '',
        regions: cacheFinal2.regions || ''
      };
      const step2 = {
        attacker_corporations: cacheFinal2.attacker_corporations || '',
        attacker_characters: cacheFinal2.attacker_characters || '',
        attacker_alliances: cacheFinal2.attacker_alliances || '',
        systems: cacheFinal2.systems || '',
        shiptypes: cacheFinal2.shiptypes || ''
      };
      const step3 = {
        min_isk: cacheFinal2.min_isk || '',
        max_isk: cacheFinal2.max_isk || '',
        min_attackers: cacheFinal2.min_attackers || '',
        max_attackers: cacheFinal2.max_attackers || ''
      };
      const securityClass = cacheFinal2.security_class || '';
      const distanceFromSystemId = cacheFinal2.distance_from_system_id || '';
      const maxDistanceLy = cacheFinal2.max_distance_ly || '';

      // Gather logic modes
      const logicModes = {};
      for (const filterField of selectedFilters) {
        const logicField = filterLogicFieldsMaster.find(f => f.inputKey === filterField);
        if (!logicField || ['securityClass', 'distanceFromSystem'].includes(logicField.key)) continue;
        const logicSelectRow = makeLogicSelect(`logicmode-${logicField.key}|${cacheKey}`, logicField.label);
        await interaction.followUp({
          content: `Select logic for **${logicField.label}**:`,
          components: [logicSelectRow],
          ephemeral: true
        });
        const logicInt = await interaction.channel.awaitMessageComponent({
          filter: i => i.user.id === interaction.user.id && i.customId.startsWith(`logicmode-${logicField.key}|`),
          time: 60000
        });
        if (!logicInt.replied && !logicInt.deferred) {
          await logicInt.deferReply({ ephemeral: true });
        }
        await logicInt.followUp({ content: `Set logic for ${logicField.label}: ${logicInt.values[0]}`, ephemeral: true });
        logicModes[logicField.key] = logicInt.values[0];
      }

      const filters = buildFilterObject(
        step1,
        step2,
        step3,
        logicModes,
        filterLogicFieldsMaster.filter(f => selectedFilters.includes(f.inputKey)),
        securityClass,
        distanceFromSystemId,
        maxDistanceLy
      );
      setFeed(interaction.channel.id, feedName, { filters });
      await interaction.followUp({ content: `Feed \`${feedName}\` created and saved!`, ephemeral: true });
      addfeedCache.delete(cacheKey);
    } catch (err) {
      console.error('Error in addfeed wizard:', err);
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'An error occurred. Please try again.', ephemeral: true });
        } else {
          await interaction.reply({ content: 'An error occurred. Please try again.', ephemeral: true });
        }
      } catch {}
    }
  }
};
