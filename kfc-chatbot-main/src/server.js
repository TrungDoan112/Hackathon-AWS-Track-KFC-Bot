import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { ChatService } from './application/chat-service.js';
import { ZaloWebhookService } from './application/zalo-webhook-service.js';
import { config } from './config.js';
import { openDatabase } from './infrastructure/database.js';
import { KfcStore } from './infrastructure/store.js';
import { createZaloClient } from './infrastructure/zalo/zalo-client.js';
import { createApiRouter } from './routes/api.js';
import { createZaloRouter } from './routes/zalo.js';

export function createApplication(overrides = {}) {
  const runtimeConfig = { ...config, ...overrides };
  const { db, menuCount } = openDatabase({
    databasePath: runtimeConfig.databasePath,
    menuPath: runtimeConfig.menuPath,
  });
  const store = new KfcStore(db);
  const chatService = new ChatService({ store, model: runtimeConfig.model });
  const zaloConfigured = Boolean(
    runtimeConfig.zaloBotToken
    && runtimeConfig.zaloWebhookSecret.length >= 8
    && runtimeConfig.zaloWebhookSecret.length <= 256
  );
  const zaloClient = createZaloClient({ botToken: runtimeConfig.zaloBotToken });
  const zaloWebhookService = new ZaloWebhookService({
    store,
    chatService,
    zaloClient,
  });
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));
  app.use(express.static(runtimeConfig.dashboardPath));
  app.use(createZaloRouter({
    webhookSecret: runtimeConfig.zaloWebhookSecret,
    configured: zaloConfigured,
    webhookService: zaloWebhookService,
    logger: console,
  }));
  app.use(createApiRouter({
    store,
    chatService,
    model: runtimeConfig.model,
    menuCount,
    zaloConfigured,
    zaloClient,
  }));
  app.get('/', (_req, res) => res.redirect('/dashboard'));
  app.get('/dashboard', (_req, res) => {
    res.sendFile(path.join(runtimeConfig.dashboardPath, 'index.html'));
  });
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Lỗi máy chủ.',
      },
    });
  });

  return {
    app,
    db,
    store,
    chatService,
    zaloClient,
    zaloWebhookService,
    config: runtimeConfig,
    menuCount,
    zaloConfigured,
  };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const application = createApplication();
  application.app.listen(application.config.port, () => {
    console.log(`KFC demo đang chạy: http://localhost:${application.config.port}`);
    console.log(`Dashboard: http://localhost:${application.config.port}/dashboard`);
    console.log(`Chat SSE: POST http://localhost:${application.config.port}/api/chat`);
    console.log(`Zalo webhook: POST http://localhost:${application.config.port}/api/zalo/webhook (${application.zaloConfigured ? 'configured' : 'not configured'})`);
    console.log(`Menu snapshot: ${application.menuCount} món | Model: ${application.config.model}`);
  });
}
