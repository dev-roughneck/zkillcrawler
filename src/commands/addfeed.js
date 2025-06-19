const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { setFeed, getFeeds } = require('../feeds');
const { startZKillWebSocket } = require('../zkill/websocket');
const eveu = require('../eveuniverse');

const liveWebsockets = new Map();

function isAdmin(member) {
  return member && member.permissions && (member.permissions.has('Administrator') || member.permissions.has('ManageGuild'));
}

async function normalizeFilters(input) {
  const filters = {};

  function parseField(val) {
    if (!val) return [];
    return val.split(',').map(x => x.trim()).filter(Boolean);
  }

  async function resolveField(val, resolver) {
    const arr = parseField(val);
    const out = [];
    for (const v of arr) {
      if (v.startsWith('!')) {
        const resolved = await resolver(v.slice(1));
        if (resolved) out.push('!' + resolved.id);
      } else {
        const resolved = await resolver(v);
        if (resolved) out.push('' + resolved.id);
      }
    }
    return out;
  }

  filters.region_id = await resolveField(input.region, eveu.resolveRegion);
  filters.system_id = await resolveField(input.system, eveu.resolveSystem);
  filters.shiptype_id = await resolveField(input.shiptype, eveu.resolveShipType);
  filters.alliance_id = await resolveField(input.alliance, eveu.resolveAlliance);
  filters.corp_id = await resolveField(input.corp, eveu.resolveCorporation);
  filters.character_id = await resolveField(input.character, eveu.resolveCharacter);

  filters.attacker_alliance_id = await resolveField(input.attacker_alliance, eveu.resolveAlliance);
  filters.attacker_corp_id = await resolveField(input.attacker_corp, eveu.resolveCorporation);
  filters.attacker_character_id = await resolveField(input.attacker_character, eveu.resolveCharacter);
  filters.attacker_shiptype_id = await resolveField(input.attacker_shiptype, eveu.resolveShipType);

  filters.minisk = input.minisk ? Number(input.minisk) : undefined;
  filters.minattackers = input.minattackers ? Number(input.minattackers) : undefined;
  filters.maxattackers = input.maxattackers ? Number(input.maxattackers) : undefined;

  return filters;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addfeed')
    .setDescription('Add a new zKillboard feed to this channel (Admins only)'),
  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: 'Only server admins may use this command.', ephemeral: true });
    }
    // Step 1 Modal
    const modal = new ModalBuilder()
      .setCustomId('addfeed-modal-step1')
      .setTitle('Add zKillboard Feed (1/2)');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('feedname').setLabel('Feed Name').setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('region').setLabel('Region(s)').setPlaceholder('name/ID, comma, ! for NOT').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('system').setLabel('System(s)').setPlaceholder('name/ID, comma, ! for NOT').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('shiptype').setLabel('Shiptype(s)').setPlaceholder('name/ID, comma, ! for NOT').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('alliance').setLabel('Alliance(s)').setPlaceholder('name/ID, comma, ! for NOT').setStyle(TextInputStyle.Short).setRequired(false)
      )
    );
    await interaction.showModal(modal);
  },

  async handleModal(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: 'Only server admins may use this command.', ephemeral: true });
    }

    // Determine which step we are in
    if (interaction.customId === 'addfeed-modal-step1') {
      // Collect step 1 values
      const step1Data = {
        feedname: interaction.fields.getTextInputValue('feedname'),
        region: interaction.fields.getTextInputValue('region'),
        system: interaction.fields.getTextInputValue('system'),
        shiptype: interaction.fields.getTextInputValue('shiptype'),
        alliance: interaction.fields.getTextInputValue('alliance'),
      };

      // Store step1Data in the user's session (in-memory map or Redis, here we'll use a static Map for demo)
      // In a real bot, use a more persistent store if you need to support restarts
      if (!global.addfeedSessions) global.addfeedSessions = new Map();
      global.addfeedSessions.set(interaction.user.id, step1Data);

      // Step 2 Modal
      const modal2 = new ModalBuilder()
        .setCustomId('addfeed-modal-step2')
        .setTitle('Add zKillboard Feed (2/2)')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('corp').setLabel('Corporation(s)').setPlaceholder('name/ID, comma, ! for NOT').setStyle(TextInputStyle.Short).setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('character').setLabel('Character(s)').setPlaceholder('name/ID, comma, ! for NOT').setStyle(TextInputStyle.Short).setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('attacker_alliance').setLabel('Attacker Alliance(s)').setPlaceholder('name/ID, comma, ! for NOT').setStyle(TextInputStyle.Short).setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('attacker_corp').setLabel('Attacker Corporation(s)').setPlaceholder('name/ID, comma, ! for NOT').setStyle(TextInputStyle.Short).setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('attacker_character').setLabel('Attacker Character(s)').setPlaceholder('name/ID, comma, ! for NOT').setStyle(TextInputStyle.Short).setRequired(false)
          )
        );
      await interaction.showModal(modal2);
      return;
    }

    if (interaction.customId === 'addfeed-modal-step2') {
      // Get step1Data from session
      const step1Data = global.addfeedSessions?.get(interaction.user.id) || {};

      // Collect step 2 values
      const input = {
        ...step1Data,
        corp: interaction.fields.getTextInputValue('corp'),
        character: interaction.fields.getTextInputValue('character'),
        attacker_alliance: interaction.fields.getTextInputValue('attacker_alliance'),
        attacker_corp: interaction.fields.getTextInputValue('attacker_corp'),
        attacker_character: interaction.fields.getTextInputValue('attacker_character'),
        // Additional fields to be added in step 3 if needed
      };

      // Optionally, for a 3rd modal for even more fields (e.g., attacker_shiptype, minisk, minattackers, maxattackers)
      // For brevity, let's just add them in this step if not needed, or you can extend the process.

      // For a 3rd step, you would:
      // - Save input into session
      // - Show a 3rd modal with remaining fields
      // - On 3rd modal submit, pull all data from session and process

      // For now, let's ask for the final criteria in this step if you want to keep it to 2 steps
      // If you want 3 steps, let me know!

      // 3rd and final modal for remaining fields
      const modal3 = new ModalBuilder()
        .setCustomId('addfeed-modal-step3')
        .setTitle('Add zKillboard Feed (3/3)')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('attacker_shiptype').setLabel('Attacker Shiptype(s)').setPlaceholder('name/ID, comma, ! for NOT').setStyle(TextInputStyle.Short).setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('minisk').setLabel('Minimum ISK Value').setStyle(TextInputStyle.Short).setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('minattackers').setLabel('Min # of Attackers').setStyle(TextInputStyle.Short).setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('maxattackers').setLabel('Max # of Attackers').setStyle(TextInputStyle.Short).setRequired(false)
          )
        );
      // Save input so far
      global.addfeedSessions.set(interaction.user.id, input);
      await interaction.showModal(modal3);
      return;
    }

    if (interaction.customId === 'addfeed-modal-step3') {
      // Get all previous steps data from session
      const step1And2 = global.addfeedSessions?.get(interaction.user.id) || {};
      const input = {
        ...step1And2,
        attacker_shiptype: interaction.fields.getTextInputValue('attacker_shiptype'),
        minisk: interaction.fields.getTextInputValue('minisk'),
        minattackers: interaction.fields.getTextInputValue('minattackers'),
        maxattackers: interaction.fields.getTextInputValue('maxattackers'),
      };

      // Clean up session
      global.addfeedSessions?.delete(interaction.user.id);

      // Process feed creation as before
      const feedName = input.feedname.trim();
      const channelId = interaction.channel.id;

      const feeds = getFeeds(channelId);
      if (feeds[feedName]) {
        return interaction.reply({ content: `A feed with the name "${feedName}" already exists in this channel.`, ephemeral: true });
      }

      const normalizedFilters = await normalizeFilters(input);

      setFeed(channelId, feedName, { filters: normalizedFilters });
      startZKillWebSocket(feedName, channelId, normalizedFilters, interaction.channel, liveWebsockets);

      await interaction.reply({
        content: `Feed \`${feedName}\` added and live!\n\nCriteria:\n\`\`\`json\n${JSON.stringify(normalizedFilters, null, 2)}\n\`\`\``,
        ephemeral: true
      });
    }
  },

  liveWebsockets
};
