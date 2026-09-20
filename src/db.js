import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { env, ensureDirectories } from './config.js';

ensureDirectories();

const db = new Database(env.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS guilds (
    id TEXT PRIMARY KEY,
    name TEXT,
    modmail_inbox_channel_id TEXT,
    transcript_channel_id TEXT,
    log_channel_id TEXT,
    public_panel_channel_id TEXT,
    default_priority TEXT DEFAULT 'normal',
    allow_anonymous_replies INTEGER DEFAULT 1,
    exclusive_claims INTEGER DEFAULT 0,
    automatic_transcripts INTEGER DEFAULT 1,
    dm_notifications INTEGER DEFAULT 1,
    cooldown_minutes INTEGER DEFAULT 0,
    message_forwarding_mode TEXT DEFAULT 'button_only',
    anti_spam_limit INTEGER DEFAULT 10,
    panel_title TEXT DEFAULT '📩 CONTACT STAFF',
    panel_description TEXT DEFAULT 'Need help, want to report something, appeal a punishment, or contact the staff team?',
    panel_color INTEGER DEFAULT 5793266,
    panel_button_text TEXT DEFAULT 'Open ModMail',
    panel_button_emoji TEXT DEFAULT '📩',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guild_staff_roles (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    name TEXT,
    can_manage_staff INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guild_categories (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    emoji TEXT,
    description TEXT,
    questions TEXT,
    inbox_channel_id TEXT,
    priority TEXT DEFAULT 'normal',
    color INTEGER DEFAULT 5793266,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS guild_questions (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    category_id TEXT,
    question TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS guild_blocks (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reason TEXT,
    moderator_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    case_number INTEGER NOT NULL,
    category TEXT,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'open',
    summary TEXT,
    claimed_by TEXT,
    claimed_at TEXT,
    opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT,
    close_reason TEXT,
    thread_id TEXT,
    channel_id TEXT,
    user_dm_channel_id TEXT,
    exclusive_claim INTEGER DEFAULT 0,
    is_blocked INTEGER DEFAULT 0,
    is_anonymous INTEGER DEFAULT 0,
    tags TEXT DEFAULT '',
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS ticket_messages (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    sender_type TEXT NOT NULL,
    sender_id TEXT,
    author_name TEXT,
    content TEXT,
    attachment_urls TEXT,
    message_type TEXT DEFAULT 'normal',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ticket_staff (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'staff'
  );

  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    ticket_id TEXT,
    action TEXT NOT NULL,
    details TEXT,
    moderator_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    ticket_id TEXT NOT NULL,
    channel_id TEXT,
    file_path TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

function safeJson(value) {
  if (!value) return '[]';
  return JSON.stringify(value);
}

function parseJson(value) {
  try {
    return JSON.parse(value || '[]');
  } catch {
    return [];
  }
}

export function getGuildConfig(guildId) {
  const row = db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId);
  if (!row) {
    const defaultGuild = {
      id: guildId,
      name: 'Guild',
      modmail_inbox_channel_id: null,
      transcript_channel_id: null,
      log_channel_id: null,
      public_panel_channel_id: null,
      default_priority: 'normal',
      allow_anonymous_replies: 1,
      exclusive_claims: 0,
      automatic_transcripts: 1,
      dm_notifications: 1,
      cooldown_minutes: 0,
      message_forwarding_mode: 'button_only',
      anti_spam_limit: 10,
      panel_title: '📩 CONTACT STAFF',
      panel_description: 'Need help, want to report something, appeal a punishment, or contact the staff team?',
      panel_color: 5793266,
      panel_button_text: 'Open ModMail',
      panel_button_emoji: '📩',
    };
    insertGuild(defaultGuild);
    return defaultGuild;
  }
  return row;
}

export function insertGuild(data) {
  const id = data.id || uuid();
  db.prepare(`
    INSERT OR REPLACE INTO guilds (
      id, name, modmail_inbox_channel_id, transcript_channel_id, log_channel_id,
      public_panel_channel_id, default_priority, allow_anonymous_replies, exclusive_claims,
      automatic_transcripts, dm_notifications, cooldown_minutes, message_forwarding_mode,
      anti_spam_limit, panel_title, panel_description, panel_color, panel_button_text,
      panel_button_emoji, created_at
    ) VALUES (
      @id, @name, @modmail_inbox_channel_id, @transcript_channel_id, @log_channel_id,
      @public_panel_channel_id, @default_priority, @allow_anonymous_replies, @exclusive_claims,
      @automatic_transcripts, @dm_notifications, @cooldown_minutes, @message_forwarding_mode,
      @anti_spam_limit, @panel_title, @panel_description, @panel_color, @panel_button_text,
      @panel_button_emoji, COALESCE(@created_at, CURRENT_TIMESTAMP)
    )
  `).run({ ...data, id });
  return { ...data, id };
}

export function saveGuildConfig(guildId, updates) {
  const existing = getGuildConfig(guildId);
  const final = { ...existing, ...updates, id: guildId };
  insertGuild(final);
  return final;
}

export function getGuildCategories(guildId) {
  return db.prepare('SELECT * FROM guild_categories WHERE guild_id = ? ORDER BY sort_order ASC, id ASC').all(guildId);
}

export function addCategory(guildId, category) {
  const id = category.id || uuid();
  db.prepare(`INSERT OR REPLACE INTO guild_categories (id, guild_id, name, emoji, description, questions, inbox_channel_id, priority, color, sort_order) VALUES (@id, @guild_id, @name, @emoji, @description, @questions, @inbox_channel_id, @priority, @color, @sort_order)`).run({
    id,
    guild_id: guildId,
    name: category.name,
    emoji: category.emoji || '💬',
    description: category.description || '',
    questions: safeJson(category.questions || []),
    inbox_channel_id: category.inbox_channel_id || null,
    priority: category.priority || 'normal',
    color: category.color || 5793266,
    sort_order: category.sort_order || 0,
  });
  return { ...category, id };
}

export function deleteCategory(guildId, categoryId) {
  db.prepare('DELETE FROM guild_categories WHERE guild_id = ? AND id = ?').run(guildId, categoryId);
  db.prepare('DELETE FROM guild_questions WHERE guild_id = ? AND category_id = ?').run(guildId, categoryId);
}

export function getCategoryQuestions(guildId, categoryId) {
  const rows = db.prepare('SELECT * FROM guild_questions WHERE guild_id = ? AND category_id = ? ORDER BY sort_order ASC, id ASC').all(guildId, categoryId);
  return rows.map((row) => ({ ...row, question: row.question }));
}

export function addQuestion(guildId, categoryId, questionText) {
  const id = uuid();
  const nextSort = db.prepare('SELECT MAX(sort_order) AS maxSort FROM guild_questions WHERE guild_id = ? AND category_id = ?').get(guildId, categoryId)?.maxSort ?? 0;
  db.prepare('INSERT INTO guild_questions (id, guild_id, category_id, question, sort_order) VALUES (?, ?, ?, ?, ?)').run(id, guildId, categoryId, questionText, nextSort + 1);
  return { id, guild_id: guildId, category_id: categoryId, question: questionText, sort_order: nextSort + 1 };
}

export function getGuildRoles(guildId) {
  return db.prepare('SELECT * FROM guild_staff_roles WHERE guild_id = ? ORDER BY created_at ASC').all(guildId);
}

export function upsertGuildRole(guildId, roleId, roleName, canManage = 0) {
  const id = `${guildId}:${roleId}`;
  db.prepare(`INSERT INTO guild_staff_roles (id, guild_id, role_id, name, can_manage_staff) VALUES (@id, @guild_id, @role_id, @name, @can_manage_staff)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, can_manage_staff = excluded.can_manage_staff`).run({
    id,
    guild_id: guildId,
    role_id: roleId,
    name: roleName,
    can_manage_staff: canManage ? 1 : 0,
  });
}

export function removeGuildRole(guildId, roleId) {
  db.prepare('DELETE FROM guild_staff_roles WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
}

export function isStaffMember(guildId, userId) {
  const guild = getGuildConfig(guildId);
  if (!guild) return false;
  return !!db.prepare('SELECT 1 FROM guild_staff_roles WHERE guild_id = ?').get(guildId);
}

export function addLog(guildId, action, details, moderatorId = null, ticketId = null) {
  db.prepare('INSERT INTO logs (id, guild_id, ticket_id, action, details, moderator_id) VALUES (?, ?, ?, ?, ?, ?)').run(uuid(), guildId, ticketId, action, details, moderatorId);
}

export function getTicket(ticketId) {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  if (!ticket) return null;
  ticket.tags = parseJson(ticket.tags);
  ticket.notes = ticket.notes || '';
  return ticket;
}

export function getTicketByUser(guildId, userId) {
  return db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = ? ORDER BY opened_at DESC LIMIT 1').get(guildId, userId, 'open');
}

export function getTicketsByGuild(guildId) {
  return db.prepare('SELECT * FROM tickets WHERE guild_id = ? ORDER BY opened_at DESC').all(guildId);
}

export function getOpenTicketsCount(guildId) {
  return db.prepare('SELECT COUNT(*) AS count FROM tickets WHERE guild_id = ? AND status = ?').get(guildId, 'open').count;
}

export function getClaimedTicketsCount(guildId) {
  return db.prepare('SELECT COUNT(*) AS count FROM tickets WHERE guild_id = ? AND claimed_by IS NOT NULL AND status = ?').get(guildId, 'open').count;
}

export function createTicket(guildId, userId, category, priority, summary, threadId = null, channelId = null, userDmChannelId = null) {
  const caseNumber = (db.prepare('SELECT COALESCE(MAX(case_number), 0) + 1 AS nextCase FROM tickets WHERE guild_id = ?').get(guildId)?.nextCase ?? 1);
  const ticketId = uuid();
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO tickets (id, guild_id, user_id, case_number, category, priority, status, summary, thread_id, channel_id, user_dm_channel_id, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    ticketId,
    guildId,
    userId,
    caseNumber,
    category,
    priority,
    'open',
    summary,
    threadId,
    channelId,
    userDmChannelId,
    now,
  );

  addLog(guildId, 'ticket_created', `Case #${caseNumber} created for user ${userId} in category ${category}`, null, ticketId);

  return getTicket(ticketId);
}

export function claimTicket(ticketId, moderatorId, exclusive = false) {
  const ticket = getTicket(ticketId);
  if (!ticket) return null;
  const now = new Date().toISOString();
  const claimed = db.prepare('UPDATE tickets SET claimed_by = ?, claimed_at = ?, exclusive_claim = ? WHERE id = ? AND status = ? AND (claimed_by IS NULL OR claimed_by = ? OR ? = 1)').run(moderatorId, now, exclusive ? 1 : 0, ticketId, 'open', moderatorId, exclusive ? 1 : 0);
  if (claimed.changes === 0) return null;
  addLog(ticket.guild_id, 'ticket_claimed', `User ${moderatorId} claimed case #${ticket.case_number}`, moderatorId, ticketId);
  return getTicket(ticketId);
}

export function unclaimTicket(ticketId, moderatorId = null) {
  const ticket = getTicket(ticketId);
  if (!ticket) return null;
  const changed = db.prepare('UPDATE tickets SET claimed_by = NULL, claimed_at = NULL WHERE id = ? AND status = ?').run(ticketId, 'open');
  if (changed.changes === 0) return null;
  addLog(ticket.guild_id, 'ticket_unclaimed', `Case #${ticket.case_number} unclaimed${moderatorId ? ` by ${moderatorId}` : ''}`, moderatorId, ticketId);
  return getTicket(ticketId);
}

export function updateTicketState(ticketId, updates) {
  const ticket = getTicket(ticketId);
  if (!ticket) return null;
  const merged = { ...ticket, ...updates };
  const fields = [
    'category', 'priority', 'status', 'summary', 'claimed_by', 'claimed_at', 'closed_at', 'close_reason', 'thread_id', 'channel_id', 'user_dm_channel_id', 'is_blocked', 'is_anonymous', 'tags', 'notes'
  ];

  const setParts = [];
  const values = [];

  for (const field of fields) {
    if (field in merged) {
      setParts.push(`${field} = ?`);
      values.push(merged[field]);
    }
  }

  values.push(ticketId);
  db.prepare(`UPDATE tickets SET ${setParts.join(', ')} WHERE id = ?`).run(...values);
  return getTicket(ticketId);
}

export function addTicketMessage(ticketId, senderType, senderId, authorName, content, attachmentUrls = [], messageType = 'normal') {
  db.prepare('INSERT INTO ticket_messages (id, ticket_id, guild_id, sender_type, sender_id, author_name, content, attachment_urls, message_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuid(), ticketId, getTicket(ticketId)?.guild_id, senderType, senderId, authorName, content || '', JSON.stringify(attachmentUrls), messageType);
}

export function getTicketMessages(ticketId) {
  return db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(ticketId);
}

export function setTicketTags(ticketId, tags) {
  const ticket = getTicket(ticketId);
  if (!ticket) return null;
  db.prepare('UPDATE tickets SET tags = ? WHERE id = ?').run(JSON.stringify(tags), ticketId);
  addLog(ticket.guild_id, 'ticket_tags_updated', `Tags updated to ${tags.join(', ') || 'none'}`, null, ticketId);
  return getTicket(ticketId);
}

export function setTicketPriority(ticketId, priority) {
  const ticket = getTicket(ticketId);
  if (!ticket) return null;
  db.prepare('UPDATE tickets SET priority = ? WHERE id = ?').run(priority, ticketId);
  addLog(ticket.guild_id, 'ticket_priority_changed', `Priority changed to ${priority}`, null, ticketId);
  return getTicket(ticketId);
}

export function setTicketNote(ticketId, note) {
  const ticket = getTicket(ticketId);
  if (!ticket) return null;
  const next = ticket.notes ? `${ticket.notes}\n${note}` : note;
  db.prepare('UPDATE tickets SET notes = ? WHERE id = ?').run(next, ticketId);
  addLog(ticket.guild_id, 'ticket_note_added', note, null, ticketId);
  return getTicket(ticketId);
}

export function getBlock(guildId, userId) {
  return db.prepare('SELECT * FROM guild_blocks WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1').get(guildId, userId);
}

export function blockUser(guildId, userId, reason, moderatorId) {
  const id = uuid();
  db.prepare('INSERT INTO guild_blocks (id, guild_id, user_id, reason, moderator_id) VALUES (?, ?, ?, ?, ?)').run(id, guildId, userId, reason, moderatorId);
  addLog(guildId, 'user_blocked', reason, moderatorId);
}

export function unblockUser(guildId, userId) {
  const row = getBlock(guildId, userId);
  if (!row) return false;
  db.prepare('DELETE FROM guild_blocks WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  addLog(guildId, 'user_unblocked', 'User unblocked', null);
  return true;
}

export function getUserCaseHistory(guildId, userId) {
  return db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? ORDER BY opened_at DESC').all(guildId, userId);
}

export function generateTranscript(ticketId, guildId, userId, summary, category, priority, tags, closeReason, openerName, messages = []) {
  const content = [
    '=== ModMail Transcript ===',
    `Case #${ticketId}`,
    `Guild: ${guildId}`,
    `User: ${userId}`,
    `Category: ${category}`,
    `Priority: ${priority}`,
    `Tags: ${Array.isArray(tags) ? tags.join(', ') : (tags || 'none')}`,
    `Opened: ${summary?.opened_at || 'n/a'}`,
    `Closed: ${summary?.closed_at || 'n/a'}`,
    `Close Reason: ${closeReason || 'none'}`,
    '',
    '--- Conversation ---',
    ...messages.map((m) => `[${m.created_at}] ${m.sender_type.toUpperCase()} ${m.author_name || m.sender_id}: ${m.content || '[attachment]'}${m.attachment_urls ? ` ${m.attachment_urls}` : ''}`),
  ].join('\n');

  const transcriptDir = path.resolve(process.cwd(), 'data/transcripts');
  const filePath = path.join(transcriptDir, `${ticketId}.txt`);
  fs.writeFileSync(filePath, content, 'utf8');
  db.prepare('INSERT INTO transcripts (id, guild_id, ticket_id, file_path) VALUES (?, ?, ?, ?)').run(uuid(), guildId, ticketId, filePath);
  return filePath;
}

export function getStatusCounts(guildId) {
  const open = db.prepare('SELECT COUNT(*) AS count FROM tickets WHERE guild_id = ? AND status = ?').get(guildId, 'open').count;
  const claimed = db.prepare('SELECT COUNT(*) AS count FROM tickets WHERE guild_id = ? AND status = ? AND claimed_by IS NOT NULL').get(guildId, 'open').count;
  const unclaimed = open - claimed;
  return { open, claimed, unclaimed };
}

export function getGuildStats(guildId) {
  const tickets = db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE guild_id = ?').get(guildId).total;
  const open = db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE guild_id = ? AND status = ?').get(guildId, 'open').total;
  const closed = db.prepare('SELECT COUNT(*) AS total FROM tickets WHERE guild_id = ? AND status = ?').get(guildId, 'closed').total;
  return { tickets, open, closed };
}

export default db;
