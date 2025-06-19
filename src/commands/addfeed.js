const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { setFeed, getFeeds } = require('../feeds');
const { startZKillWebSocket } = require('../zkill/websocket');
const eveu = require('../eveuniverse');

const liveWebsockets = new Map();

// In-memory session per-user for multi-step modal flow
const addfeedSessions = new Map();

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
    // Step 1: Show modal for first 5 fields
    const modal = new ModalBuilder()
      .setCustomId('addfeed-modal-step1')
      .setTitle('Add zKillboard Feed (1/3)');
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
    // Step 1: Collect first 5 fields, reply with "Continue" button
    if (interaction.customId === 'addfeed-modal-step1') {
      const session = {
        feedname: interaction.fields.getTextInputValue('feedname'),
        region: interaction.fields.getTextInputValue('region'),
        system: interaction.fields.getTextInputValue('system'),
        shiptype: interaction.fields.getTextInputValue('shiptype'),
        alliance: interaction.fields.getTextInputValue('alliance'),
      };
      addfeedSessions.set(interaction.user.id, session);

      await interaction.reply({
        content: "Continue to step 2 to add more feed filters.",
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('addfeed-step2')
              .setLabel('Continue to Step 2')
              .setStyle(ButtonStyle.Primary)
          )
        ],
        ephemeral: true
      });
      return;
    }
    // Step 2: Collect next 5 fields, reply with "Continue" button
    if (interaction.customId === 'addfeed-modal-step2') {
      const prev = addfeedSessions.get(interaction.user.id) || {};
      prev.corp = interaction.fields.getTextInputValue('corp');
      prev.character = interaction.fields.getTextInputValue('character');
      prev.attacker_alliance = interaction.fields.getTextInputValue('attacker_alliance');
      prev.attacker_corp = interaction.fields.getTextInputValue('attacker_corp');
      prev.attacker_character = interaction.fields.getTextInputValue('attacker_character');
      addfeedSessions.set(interaction.user.id, prev);

      await interaction.reply({
        content: "Continue to step 3 for final filters.",
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('addfeed-step3')
              .setLabel('Continue to Step 3')
              .setStyle(ButtonStyle.Primary)
          )
        ],
        ephemeral: true
      });
      return;
    }
    // Step 3: Final modal, process and create the feed
    if (interaction.customId === 'addfeed-modal-step3') {
      const input = addfeedSessions.get(interaction.user.id) || {};
      input.attacker_shiptype = interaction.fields.getTextInputValue('attacker_shiptype');
      input.minisk = interaction.fields.getTextInputValue('minisk');
      input.minattackers = interaction.fields.getTextInputValue('minattackers');
      input.maxattackers = interaction.fields.getTextInputValue('maxattackers');
      addfeedSessions.delete(interaction.user.id);

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
      return;
    }
  },

  async handleButton(interaction) {
    // Step 2 button pressed
    if (interaction.customId === 'addfeed-step2') {
      const modal = new ModalBuilder()
        .setCustomId('addfeed-modal-step2')
        .setTitle('Add zKillboard Feed (2/3)')
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
      await interaction.showModal(modal);
    }
    // Step 3 button pressed
    if (interaction.customId === 'addfeed-step3') {
      const modal = new ModalBuilder()
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
      await interaction.showModal(modal);
    }
  },

  liveWebsockets
};
