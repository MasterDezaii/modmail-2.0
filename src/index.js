import { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionsBitField } from 'discord.js';
import { env, ensureEnv } from './config.js';
import db, {
  getGuildConfig,
  saveGuildConfig,
  addLog,
  getGuildCategories,
  addCategory,
  deleteCategory,
  getGuildRoles,
  upsertGuildRole,
  removeGuildRole,
  createTicket,
  getTicket,
  getTicketByUser,
  claimTicket,
  unclaimTicket,
  addTicketMessage,
  getTicketMessages,
  setTicketPriority,
  setTicketTags,
  setTicketNote,
  getUserCaseHistory,
  blockUser,
  unblockUser,
  getBlock,
  generateTranscript,
  addQuestion,
  getStatusCounts,
  getGuildStats,
  getOpenTicketsCount,
  getClaimedTicketsCount,
} from './db.js';

ensureEnv();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.User, Partials.Message],
});

const colorMap = {
  low: 0x2ecc71,
  normal: 0x3498db,
  high: 0xf39c12,
  urgent: 0xe74c3c,
};

function permissionBarrier(guild, member, required = 'ManageGuild') {
  if (!guild || !member) return false;
  if (member.roles.cache.some((role) => role.permissions.has(required) || role.permissions.has(PermissionsBitField.Flags.Administrator))) return true;
  return false;
}

function getTicketEmbed(ticket, guild) {
  const user = guild.members.cache.get(ticket.user_id) || null;
  return new EmbedBuilder()
    .setColor(colorMap[ticket.priority] || colorMap.normal)
    .setTitle(`Case #${ticket.case_number} · ${ticket.category}`)
    .setDescription(ticket.summary || 'No summary provided.')
    .addFields(
      { name: 'User', value: user ? `${user.user.tag}` : `<@${ticket.user_id}>`, inline: true },
      { name: 'Priority', value: String(ticket.priority || 'normal').toUpperCase(), inline: true },
      { name: 'Status', value: String(ticket.status || 'open').toUpperCase(), inline: true },
      { name: 'Claimed By', value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : 'Unclaimed', inline: true },
      { name: 'Category', value: String(ticket.category || 'General'), inline: true },
      { name: 'Opened', value: `<t:${Math.floor(new Date(ticket.opened_at).getTime() / 1000)}:F>`, inline: true }
    )
    .setTimestamp();
}

function buildDashboard(guildId) {
  const config = getGuildConfig(guildId);
  const counts = getStatusCounts(guildId);
  const stats = getGuildStats(guildId);

  const embed = new EmbedBuilder()
    .setTitle(`${config.panel_title || '📩 CONTACT STAFF'} Dashboard`)
    .setDescription(config.panel_description || 'Administrative overview of all ModMail activity.')
    .setColor(config.panel_color || 5793266)
    .addFields(
      { name: 'System Status', value: '✅ Online', inline: true },
      { name: 'Open Tickets', value: String(counts.open || 0), inline: true },
      { name: 'Claimed', value: String(counts.claimed || 0), inline: true },
      { name: 'Unclaimed', value: String(counts.unclaimed || 0), inline: true },
      { name: 'Configured Inbox', value: config.modmail_inbox_channel_id ? `<#${config.modmail_inbox_channel_id}>` : 'Not set', inline: true },
      { name: 'Transcript Channel', value: config.transcript_channel_id ? `<#${config.transcript_channel_id}>` : 'Not set', inline: true },
      { name: 'Staff Roles', value: String(getGuildRoles(guildId).length || 0), inline: true },
      { name: 'Stats', value: `Opened: ${stats.tickets || 0}\nClosed: ${stats.closed || 0}`, inline: false },
    );

  const actionRow1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('modmail:panel_settings').setLabel('📩 Panel Settings').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('modmail:channels').setLabel('📂 Channels').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('modmail:staff_roles').setLabel('👥 Staff Roles').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('modmail:appearance').setLabel('🎨 Appearance').setStyle(ButtonStyle.Secondary)
  );
  const actionRow2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('modmail:questions').setLabel('📝 Opening Questions').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('modmail:categories').setLabel('🏷️ Categories').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('modmail:settings').setLabel('⚙️ Ticket Settings').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('modmail:stats').setLabel('📊 Statistics').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [actionRow1, actionRow2] };
}

function buildCategorySelect(guildId) {
  const categories = getGuildCategories(guildId);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('dm:category_select')
    .setPlaceholder('Choose a category')
    .addOptions(
      categories.length ? categories.map((c) => ({
        label: `${c.emoji || '💬'} ${c.name}`,
        value: c.id,
        description: c.description || 'ModMail category',
      })) : [{ label: 'General Support', value: 'general', description: 'General support request' }]
    );
  return new ActionRowBuilder().addComponents(menu);
}

function buildPublicPanelMessage(guildId) {
  const conf = getGuildConfig(guildId);
  const button = new ButtonBuilder()
    .setCustomId('public:open_modmail')
    .setLabel(conf.panel_button_text || 'Open ModMail')
    .setEmoji(conf.panel_button_emoji || '📩')
    .setStyle(ButtonStyle.Primary);

  const embed = new EmbedBuilder()
    .setTitle(conf.panel_title || '📩 CONTACT STAFF')
    .setDescription(conf.panel_description || 'Need help, want to report something, appeal a punishment, or contact the staff team?')
    .setColor(conf.panel_color || 5793266)
    .setFooter({ text: 'ModMail • Secure support' })
    .setTimestamp();

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

async function createPublicPanel(guild, channelId) {
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return false;
  const panel = buildPublicPanelMessage(guild.id);
  await channel.send(panel);
  return true;
}

async function handlePublicButton(interaction) {
  const member = interaction.member;
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: 'This is only available in a server.', ephemeral: true });
  const block = getBlock(guild.id, interaction.user.id);
  if (block) {
    return interaction.reply({ content: `You are blocked from creating ModMail cases. Reason: ${block.reason || 'No reason provided.'}`, ephemeral: true });
  }

  const config = getGuildConfig(guild.id);
  const categories = getGuildCategories(guild.id);
  const opts = categories.length ? categories.map((c) => ({
    label: `${c.emoji || '💬'} ${c.name}`,
    value: c.id,
    description: c.description || 'Select a category',
  })) : [{ label: 'General Support', value: 'general', description: 'General support request' }];

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`dm:category_select:${interaction.user.id}`)
    .setPlaceholder('Choose a category')
    .addOptions(opts);

  const row = new ActionRowBuilder().addComponents(menu);
  await interaction.user.send({ content: 'Choose the kind of help you need.', components: [row] });
  await interaction.reply({ content: 'I sent you a DM to continue. Please check your direct messages.', ephemeral: true });
}

async function handleCategorySelect(interaction) {
  const value = interaction.values[0];
  const categoryId = value;
  const guild = interaction.guild;
  const categories = getGuildCategories(guild.id);
  const matching = categories.find((c) => c.id === categoryId) || { name: 'General Support', description: 'General support request', priority: 'normal' };

  const modal = new ModalBuilder().setCustomId(`dm:ticket_modal:${categoryId}`).setTitle(`New ${matching.name} Ticket`);
  const summaryInput = new TextInputBuilder()
    .setCustomId('summary')
    .setLabel('Describe your issue')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder('Tell us what happened...');

  modal.addComponents(new ActionRowBuilder().addComponents(summaryInput));
  await interaction.showModal(modal);
}

async function handleTicketModal(interaction) {
  const guild = interaction.guild || client.guilds.cache.first();
  const categoryId = interaction.customId.split(':')[2] || 'general';
  const summary = interaction.fields.getTextInputValue('summary');
  const categories = getGuildCategories(guild.id);
  const category = categories.find((c) => c.id === categoryId) || { name: 'General Support', description: 'General support request', priority: 'normal' };
  const cfg = getGuildConfig(guild.id);

  if (cfg.cooldown_minutes && getTicketByUser(guild.id, interaction.user.id)) {
    return interaction.reply({ content: 'You already have an open modmail ticket. Please wait for it to be resolved.', ephemeral: true });
  }

  const ticket = createTicket(guild.id, interaction.user.id, category.name, category.priority || cfg.default_priority || 'normal', summary);
  const inboxChannel = guild.channels.cache.get(cfg.modmail_inbox_channel_id) || await guild.channels.fetch(cfg.modmail_inbox_channel_id).catch(() => null);
  if (!inboxChannel) {
    return interaction.reply({ content: 'There is no configured modmail inbox on this server. Please contact an administrator.', ephemeral: true });
  }

  const thread = await inboxChannel.threads.create({
    name: `case-${ticket.case_number} ${interaction.user.tag}`,
    autoArchiveDuration: 10080,
    reason: `ModMail ticket #${ticket.case_number}`,
  });

  db.prepare('UPDATE tickets SET thread_id = ?, channel_id = ? WHERE id = ?').run(thread.id, inboxChannel.id, ticket.id);

  const embed = getTicketEmbed(ticket, guild);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket:claim:${ticket.id}`).setLabel('🟢 Claim').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ticket:reply:${ticket.id}`).setLabel('💬 Reply').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ticket:userinfo:${ticket.id}`).setLabel('👤 User Info').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:more:${ticket.id}`).setLabel('⚙️ More').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('🔒 Close').setStyle(ButtonStyle.Danger)
  );

  const msg = await thread.send({ embeds: [embed], components: [row] });
  await thread.send({ content: `📨 New ticket from <@${interaction.user.id}>` });
  await interaction.reply({ content: `Your ticket has been created. Case #${ticket.case_number} is now open.`, ephemeral: true });

  const userDm = await interaction.user.send({
    embeds: [new EmbedBuilder().setTitle(`Ticket #${ticket.case_number} created`).setDescription(`Your ticket has been opened in category **${category.name}**. A staff member will respond soon.`).setColor(0x2ecc71)]
  }).catch(() => null);

  if (userDm) {
    db.prepare('UPDATE tickets SET user_dm_channel_id = ? WHERE id = ?').run(userDm.channelId, ticket.id);
  }

  addTicketMessage(ticket.id, 'user', interaction.user.id, interaction.user.tag, summary, [], 'normal');
  addLog(guild.id, 'ticket_created', `Case #${ticket.case_number} created`, null, ticket.id);
}

async function handleTicketClaim(interaction) {
  const [, , ticketId] = interaction.customId.split(':');
  const ticket = getTicket(ticketId);
  if (!ticket) return interaction.reply({ content: 'Ticket not found.', ephemeral: true });
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: 'Unable to resolve guild.', ephemeral: true });
  const cfg = getGuildConfig(guild.id);

  if (ticket.claimed_by && ticket.claimed_by !== interaction.user.id && cfg.exclusive_claims) {
    return interaction.reply({ content: `This ticket is already claimed by <@${ticket.claimed_by}>.`, ephemeral: true });
  }

  const result = claimTicket(ticket.id, interaction.user.id, Boolean(cfg.exclusive_claims));
  if (!result) {
    return interaction.reply({ content: 'This ticket could not be claimed right now. It may have been claimed by another staff member.', ephemeral: true });
  }

  const thread = guild.channels.cache.get(ticket.thread_id) || await guild.channels.fetch(ticket.thread_id).catch(() => null);
  if (thread) {
    const embed = getTicketEmbed(result, guild);
    await thread.send({ content: `<@${interaction.user.id}> claimed this ticket.`, embeds: [embed] });
  }
  await interaction.reply({ content: `You have claimed case #${ticket.case_number}.`, ephemeral: true });
}

async function handleTicketClose(interaction) {
  const ticketId = interaction.customId.split(':')[2];
  const ticket = getTicket(ticketId);
  if (!ticket) return interaction.reply({ content: 'Ticket not found.', ephemeral: true });

  const modal = new ModalBuilder().setCustomId(`close:reason:${ticket.id}`).setTitle('Close ticket');
  const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Close reason (optional)').setStyle(TextInputStyle.Short).setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  await interaction.showModal(modal);
}

async function handleCloseReasonModal(interaction) {
  const ticketId = interaction.customId.split(':')[2];
  const ticket = getTicket(ticketId);
  const reason = interaction.fields.getTextInputValue('reason') || 'Closed by staff';
  const guild = interaction.guild;
  const thread = guild.channels.cache.get(ticket.thread_id) || await guild.channels.fetch(ticket.thread_id).catch(() => null);

  db.prepare('UPDATE tickets SET status = ?, closed_at = ?, close_reason = ? WHERE id = ?').run('closed', new Date().toISOString(), reason, ticket.id);
  const messages = getTicketMessages(ticket.id);
  const file = generateTranscript(ticket.id, guild.id, ticket.user_id, ticket, ticket.category, ticket.priority, ticket.tags || [], reason, 'Support Staff', messages);

  if (thread) {
    await thread.send({ content: `🔒 Ticket closed. Reason: ${reason}` });
  }

  const user = await client.users.fetch(ticket.user_id).catch(() => null);
  if (user) {
    await user.send({ embeds: [new EmbedBuilder().setTitle(`Your ModMail case #${ticket.case_number} has been closed`).setDescription(`Reason: ${reason}`).setColor(0xe74c3c)] }).catch(() => null);
  }

  addLog(guild.id, 'ticket_closed', reason, interaction.user.id, ticket.id);
  await interaction.reply({ content: `Case #${ticket.case_number} closed. Transcript saved at ${file}.`, ephemeral: true });
}

async function handleUserInfo(interaction) {
  const ticketId = interaction.customId.split(':')[2];
  const ticket = getTicket(ticketId);
  if (!ticket) return interaction.reply({ content: 'Ticket not found.', ephemeral: true });
  const guild = interaction.guild;
  const member = guild.members.cache.get(ticket.user_id) || await guild.members.fetch(ticket.user_id).catch(() => null);
  const user = await client.users.fetch(ticket.user_id).catch(() => null);
  const history = getUserCaseHistory(guild.id, ticket.user_id);
  const block = getBlock(guild.id, ticket.user_id);

  const embed = new EmbedBuilder()
    .setTitle(`${user?.tag || ticket.user_id} · ModMail Access`)
    .setThumbnail(user?.displayAvatarURL({ dynamic: true, size: 256 }) || null)
    .addFields(
      { name: 'User ID', value: String(ticket.user_id), inline: true },
      { name: 'Account', value: user ? `<t:${Math.floor((user.createdTimestamp || 0)/1000)}:F>` : 'Unknown', inline: true },
      { name: 'Joined Server', value: member ? `<t:${Math.floor((member.joinedTimestamp || 0)/1000)}:F>` : 'Unknown', inline: true },
      { name: 'Roles', value: member ? member.roles.cache.map((r) => r.name).slice(0, 10).join(', ') || 'None' : 'Unknown', inline: false },
      { name: 'ModMail History', value: String(history.length), inline: true },
      { name: 'Open Cases', value: String(history.filter((h) => h.status === 'open').length), inline: true },
      { name: 'Closed Cases', value: String(history.filter((h) => h.status === 'closed').length), inline: true },
      { name: 'Blocked', value: block ? `Yes — ${block.reason || 'No reason provided.'}` : 'No', inline: false },
    )
    .setColor(0x5865f2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket:history:${ticket.id}`).setLabel('📜 Case History').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:block:${ticket.id}`).setLabel('🚫 Block User').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ticket:more:${ticket.id}`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

async function handleTicketReply(interaction) {
  const ticketId = interaction.customId.split(':')[2];
  const modal = new ModalBuilder().setCustomId(`ticket:reply_modal:${ticketId}`).setTitle('Send a reply');
  const contentInput = new TextInputBuilder().setCustomId('reply').setLabel('Message').setStyle(TextInputStyle.Paragraph).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(contentInput));
  await interaction.showModal(modal);
}

async function handleTicketReplyModal(interaction) {
  const [_, __, ticketId] = interaction.customId.split(':');
  const message = interaction.fields.getTextInputValue('reply');
  const ticket = getTicket(ticketId);
  if (!ticket) return interaction.reply({ content: 'Ticket not found.', ephemeral: true });
  const user = await client.users.fetch(ticket.user_id).catch(() => null);
  if (user) {
    await user.send({ embeds: [new EmbedBuilder().setTitle(`Staff response · Case #${ticket.case_number}`).setDescription(message).setColor(0x5865f2)] }).catch(() => null);
  }
  addTicketMessage(ticketId, 'staff', interaction.user.id, interaction.user.tag, message, [], 'normal');
  addLog(ticket.guild_id, 'staff_reply', message, interaction.user.id, ticketId);
  await interaction.reply({ content: 'Reply sent to the user.', ephemeral: true });
}

async function handleTicketInternalNote(interaction) {
  const ticketId = interaction.customId.split(':')[2];
  const modal = new ModalBuilder().setCustomId(`ticket:note_modal:${ticketId}`).setTitle('Add internal note');
  const noteInput = new TextInputBuilder().setCustomId('note').setLabel('Internal note').setStyle(TextInputStyle.Paragraph).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
  await interaction.showModal(modal);
}

async function handleTicketNoteModal(interaction) {
  const ticketId = interaction.customId.split(':')[2];
  const note = interaction.fields.getTextInputValue('note');
  setTicketNote(ticketId, note);
  await interaction.reply({ content: 'Internal note saved.', ephemeral: true });
}

async function handleTicketBlock(interaction) {
  const ticketId = interaction.customId.split(':')[2];
  const ticket = getTicket(ticketId);
  const modal = new ModalBuilder().setCustomId(`ticket:block_modal:${ticketId}`).setTitle('Block user');
  const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Block reason').setStyle(TextInputStyle.Short).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  await interaction.showModal(modal);
}

async function handleTicketBlockModal(interaction) {
  const ticketId = interaction.customId.split(':')[2];
  const reason = interaction.fields.getTextInputValue('reason');
  const ticket = getTicket(ticketId);
  blockUser(ticket.guild_id, ticket.user_id, reason, interaction.user.id);
  await interaction.reply({ content: `User <@${ticket.user_id}> has been blocked from creating new modmail requests.`, ephemeral: true });
}

function buildMoreMenu(ticketId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket:userinfo:${ticketId}`).setLabel('👤 User Info').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:history:${ticketId}`).setLabel('📜 History').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:block:${ticketId}`).setLabel('🚫 Block User').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ticket:close:${ticketId}`).setLabel('🔒 Close').setStyle(ButtonStyle.Danger)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket:note:${ticketId}`).setLabel('📝 Internal Note').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:reply:${ticketId}`).setLabel('💬 Reply').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ticket:claim:${ticketId}`).setLabel('🟢 Claim').setStyle(ButtonStyle.Success)
  );
  return [row1, row2];
}

async function handleTicketMore(interaction) {
  const ticketId = interaction.customId.split(':')[2];
  const ticket = getTicket(ticketId);
  if (!ticket) return interaction.reply({ content: 'Ticket not found.', ephemeral: true });
  await interaction.reply({ content: `More actions for case #${ticket.case_number}`, components: buildMoreMenu(ticketId), ephemeral: true });
}

async function handleChannelSelect(interaction) {
  const type = interaction.customId.split(':')[1];
  const [_, __, ...rest] = interaction.customId.split(':');
  const guildId = interaction.guild.id;
  const channelId = interaction.values[0];
  const cfg = getGuildConfig(guildId);

  if (type === 'modmail_inbox') {
    saveGuildConfig(guildId, { modmail_inbox_channel_id: channelId });
    await interaction.reply({ content: `ModMail inbox channel set to <#${channelId}>.`, ephemeral: true });
  }
  if (type === 'transcript') {
    saveGuildConfig(guildId, { transcript_channel_id: channelId });
    await interaction.reply({ content: `Transcript channel set to <#${channelId}>.`, ephemeral: true });
  }
  if (type === 'log') {
    saveGuildConfig(guildId, { log_channel_id: channelId });
    await interaction.reply({ content: `Log channel set to <#${channelId}>.`, ephemeral: true });
  }
  if (type === 'panel') {
    saveGuildConfig(guildId, { public_panel_channel_id: channelId });
    await interaction.reply({ content: `Public panel channel set to <#${channelId}>.`, ephemeral: true });
  }
}

async function handleStaffRoleSelect(interaction) {
  const roleId = interaction.values[0];
  const guild = interaction.guild;
  const role = guild.roles.cache.get(roleId);
  upsertGuildRole(guild.id, role.id, role.name, true);
  await interaction.reply({ content: `Staff role added: ${role.name}`, ephemeral: true });
}

async function handleDashboardAction(interaction) {
  const action = interaction.customId.split(':')[1];
  const guildId = interaction.guild.id;
  const config = getGuildConfig(guildId);

  switch (action) {
    case 'panel_settings': {
      const channelMenu = new StringSelectMenuBuilder().setCustomId('config:channel:panel').setPlaceholder('Select public panel channel').addOptions(
        interaction.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).map((c) => ({ label: c.name, value: c.id }))
      );
      await interaction.reply({ content: 'Choose a public panel channel:', components: [new ActionRowBuilder().addComponents(channelMenu)], ephemeral: true });
      break;
    }
    case 'channels': {
      const row1 = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config:channel:modmail_inbox').setPlaceholder('Select inbox channel').addOptions(interaction.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).map((c) => ({ label: c.name, value: c.id }))));
      const row2 = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config:channel:transcript').setPlaceholder('Select transcript channel').addOptions(interaction.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).map((c) => ({ label: c.name, value: c.id }))));
      const row3 = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config:channel:log').setPlaceholder('Select log channel').addOptions(interaction.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).map((c) => ({ label: c.name, value: c.id }))));
      await interaction.reply({ content: 'Select channels:', components: [row1, row2, row3], ephemeral: true });
      break;
    }
    case 'staff_roles': {
      const menu = new StringSelectMenuBuilder().setCustomId('config:role:add').setPlaceholder('Select a staff role').addOptions(
        interaction.guild.roles.cache.map((role) => ({ label: role.name, value: role.id }))
      );
      await interaction.reply({ content: 'Choose staff roles:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      break;
    }
    case 'appearance': {
      await interaction.reply({ content: 'Appearance settings are managed in the database-backed config. Use the modmail config to update title, description, button text, color, and emoji.', ephemeral: true });
      break;
    }
    case 'questions': {
      const categories = getGuildCategories(guildId);
      const categoryMenu = new StringSelectMenuBuilder().setCustomId('config:question:category').setPlaceholder('Select category').addOptions(categories.map(c => ({ label: c.name, value: c.id })));
      await interaction.reply({ content: 'Select a category to manage opening questions:', components: [new ActionRowBuilder().addComponents(categoryMenu)], ephemeral: true });
      break;
    }
    case 'categories': {
      const categories = getGuildCategories(guildId);
      const options = categories.length ? categories.map((c) => ({ label: `${c.emoji || '💬'} ${c.name}`, value: c.id })) : [{ label: 'General Support', value: 'general' }];
      const menu = new StringSelectMenuBuilder().setCustomId('config:category:view').setPlaceholder('Choose a category').addOptions(options);
      await interaction.reply({ content: 'Manage categories:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      break;
    }
    case 'settings': {
      await interaction.reply({ content: `Current settings: default priority ${config.default_priority}, forwarding ${config.message_forwarding_mode}, anonymous replies ${config.allow_anonymous_replies ? 'enabled' : 'disabled'}, exclusive claims ${config.exclusive_claims ? 'enabled' : 'disabled'}.`, ephemeral: true });
      break;
    }
    case 'stats': {
      const stats = getGuildStats(guildId);
      await interaction.reply({ content: `Statistics: total tickets ${stats.tickets}, open ${stats.open}, closed ${stats.closed}.`, ephemeral: true });
      break;
    }
    default:
      await interaction.reply({ content: 'Unrecognized dashboard action.', ephemeral: true });
  }
}

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = env.guildId ? client.guilds.cache.get(env.guildId) : client.guilds.cache.first();
  if (guild) {
    const cfg = getGuildConfig(guild.id);
    if (!cfg.modmail_inbox_channel_id) {
      console.log(`Guild ${guild.name} has no ModMail inbox configured yet.`);
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    if (interaction.isButton()) {
      if (interaction.customId === 'public:open_modmail') {
        await handlePublicButton(interaction);
        return;
      }
      if (interaction.customId.startsWith('modmail:')) {
        await handleDashboardAction(interaction);
        return;
      }
      if (interaction.customId.startsWith('ticket:')) {
        const action = interaction.customId.split(':')[1];
        if (action === 'claim') await handleTicketClaim(interaction);
        else if (action === 'close') await handleTicketClose(interaction);
        else if (action === 'reply') await handleTicketReply(interaction);
        else if (action === 'note') await handleTicketInternalNote(interaction);
        else if (action === 'userinfo') await handleUserInfo(interaction);
        else if (action === 'block') await handleTicketBlock(interaction);
        else if (action === 'more') await handleTicketMore(interaction);
        else if (action === 'history') await interaction.reply({ content: 'Ticket history view is available in the staff UI. This demo includes persistent ticket metadata and transcripts.', ephemeral: true });
        return;
      }
      if (interaction.customId.startsWith('config:')) {
        if (interaction.customId.startsWith('config:channel:')) await handleChannelSelect(interaction);
        if (interaction.customId.startsWith('config:role:')) await handleStaffRoleSelect(interaction);
        return;
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('dm:category_select')) {
        await handleCategorySelect(interaction);
        return;
      }
      if (interaction.customId.startsWith('config:channel:')) {
        await handleChannelSelect(interaction);
        return;
      }
      if (interaction.customId.startsWith('config:role:')) {
        await handleStaffRoleSelect(interaction);
        return;
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('dm:ticket_modal')) {
        await handleTicketModal(interaction);
        return;
      }
      if (interaction.customId.startsWith('close:reason')) {
        await handleCloseReasonModal(interaction);
        return;
      }
      if (interaction.customId.startsWith('ticket:reply_modal')) {
        await handleTicketReplyModal(interaction);
        return;
      }
      if (interaction.customId.startsWith('ticket:note_modal')) {
        await handleTicketNoteModal(interaction);
        return;
      }
      if (interaction.customId.startsWith('ticket:block_modal')) {
        await handleTicketBlockModal(interaction);
        return;
      }
      return;
    }
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'modmail') {
    const data = buildDashboard(interaction.guildId);
    await interaction.reply({ ...data, ephemeral: false });
    return;
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.type === 'DM') {
    const openTicket = db.prepare('SELECT * FROM tickets WHERE user_id = ? AND status = ? ORDER BY opened_at DESC LIMIT 1').get(message.author.id, 'open');
    if (!openTicket) {
      return;
    }
    const guild = client.guilds.cache.get(openTicket.guild_id);
    if (!guild) return;
    const thread = guild.channels.cache.get(openTicket.thread_id) || await guild.channels.fetch(openTicket.thread_id).catch(() => null);
    if (thread) {
      const files = message.attachments.map((attachment) => attachment.url);
      addTicketMessage(openTicket.id, 'user', message.author.id, message.author.tag, message.content, files, 'normal');
      const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle('User message received').setDescription(message.content || 'Attachment only').addFields({ name: 'Attachments', value: files.length ? files.join('\n') : 'None' });
      await thread.send({ embeds: [embed] });
    }
  }
  const guild = message.guild;
  if (!guild) return;
  const ticket = db.prepare('SELECT * FROM tickets WHERE thread_id = ?').get(message.channel.id);
  if (!ticket) return;
  if (message.author.bot) return;
  const config = getGuildConfig(guild.id);
  const attachments = message.attachments.map((attachment) => attachment.url);
  addTicketMessage(ticket.id, 'staff', message.author.id, message.author.tag, message.content, attachments, 'normal');
  if (config.message_forwarding_mode === 'auto_forward') {
    const user = await client.users.fetch(ticket.user_id).catch(() => null);
    if (user) {
      await user.send({ embeds: [new EmbedBuilder().setTitle(`Staff response`).setDescription(message.content || 'Attachment only').setColor(0x5865f2)] }).catch(() => null);
    }
  }
});

export async function startBot() {
  await client.login(env.token);
}

export { client };

