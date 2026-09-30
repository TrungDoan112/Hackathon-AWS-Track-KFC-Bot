import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { parseZaloTextEvent, ZaloWebhookService } from '../src/application/zalo-webhook-service.js';
import { openDatabase } from '../src/infrastructure/database.js';
import { KfcStore } from '../src/infrastructure/store.js';
import { createZaloClient, splitZaloMessage } from '../src/infrastructure/zalo/zalo-client.js';
import { createZaloRouter, safeSecretEquals } from '../src/routes/zalo.js';
import { createApplication } from '../src/server.js';

function webhookPayload({
  messageId = 'message-1',
  chatId = 'chat-123',
  fromId = 'user-456',
  text = 'Xin chào',
  eventName = 'message.text.received',
  isBot = false,
} = {}) {
  return {
    ok: true,
    result: {
      event_name: eventName,
      message: {
        from: { id: fromId, display_name: 'Khách', is_bot: isBot },
        chat: { id: chatId, chat_type: 'PRIVATE' },
        text,
        message_id: messageId,
        date: 1750316131602,
      },
    },
  };
}

function createTestStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kfc-zalo-test-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const { db } = openDatabase({
    databasePath,
    menuPath: path.resolve('kfc_menu.json'),
  });
  return {
    store: new KfcStore(db),
    cleanup() {
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('parses text events, uses chat.id for replies and ignores unsupported/bot events', () => {
  const parsed = parseZaloTextEvent(webhookPayload());
  assert.equal(parsed.supported, true);
  assert.equal(parsed.externalId, 'message-1');
  assert.equal(parsed.chatId, 'chat-123');
  assert.notEqual(parsed.chatId, 'user-456');
  assert.match(parsed.sessionId, /^zalo_chat_[a-f0-9]{24}$/);
  assert.match(parsed.userId, /^zalo_user_[a-f0-9]{24}$/);

  assert.equal(parseZaloTextEvent(webhookPayload({
    eventName: 'message.image.received',
  })).supported, false);
  assert.equal(parseZaloTextEvent(webhookPayload({ isBot: true })).supported, false);
  assert.equal(parseZaloTextEvent(webhookPayload({ text: '   ' })).supported, false);
});

test('parses the top-level Zalo webhook payload shape', () => {
  const parsed = parseZaloTextEvent({
    event_name: 'message.text.received',
    message: {
      date: 1783780885751,
      chat: { chat_type: 'PRIVATE', id: '0f6ce0f457bcbee2e7ad' },
      message_id: '617963c426c4819dd8d2',
      from: {
        id: '0f6ce0f457bcbee2e7ad',
        is_bot: false,
        display_name: 'Đồng Trần',
      },
      text: 'Xin',
    },
  });

  assert.equal(parsed.supported, true);
  assert.equal(parsed.externalId, '617963c426c4819dd8d2');
  assert.equal(parsed.chatId, '0f6ce0f457bcbee2e7ad');
  assert.equal(parsed.text, 'Xin');
});

test('splits long Zalo messages and sends the documented request shapes', async () => {
  const chunks = splitZaloMessage(`${'a'.repeat(1990)} ${'b'.repeat(50)}`);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length >= 1 && chunk.length <= 2000));
  assert.throws(() => splitZaloMessage('abc', 0), RangeError);
  const emojiChunks = splitZaloMessage(`a${'😀'.repeat(1001)}`, 2000);
  assert.ok(emojiChunks.every((chunk) => !chunk.includes('\uFFFD')));
  assert.ok(emojiChunks.every((chunk) => {
    const last = chunk.charCodeAt(chunk.length - 1);
    return !(last >= 0xD800 && last <= 0xDBFF);
  }));

  const calls = [];
  const client = createZaloClient({
    botToken: 'test-token',
    retryDelayMs: 0,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      const method = url.split('/').at(-1);
      return {
        ok: true,
        status: 200,
        async json() {
          if (method === 'sendChatAction') return { ok: true };
          if (method === 'sendMessage') return { ok: true, result: { message_id: 'reply-1' } };
          return { ok: true, result: { url: 'https://example.com/api/zalo/webhook' } };
        },
      };
    },
  });

  await client.setWebhook('https://example.com/api/zalo/webhook', 'secret-123');
  await client.sendTyping('chat-123');
  await client.sendMessage('chat-123', 'Chào bạn');
  await client.getMe();

  assert.match(calls[0].url, /bottest-token\/setWebhook$/);
  assert.deepEqual(calls[0].body, {
    url: 'https://example.com/api/zalo/webhook',
    secret_token: 'secret-123',
  });
  assert.deepEqual(calls[1].body, { chat_id: 'chat-123', action: 'typing' });
  assert.deepEqual(calls[2].body, { chat_id: 'chat-123', text: 'Chào bạn' });
  assert.match(calls[3].url, /bottest-token\/getMe$/);
  assert.throws(
    () => client.setWebhook('http://example.com/hook', 'secret-123'),
    { code: 'INVALID_WEBHOOK_URL' },
  );
});

test('retries transient Zalo API errors once', async () => {
  let attempts = 0;
  const client = createZaloClient({
    botToken: 'test-token',
    retryDelayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          async json() {
            return { ok: false, error_code: 429, description: 'Too many requests' };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, result: { message_id: 'reply-2' } };
        },
      };
    },
  });

  const result = await client.sendMessage('chat-123', 'Thử lại');
  assert.equal(attempts, 2);
  assert.equal(result[0].message_id, 'reply-2');
});

test('webhook route rejects bad secrets and acknowledges valid events', async (t) => {
  const accepted = [];
  const app = express();
  app.use(express.json());
  app.use(createZaloRouter({
    webhookSecret: 'secret-123',
    configured: true,
    webhookService: {
      accept(payload) {
        accepted.push(payload);
        return { accepted: true, queued: true, sessionId: 'zalo_chat_test' };
      },
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/zalo/webhook`;

  const bad = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'wrong' },
    body: JSON.stringify(webhookPayload()),
  });
  assert.equal(bad.status, 403);
  assert.equal(accepted.length, 0);

  const good = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-api-secret-token': 'secret-123' },
    body: JSON.stringify(webhookPayload()),
  });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).queued, true);
  assert.equal(accepted.length, 1);
  assert.equal(safeSecretEquals('secret-123', 'secret-123'), true);
  assert.equal(safeSecretEquals('secret-124', 'secret-123'), false);
});

test('webhook acknowledgement does not wait for the agent reply', async (t) => {
  const fixture = createTestStore();
  let finishAgent;
  let agentFinished = false;
  const agentGate = new Promise((resolve) => {
    finishAgent = resolve;
  });
  const service = new ZaloWebhookService({
    store: fixture.store,
    logger: { warn() {}, error() {} },
    chatService: {
      async chat() {
        await agentGate;
        agentFinished = true;
        return 'Đã xong';
      },
    },
    zaloClient: {
      async sendTyping() {},
      async sendMessage() {
        return [{ message_id: 'reply-async' }];
      },
    },
  });
  const app = express();
  app.use(express.json());
  app.use(createZaloRouter({
    webhookSecret: 'secret-123',
    configured: true,
    webhookService: service,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    finishAgent();
    await service.waitForIdle();
    await new Promise((resolve) => server.close(resolve));
    fixture.cleanup();
  });
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/zalo/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'secret-123' },
    body: JSON.stringify(webhookPayload({ messageId: 'event-async' })),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).queued, true);
  assert.equal(agentFinished, false);

  finishAgent();
  await service.waitForIdle();
  assert.equal(agentFinished, true);
});

test('deduplicates stored webhook events and processes one chat in order', async () => {
  const fixture = createTestStore();
  const order = [];
  const sent = [];
  let replyIndex = 0;
  const service = new ZaloWebhookService({
    store: fixture.store,
    logger: { warn() {}, error() {} },
    chatService: {
      async chat({ message }) {
        order.push(`start:${message}`);
        await new Promise((resolve) => setTimeout(resolve, message === 'Một' ? 15 : 1));
        order.push(`end:${message}`);
        return `Trả lời ${message}`;
      },
    },
    zaloClient: {
      async sendTyping(chatId) {
        sent.push({ type: 'typing', chatId });
        return { ok: true };
      },
      async sendMessage(chatId, text) {
        replyIndex += 1;
        sent.push({ type: 'message', chatId, text });
        return [{ message_id: `reply-${replyIndex}` }];
      },
    },
  });

  try {
    const first = service.accept(webhookPayload({ messageId: 'event-1', text: 'Một' }));
    const duplicate = service.accept(webhookPayload({ messageId: 'event-1', text: 'Một' }));
    const second = service.accept(webhookPayload({ messageId: 'event-2', text: 'Hai' }));
    assert.equal(first.queued, true);
    assert.equal(duplicate.duplicate, true);
    assert.equal(second.queued, true);

    await service.waitForIdle();
    assert.deepEqual(order, ['start:Một', 'end:Một', 'start:Hai', 'end:Hai']);
    assert.equal(sent.filter((entry) => entry.type === 'message').length, 2);
    assert.ok(sent.every((entry) => entry.chatId === 'chat-123'));
    assert.equal(fixture.store.getWebhookEvent('zalo', 'event-1').status, 'completed');
    assert.deepEqual(fixture.store.getWebhookEvent('zalo', 'event-1').replyIds, ['reply-1']);
    assert.equal(fixture.store.getWebhookEvent('zalo', 'event-2').status, 'completed');
  } finally {
    fixture.cleanup();
  }
});

test('records failed webhook processing and sends a safe fallback reply', async () => {
  const fixture = createTestStore();
  const replies = [];
  const service = new ZaloWebhookService({
    store: fixture.store,
    logger: { warn() {}, error() {} },
    chatService: {
      async chat() {
        throw new Error('private failure details');
      },
    },
    zaloClient: {
      async sendTyping() {},
      async sendMessage(_chatId, text) {
        replies.push(text);
        return [{ message_id: 'fallback-1' }];
      },
    },
  });

  try {
    service.accept(webhookPayload({ messageId: 'event-failed' }));
    await service.waitForIdle();
    const event = fixture.store.getWebhookEvent('zalo', 'event-failed');
    assert.equal(event.status, 'failed');
    assert.match(event.error, /private failure details/);
    assert.equal(replies.length, 1);
    assert.doesNotMatch(replies[0], /private failure details/);
  } finally {
    fixture.cleanup();
  }
});

test('main application exposes Zalo status and health without leaking secrets', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kfc-zalo-app-test-'));
  const application = createApplication({
    databasePath: path.join(directory, 'test.sqlite'),
    menuPath: path.resolve('kfc_menu.json'),
    zaloBotToken: 'test-token',
    zaloWebhookSecret: 'secret-123',
  });
  const server = application.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    application.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  const health = await (await fetch(`${origin}/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.zaloConfigured, true);

  const status = await (await fetch(`${origin}/api/zalo/status`)).json();
  assert.deepEqual(status, {
    configured: true,
    webhookPath: '/api/zalo/webhook',
  });
  assert.doesNotMatch(JSON.stringify(status), /test-token|secret-123/);

  const ignored = await fetch(`${origin}/api/zalo/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': 'secret-123' },
    body: JSON.stringify(webhookPayload({ eventName: 'message.image.received' })),
  });
  assert.equal(ignored.status, 200);
  assert.equal((await ignored.json()).ignored, true);
});
