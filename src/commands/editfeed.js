const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getFeeds, setFeed, feedExists } = require('../feeds');
const { startRedisQPolling, stopRedisQPolling } = require('../zkill/redisq');
const { resolveIds } = require('../eveuniverse');
const { livePolls } = require('./addfeed');

// Helper: reconstruct the full modal steps for editing
function buildEditModals(feedName, originalFilters) {
  // Step 1: victim filters
  const modal1 = new ModalBuilder()
    .setCustomId(`editfeed-modal-step1|${feedName}`)
    .setTitle(`Edit Feed "${feedName}" - Victim Filters`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('region')
          .setLabel('Region Name(s), comma separated')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(originalFilters.region || '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('system')
          .setLabel('System Name(s), comma separated')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(originalFilters.system || '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('shiptype')
          .setLabel('Victim Ship Type(s), comma separated')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(originalFilters.shiptype || '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('alliance')
          .setLabel('Victim Alliance Name(s), comma separated')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(originalFilters.alliance || '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('corp')
          .setLabel('Victim Corp Name(s), comma separated')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(originalFilters.corp || '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('character')
          .setLabel('Victim Character Name(s), comma separated')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(originalFilters.character || '')
      )
    );

  // Step 2: attacker filters + ISK/attacker counts
  const modal2 = new ModalBuilder()
    .setCustomId(`editfeed-modal-step2|${feedName}`)
    .setTitle(`Edit Feed "${feedName}" - Attacker Filters & Limits`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('attacker_alliance')
          .setLabel('Attacker Alliance Name(s), comma separated')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(originalFilters.attacker_alliance || '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('attacker_corp')
          .setLabel('Attacker Corp Name(s), comma separated')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(originalFilters.attacker_corp || '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('attacker_character')
          .setLabel('Attacker Character Name(s), comma separated')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(originalFilters.attacker_character || '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('attacker_shiptype')
          .setLabel('Attacker Ship Type(s), comma separated')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(originalFilters.attacker_shiptype || '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('minisk')
          .setLabel('Minimum ISK Value')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(originalFilters.minisk || '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('maxisk')
          .setLabel('Maximum ISK Value')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(originalFilters.maxisk || '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('minattackers')
          .setLabel('Minimum Attackers')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(originalFilters.minattackers || '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('maxattackers')
          .setLabel('Maximum Attackers')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(originalFilters.maxattackers || '')
      )
    );

  return [modal1, modal2];
}

// Helper to parse modal fields and resolve names to IDs
async function buildFilterObjectFromModal(fields) {
  // Victim
  const regionIds = await resolveIds(fields.region, 'region');
  const systemIds = await resolveIds(fields.system, 'system');
  const shipTypeIds = await resolveIds(fields.shiptype, 'shiptype');
  const allianceIds = await resolveIds(fields.alliance, 'alliance');
  const corporationIds = await resolveIds(fields.corp, 'corporation');
  const characterIds = await resolveIds(fields.character, 'character');

  // Attacker
  const attackerAllianceIds = await resolveIds(fields.attacker_alliance, 'alliance');
  const attackerCorporationIds = await resolveIds(fields.attacker_corp, 'corporation');
  const attackerCharacterIds = await resolveIds(fields.attacker_character, 'character');
  // Optionally, you can add attacker_shiptype if you want

  // ISK/attacker limits
  const minValue = parseFloat(fields.minisk.replace(/,/g, '')) || undefined;
  const maxValue = parseFloat(fields.maxisk?.replace(/,/g, '')) || undefined;
  const minAttackers = parseInt(fields.minattackers) || undefined;
  const maxAttackers = parseInt(fields.maxattackers) || undefined;

  return {
    regionIds,
    systemIds,
    shipTypeIds,
    allianceIds,
    corporationIds,
    characterIds,
    attackerAllianceIds,
    attackerCorporationIds,
    attackerCharacterIds,
    minValue,
    maxValue,
    minAttackers,
    maxAttackers,
    // You can add *_Mode fields here if you want to support AND/OR/IF UI for edit
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editfeed')
    .setDescription('Edit a zKillboard feed in this channel (multi-step, all filter options)'),

  async execute(interaction) {
    const feeds = getFeeds(interaction.channel.id);
    const feedNames = Object.keys(feeds);
    if (!feedNames.length) {
      return interaction.reply({ content: 'No feeds to edit in this channel.', ephemeral: true });
    }
    // If more than one feed, let user choose which to edit
    if (feedNames.length > 1) {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('editfeed-select')
        .setPlaceholder('Select a feed to edit')
        .addOptions(feedNames.map(name => ({
          label: name,
          value: name
        })));
      const row = new ActionRowBuilder().addComponents(selectMenu);
      return interaction.reply({
        content: 'Select the feed you want to edit:',
        components: [row],
        ephemeral: true
      });
    }
    // Only one feed, start modal immediately
    const feedName = feedNames[0];
    const [modal1, ] = buildEditModals(feedName, feeds[feedName]?.filters || {});
    await interaction.showModal(modal1);
  },

  // Handle select menu for feed editing
  async handleSelect(interaction) {
    if (interaction.customId !== 'editfeed-select') return;
    const feedName = interaction.values[0];
    const feeds = getFeeds(interaction.channel.id);
    if (!feeds[feedName]) {
      return interaction.update({ content: `Feed \`${feedName}\` not found.`, components: [] });
    }
    const [modal1, ] = buildEditModals(feedName, feeds[feedName]?.filters || {});
    await interaction.showModal(modal1);
  },

  // Modal steps
  async handleModal(interaction) {
    // Step 1: victim filters
    if (interaction.customId.startsWith('editfeed-modal-step1|')) {
      const feedName = interaction.customId.split('|')[1];
      const feeds = getFeeds(interaction.channel.id);
      const original = feeds[feedName]?.filters || {};

      const victimFilters = {
        region: interaction.fields.getTextInputValue('region').trim(),
        system: interaction.fields.getTextInputValue('system').trim(),
        shiptype: interaction.fields.getTextInputValue('shiptype').trim(),
        alliance: interaction.fields.getTextInputValue('alliance').trim(),
        corp: interaction.fields.getTextInputValue('corp').trim(),
        character: interaction.fields.getTextInputValue('character').trim()
      };

      // Save state in modal2 customId
      const [ , modal2 ] = buildEditModals(feedName, { ...original, ...victimFilters });
      await interaction.showModal(modal2);
      return;
    }

    // Step 2: attacker filters + ISK/attacker counts, finalize and save
    if (interaction.customId.startsWith('editfeed-modal-step2|')) {
      const feedName = interaction.customId.split('|')[1];
      const feeds = getFeeds(interaction.channel.id);
      const original = feeds[feedName]?.filters || {};

      const attackerFilters = {
        attacker_alliance: interaction.fields.getTextInputValue('attacker_alliance').trim(),
        attacker_corp: interaction.fields.getTextInputValue('attacker_corp').trim(),
        attacker_character: interaction.fields.getTextInputValue('attacker_character').trim(),
        attacker_shiptype: interaction.fields.getTextInputValue('attacker_shiptype').trim(),
        minisk: interaction.fields.getTextInputValue('minisk').trim(),
        maxisk: interaction.fields.getTextInputValue('maxisk').trim(),
        minattackers: interaction.fields.getTextInputValue('minattackers').trim(),
        maxattackers: interaction.fields.getTextInputValue('maxattackers').trim()
      };

      // Combine both steps into one object for filter building
      const allFields = { ...original, ...attackerFilters };
      // Modal step 1 fields should have been included in .filters already

      // Build new filter object (resolves names to IDs)
      const newFilters = await buildFilterObjectFromModal({
        // Victim
        region: allFields.region || '',
        system: allFields.system || '',
        shiptype: allFields.shiptype || '',
        alliance: allFields.alliance || '',
        corp: allFields.corp || '',
        character: allFields.character || '',
        // Attacker
        attacker_alliance: allFields.attacker_alliance || '',
        attacker_corp: allFields.attacker_corp || '',
        attacker_character: allFields.attacker_character || '',
        attacker_shiptype: allFields.attacker_shiptype || '',
        minisk: allFields.minisk || '',
        maxisk: allFields.maxisk || '',
        minattackers: allFields.minattackers || '',
        maxattackers: allFields.maxattackers || '',
      });

      setFeed(interaction.channel.id, feedName, { filters: newFilters });

      // Restart polling
      stopRedisQPolling(feedName, interaction.channel.id, livePolls);
      startRedisQPolling(feedName, interaction.channel.id, newFilters, interaction.channel, `${interaction.channel.id}-${feedName}`, livePolls);

      await interaction.reply({ content: `Feed \`${feedName}\` updated and polling restarted!`, ephemeral: true });
    }
  }
};
