import path from 'node:path';

const rootDir = process.cwd();

export const config = {
  port: Number(process.env.PORT || 3000),
  model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
  databasePath: process.env.DATABASE_PATH || path.join(rootDir, 'data', 'kfc-demo.sqlite'),
  menuPath: process.env.MENU_PATH || path.join(rootDir, 'kfc_menu.json'),
  dashboardPath: path.join(rootDir, 'public'),
  zaloBotToken: process.env.ZALO_BOT_TOKEN || '',
  zaloWebhookSecret: process.env.ZALO_WEBHOOK_SECRET || '',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
};

