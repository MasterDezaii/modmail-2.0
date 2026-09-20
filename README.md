import { startBot } from './discord.js';

startBot().catch((error) => {
  console.error('Failed to start ModMail bot:', error);
  process.exit(1);
});

