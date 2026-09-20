import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

export const env = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  botName: process.env.BOT_NAME || 'ModMail 2.0',
  dbPath: process.env.DB_PATH || path.resolve(process.cwd(), 'data/modmail.db'),
  logLevel: process.env.LOG_LEVEL || 'info',
};

export function ensureEnv() {
  const missing = [];
  if (!env.token) missing.push('DISCORD_TOKEN');
  if (!env.clientId) missing.push('CLIENT_ID');
  if (missing.length) {
    throw new Error(`Missing required env variables: ${missing.join(', ')}. Run \`npm run setup\` or copy .env.example to .env and fill values.`);
  }
}

export function ensureDirectories() {
  fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });
  fs.mkdirSync(path.resolve(process.cwd(), 'data/transcripts'), { recursive: true });
}
