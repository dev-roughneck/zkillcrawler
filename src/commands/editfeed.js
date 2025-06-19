const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { getFeeds, setFeed, deleteFeed } = require('../feeds');
const { stopZKillWebSocket, startZKillWebSocket } = require('../zkill/websocket');
const { liveWebsockets } = require('./addfeed');
const eveu = require('../eveuniverse');

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
    .setName('editfeed')
    .setDescription('Edit a zKillboard feed in this channel (Admins only)'),
  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: 'Only server admins may use this command.', ephemeral: true });
    }
    const feeds = getFeeds(interaction.channel.id);
    const feedNames = Object.keys(feeds);
    if (!feedNames.length) {
      return interaction.reply({ content: 'No feeds in this channel.', ephemeral: true });
    }
    const modal = new ModalBuilder()
      .setCustomId('editfeed-modal')
      .setTitle('Edit zKillboard Feed');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('feedname').setLabel('Feed Name to Edit').setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('newfeedname').setLabel('New Feed Name').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('region').setLabel('Region(s) (name/ID, comma, ! for NOT)').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('system').setLabel('System(s) (name/ID, comma, ! for NOT)').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('shiptype').setLabel('Shiptype(s) (name/ID, comma, ! for NOT)').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('alliance').setLabel('Alliance(s) (name/ID, comma, ! for NOT)').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('corp').setLabel('Corporation(s) (name/ID, comma, ! for NOT)').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('character').setLabel('Character(s) (name/ID, comma, ! for NOT)').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('attacker_alliance').setLabel('Attacker Alliance(s) (name/ID, comma, ! for NOT)').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('attacker_corp').setLabel('Attacker Corporation(s) (name/ID, comma, ! for NOT)').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('attacker_character').setLabel('Attacker Character(s) (name/ID, comma, ! for NOT)').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('attacker_shiptype').setLabel('Attacker Shiptype(s) (name/ID, comma, ! for NOT)').setStyle(TextInputStyle.Short).setRequired(false)
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
  },

  async handleModal(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: 'Only server admins may use this command.', ephemeral: true });
    }
    const input = {};
    [
      'feedname', 'newfeedname', 'region', 'system', 'shiptype', 'alliance', 'corp', 'character',
      'attacker_alliance', 'attacker_corp', 'attacker_character', 'attacker_shiptype',
      'minisk', 'minattackers', 'maxattackers'
    ].forEach(f => {
      input[f] = interaction.fields.getTextInputValue(f) || undefined;
    });
    const feedName = input.feedname.trim();
    const newFeedName = (input.newfeedname || '').trim() || feedName;
    const channelId = interaction.channel.id;

    const feeds = getFeeds(channelId);
    if (!feeds[feedName]) {
      return interaction.reply({ content: `No feed named "${feedName}" in this channel.`, ephemeral: true });
    }
    stopZKillWebSocket(feedName, channelId, liveWebsockets);

    let normalizedFilters = feeds[feedName].filters;
    const anyFieldUpdated = [
      'region', 'system', 'shiptype', 'alliance', 'corp', 'character',
      'attacker_alliance', 'attacker_corp', 'attacker_character', 'attacker_shiptype',
      'minisk', 'minattackers', 'maxattackers'
    ]
      .some(f => input[f]);
    if (anyFieldUpdated) {
      normalizedFilters = await normalizeFilters(input);
    }

    const data = { ...feeds[feedName], filters: normalizedFilters };
    setFeed(channelId, newFeedName, data);
    if (newFeedName !== feedName) {
      deleteFeed(channelId, feedName);
    }
    startZKillWebSocket(newFeedName, channelId, data.filters, interaction.channel, liveWebsockets);

    await interaction.reply({
      content: `Feed \`${feedName}\` updated${newFeedName !== feedName ? ` to \`${newFeedName}\`` : ''}.\n\nCriteria:\n\`\`\`json\n${JSON.stringify(normalizedFilters, null, 2)}\n\`\`\``,
      ephemeral: true
    });
  }
};