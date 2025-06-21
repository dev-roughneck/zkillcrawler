const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
} = require('discord.js');
const { setFeed, feedExists } = require('../feeds');

const filterLogicFieldsMaster = [
  { key: 'corporationIds', label: 'Victim Corp(s)', inputKey: 'corporations', idOnly: true },
  { key: 'characterIds', label: 'Victim Character(s)', inputKey: 'characters', idOnly: true },
  { key: 'allianceIds', label: 'Victim Alliance(s)', inputKey: 'alliances', idOnly: true },
  { key: 'regionIds', label: 'Region(s)', inputKey: 'regions', idOnly: true },
  { key: 'attackerCorporationIds', label: 'Attacker Corp(s)', inputKey: 'attacker_corporations', idOnly: true },
  { key: 'attackerCharacterIds', label: 'Attacker Character(s)', inputKey: 'attacker_characters', idOnly: true },
  { key: 'attackerAllianceIds', label: 'Attacker Alliance(s)', inputKey: 'attacker_alliances', idOnly: true },
  { key: 'systemIds', label: 'System(s)', inputKey: 'systems', idOnly: true },
  { key: 'shipTypeIds', label: 'Ship Type(s)', inputKey: 'shiptypes', idOnly: true },
  { key: 'securityClass', label: 'System Security Class', inputKey: 'security_class', idOnly: false },
  { key: 'distanceFromSystemId', label: 'System ID for distance', inputKey: 'distance_from_system_id', idOnly: true },
  { key: 'maxDistanceLy', label: 'Max Lightyears', inputKey: 'max_distance_ly', idOnly: false },
  { key: 'minValue', label: 'Minimum ISK', inputKey: 'min_isk', idOnly: false },
  { key: 'maxValue', label: 'Maximum ISK', inputKey: 'max_isk', idOnly: false },
  { key: 'minAttackers', label: 'Minimum Attackers', inputKey: 'min_attackers', idOnly: false },
  { key: 'maxAttackers', label: 'Maximum Attackers', inputKey: 'max_attackers', idOnly: false },
];

const addfeedCache = new Map();

async function promptForText(interaction, question, cacheKey, fieldKey, allowBlank = false, idOnly = false) {
  let msg = question;
  if (idOnly) msg += '\n**Enter numeric ID(s) only, comma-separated. Names are not accepted.**';
  if (typeof msg === 'string' && msg.trim().length > 0) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: msg, flags: 1 << 6 }); // ephemeral via flags
    } else {
      await interaction.followUp({ content: msg, flags: 1 << 6 });
    }
  }
  const filter = msg => msg.author.id === interaction.user.id && msg.channel.id === interaction.channel.id;
  try {
    const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
    const value = collected.first().content.trim();
    if (!allowBlank && !value) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `${fieldKey.replace(/_/g, ' ')} is required. Please run /addfeed again.`, flags: 1 << 6 });
      } else {
        await interaction.followUp({ content: `${fieldKey.replace(/_/g, ' ')} is required. Please run /addfeed again.`, flags: 1 << 6 });
      }
      addfeedCache.delete(cacheKey);
      throw new Error('Input is empty');
    }
    if (idOnly && value) {
      const parts = value.split(',').map(v => v.trim());
      if (!parts.every(v => /^\d+$/.test(v))) {
        await interaction.followUp({
          content: '❌ Only numeric ID(s) are allowed. Names are not accepted. Please look up the correct ID and try again.',
          flags: 1 << 6
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
      await interaction.reply({ content: 'Timed out waiting for input. Please run /addfeed again.', flags: 1 << 6 });
    } else {
      await interaction.followUp({ content: 'Timed out waiting for input. Please run /addfeed again.', flags: 1 << 6 });
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

function buildFilterObject(cache) {
  const filters = {};
  for (const field of filterLogicFieldsMaster) {
    let val = cache[field.inputKey];
    if (field.idOnly) {
      if (val) {
        if (field.key === 'distanceFromSystemId') {
          filters[field.key] = /^\d+$/.test(val) ? Number(val) : undefined;
        } else {
          const arr = parseIdArray(val);
          if (arr.length) filters[field.key] = arr;
        }
      }
    } else if (field.key === 'securityClass') {
      if (val) filters.securityClass = val.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    } else if (field.key === 'maxDistanceLy') {
      if (val && !isNaN(Number(val))) filters.maxDistanceLy = Number(val);
    } else if (field.key === 'minValue' || field.key === 'maxValue') {
      if (val && !isNaN(parseFloat(val.replace(/,/g, '')))) filters[field.key] = parseFloat(val.replace(/,/g, ''));
    } else if (field.key === 'minAttackers' || field.key === 'maxAttackers') {
      if (val && !isNaN(parseInt(val))) filters[field.key] = parseInt(val);
    }
  }
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
        await interaction.reply({ content: 'Feed name is required. Please run /addfeed again.', flags: 1 << 6 });
        return;
      }
      if (feedExists(interaction.channel.id, feedName)) {
        await interaction.reply({ content: `Feed \`${feedName}\` already exists in this channel.`, flags: 1 << 6 });
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
        { label: 'Minimum ISK', value: 'min_isk' },
        { label: 'Maximum ISK', value: 'max_isk' },
        { label: 'Minimum Attackers', value: 'min_attackers' },
        { label: 'Maximum Attackers', value: 'max_attackers' },
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
        flags: 1 << 6,
      });

      let doneSelectingFilters = false;
      while (!doneSelectingFilters) {
        const selectInt = await interaction.channel.awaitMessageComponent({
          filter: i => i.user.id === interaction.user.id && i.customId === 'addfeed-selectfilters',
          time: 60000
        });

        if (!selectInt.replied && !selectInt.deferred) {
          await selectInt.deferReply({ flags: 1 << 6 });
        }

        const selected = selectInt.values[0];
        if (selected === 'done') {
          await selectInt.followUp({ content: 'No more filters selected.', flags: 1 << 6 });
          doneSelectingFilters = true;
          break;
        } else if (!selectedFilters.includes(selected)) {
          selectedFilters.push(selected);
          cache = addfeedCache.get(cacheKey) || {};
          cache.selectedFilters = selectedFilters;
          addfeedCache.set(cacheKey, cache);

          const fieldDef = filterLogicFieldsMaster.find(o => o.inputKey === selected || o.inputKey === selected.replace(/^min_|^max_/, ''));
          let prompt;
          let idOnly = fieldDef ? fieldDef.idOnly : false;

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
            await promptForText(selectInt, prompt, cacheKey, selected, true, true);
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
              flags: 1 << 6
            });
            const secInt = await interaction.channel.awaitMessageComponent({
              filter: i => i.user.id === interaction.user.id && i.customId === 'addfeed-securityclass',
              time: 60000
            });
            if (!secInt.replied && !secInt.deferred) {
              await secInt.deferReply({ flags: 1 << 6 });
            }
            cache = addfeedCache.get(cacheKey) || {};
            cache['security_class'] = secInt.values.join(',');
            addfeedCache.set(cacheKey, cache);
            await secInt.followUp({ content: `Selected security classes: ${secInt.values.join(', ')}`, flags: 1 << 6 });
          } else if (selected === 'distance_from_system') {
            await promptForText(selectInt, 'Enter the numeric system ID to measure from:', cacheKey, 'distance_from_system_id', false, true);
            await promptForText(selectInt, 'Enter the maximum distance in lightyears (e.g. 10):', cacheKey, 'max_distance_ly', false);
          } else if (
            ['min_isk', 'max_isk', 'min_attackers', 'max_attackers'].includes(selected)
          ) {
            prompt = `Enter value for **${fieldDef.label}** (leave blank for none):`;
            await promptForText(selectInt, prompt, cacheKey, selected, true, false);
          } else {
            prompt = `Enter value(s) for **${fieldDef ? fieldDef.label : selected}** (comma-separated, or leave blank for none):`;
            await promptForText(selectInt, prompt, cacheKey, selected, true);
          }
        } else {
          await selectInt.followUp({ content: `You already selected this filter. Please choose a different one.`, flags: 1 << 6 });
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
            flags: 1 << 6,
          });
        }
      }

      // Get final cache for user after all prompts
      const cacheFinal = addfeedCache.get(cacheKey) || {};

      // Build the filter object from ALL cache entries
      const filters = buildFilterObject(cacheFinal);
      console.log("Saving feed:", interaction.channel.id, feedName, filters);
      setFeed(interaction.channel.id, feedName, { filters });
      await interaction.followUp({ content: `Feed \`${feedName}\` created and saved!`, flags: 1 << 6 });
      addfeedCache.delete(cacheKey);
    } catch (err) {
      console.error('Error in addfeed wizard:', err);
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'An error occurred. Please try again.', flags: 1 << 6 });
        } else {
          await interaction.reply({ content: 'An error occurred. Please try again.', flags: 1 << 6 });
        }
      } catch {}
    }
  }
};
