import 'dotenv/config';
import { config } from '../src/config.js';
import { createZaloClient } from '../src/infrastructure/zalo/zalo-client.js';

const action = String(process.argv[2] || 'info').toLowerCase();
const client = createZaloClient({ botToken: config.zaloBotToken });

if (action === 'me') {
  const bot = await client.getMe();
  console.log(JSON.stringify(bot, null, 2));
} else if (action === 'info') {
  const info = await client.getWebhookInfo();
  console.log(JSON.stringify(info, null, 2));
} else if (action === 'set') {
  const publicBaseUrl = String(process.argv[3] || config.publicBaseUrl || '').trim();
  if (!publicBaseUrl) {
    throw new Error('Thiếu PUBLIC_BASE_URL hoặc URL HTTPS ở đối số lệnh.');
  }
  const base = publicBaseUrl.endsWith('/') ? publicBaseUrl : `${publicBaseUrl}/`;
  const webhookUrl = new URL('/api/zalo/webhook', base).toString();
  const result = await client.setWebhook(webhookUrl, config.zaloWebhookSecret);
  console.log(JSON.stringify(result, null, 2));
} else {
  throw new Error(`Lệnh không hỗ trợ: ${action}. Chỉ dùng me, set hoặc info.`);
}
