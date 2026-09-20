#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });

const vars = [
  ['DISCORD_TOKEN', 'Discord bot token'],
  ['CLIENT_ID', 'Discord application client ID'],
  ['GUILD_ID', 'Primary guild ID (optional, for testing slash commands)'],
  ['BOT_NAME', 'Display name for the bot']
];

const envPath = path.resolve(process.cwd(), '.env');
const exists = fs.existsSync(envPath);

const current = exists ? Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .map((line) => {
      const idx = line.indexOf('=');
      if (idx === -1) return null;
      return [line.slice(0, idx), line.slice(idx + 1)];
    })
    .filter(Boolean)
) : {};

for (const [key, description] of vars) {
  const existing = current[key] || '';
  const defaultValue = existing ? ` [current: ${existing}]` : '';
  const answer = await rl.question(`${description}${defaultValue}\n> `);
  if (answer.trim()) {
    current[key] = answer.trim();
  }
}

const lines = Object.entries(current)
  .map(([key, value]) => `${key}=${value}`)
  .join('\n');

fs.mkdirSync(path.dirname(envPath), { recursive: true });
fs.writeFileSync(envPath, `${lines}\n`);
console.log(`Saved configuration to ${envPath}`);
console.log('Now run: npm install && npm start');
await rl.close();
