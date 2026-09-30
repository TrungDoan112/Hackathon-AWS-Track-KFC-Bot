import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { openDatabase } from '../src/infrastructure/database.js';
import { KfcStore } from '../src/infrastructure/store.js';
import { createApiRouter } from '../src/routes/api.js';

function createTestStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kfc-handoff-routes-test-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const menuPath = path.resolve('kfc_menu.json');
  const { db, menuCount } = openDatabase({ databasePath, menuPath });
  return {
    db,
    menuCount,
    store: new KfcStore(db),
    cleanup() {
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

const noopChatService = {
  isBusy() {
    return false;
  },
  async chat() {},
};

async function startServer(t, { store, zaloClient, logger } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createApiRouter({
    store,
    chatService: noopChatService,
    model: 'gpt-test',
    menuCount: 0,
    zaloConfigured: true,
    zaloClient: zaloClient || { async sendMessage() { return [{ message_id: 'ok' }]; } },
    logger: logger || { error() {}, warn() {} },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test('take-over on a missing session returns 404 SESSION_NOT_FOUND', async (t) => {
  const fixture = createTestStore();
  t.after(fixture.cleanup);
  const origin = await startServer(t, { store: fixture.store });

  const response = await fetch(`${origin}/api/sessions/does-not-exist/take-over`, { method: 'POST' });
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, 'SESSION_NOT_FOUND');
});

test('take-over sets control_mode to human and is idempotent on repeat calls', async (t) => {
  const fixture = createTestStore();
  t.after(fixture.cleanup);
  fixture.store.ensureSession('take-over-session', 'user-test');
  const origin = await startServer(t, { store: fixture.store });

  const first = await fetch(`${origin}/api/sessions/take-over-session/take-over`, { method: 'POST' });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.controlMode, 'human');
  assert.equal(firstBody.changed, true);
  assert.equal(fixture.store.getSession('take-over-session').controlMode, 'human');

  const second = await fetch(`${origin}/api/sessions/take-over-session/take-over`, { method: 'POST' });
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.controlMode, 'human');
  assert.equal(secondBody.changed, false);
});

test('hand-back on a missing session returns 404 SESSION_NOT_FOUND', async (t) => {
  const fixture = createTestStore();
  t.after(fixture.cleanup);
  const origin = await startServer(t, { store: fixture.store });

  const response = await fetch(`${origin}/api/sessions/does-not-exist/hand-back`, { method: 'POST' });
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, 'SESSION_NOT_FOUND');
});

test('hand-back sets control_mode back to bot and is idempotent on repeat calls', async (t) => {
  const fixture = createTestStore();
  t.after(fixture.cleanup);
  fixture.store.ensureSession('hand-back-session', 'user-test');
  fixture.store.setControlMode('hand-back-session', 'human');
  const origin = await startServer(t, { store: fixture.store });

  const first = await fetch(`${origin}/api/sessions/hand-back-session/hand-back`, { method: 'POST' });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.controlMode, 'bot');
  assert.equal(firstBody.changed, true);
  assert.equal(fixture.store.getSession('hand-back-session').controlMode, 'bot');

  const second = await fetch(`${origin}/api/sessions/hand-back-session/hand-back`, { method: 'POST' });
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.controlMode, 'bot');
  assert.equal(secondBody.changed, false);
});

test('human-message rejects an empty message with 400 INVALID_REQUEST', async (t) => {
  const fixture = createTestStore();
  t.after(fixture.cleanup);
  fixture.store.ensureSession('human-message-empty', 'user-test');
  const origin = await startServer(t, { store: fixture.store });

  const response = await fetch(`${origin}/api/sessions/human-message-empty/human-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '' }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, 'INVALID_REQUEST');
});

test('human-message rejects a message over 4000 chars with 400 INVALID_REQUEST', async (t) => {
  const fixture = createTestStore();
  t.after(fixture.cleanup);
  fixture.store.ensureSession('human-message-too-long', 'user-test');
  const origin = await startServer(t, { store: fixture.store });

  const response = await fetch(`${origin}/api/sessions/human-message-too-long/human-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'a'.repeat(4001) }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, 'INVALID_REQUEST');
});

test('human-message returns 409 SESSION_NOT_HUMAN_CONTROLLED when session is still bot-controlled', async (t) => {
  const fixture = createTestStore();
  t.after(fixture.cleanup);
  fixture.store.ensureSession('human-message-still-bot', 'user-test');
  const origin = await startServer(t, { store: fixture.store });

  const response = await fetch(`${origin}/api/sessions/human-message-still-bot/human-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Xin chào' }),
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error.code, 'SESSION_NOT_HUMAN_CONTROLLED');
});

test('human-message returns 409 NO_ZALO_CHAT_ID after take-over when session has no zalo_chat_id', async (t) => {
  const fixture = createTestStore();
  t.after(fixture.cleanup);
  fixture.store.ensureSession('human-message-no-zalo', 'user-test');
  fixture.store.setControlMode('human-message-no-zalo', 'human');
  const origin = await startServer(t, { store: fixture.store });

  const response = await fetch(`${origin}/api/sessions/human-message-no-zalo/human-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Xin chào' }),
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error.code, 'NO_ZALO_CHAT_ID');
});

test('human-message with take-over and zalo_chat_id sends via zaloClient, stores a human_agent message, and returns sent:true', async (t) => {
  const fixture = createTestStore();
  t.after(fixture.cleanup);
  fixture.store.ensureSession('human-message-success', 'user-test');
  fixture.store.setControlMode('human-message-success', 'human');
  fixture.store.setZaloChatId('human-message-success', 'zalo-chat-999');

  const sendCalls = [];
  const zaloClient = {
    async sendMessage(chatId, text) {
      sendCalls.push({ chatId, text });
      return [{ message_id: 'reply-1' }];
    },
  };
  const origin = await startServer(t, { store: fixture.store, zaloClient });

  const response = await fetch(`${origin}/api/sessions/human-message-success/human-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Chào bạn, mình hỗ trợ bạn nhé' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { sessionId: 'human-message-success', sent: true });

  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].chatId, 'zalo-chat-999');
  assert.equal(sendCalls[0].text, 'Chào bạn, mình hỗ trợ bạn nhé');

  const snapshot = fixture.store.dashboardSnapshot('human-message-success');
  const humanMessages = snapshot.messages.filter((message) => message.role === 'human_agent');
  assert.equal(humanMessages.length, 1);
  assert.equal(humanMessages[0].content, 'Chào bạn, mình hỗ trợ bạn nhé');
});

test('human-message returns sanitized 502 ZALO_SEND_FAILED when zaloClient.sendMessage throws, never leaking the raw error', async (t) => {
  const fixture = createTestStore();
  t.after(fixture.cleanup);
  fixture.store.ensureSession('human-message-zalo-fail', 'user-test');
  fixture.store.setControlMode('human-message-zalo-fail', 'human');
  fixture.store.setZaloChatId('human-message-zalo-fail', 'zalo-chat-000');

  const secretDetail = 'super-secret-upstream-detail-abc123';
  const zaloClient = {
    async sendMessage() {
      const error = new Error(`Zalo upstream failure: ${secretDetail}`);
      error.stack = `Error: ${secretDetail}\n    at somewhere (file.js:1:1)`;
      throw error;
    },
  };
  const loggedErrors = [];
  const logger = { error(...args) { loggedErrors.push(args); }, warn() {} };
  const origin = await startServer(t, { store: fixture.store, zaloClient, logger });

  const response = await fetch(`${origin}/api/sessions/human-message-zalo-fail/human-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Xin chào' }),
  });
  assert.equal(response.status, 502);
  const rawBody = await response.text();
  const body = JSON.parse(rawBody);
  assert.equal(body.error.code, 'ZALO_SEND_FAILED');
  assert.doesNotMatch(rawBody, new RegExp(secretDetail));
  assert.doesNotMatch(rawBody, /at somewhere/);

  // The message must not have been recorded as sent since delivery failed.
  const snapshot = fixture.store.dashboardSnapshot('human-message-zalo-fail');
  assert.equal(snapshot.messages.filter((message) => message.role === 'human_agent').length, 0);
});

test('dashboardSnapshot reflects controlMode human on the sessions array entry and top-level field for a taken-over session', async (t) => {
  const fixture = createTestStore();
  t.after(fixture.cleanup);
  fixture.store.ensureSession('snapshot-control-mode', 'user-test');
  fixture.store.setControlMode('snapshot-control-mode', 'human');

  const snapshot = fixture.store.dashboardSnapshot('snapshot-control-mode');
  assert.equal(snapshot.selectedSessionId, 'snapshot-control-mode');
  assert.equal(snapshot.controlMode, 'human');
  const entry = snapshot.sessions.find((session) => session.id === 'snapshot-control-mode');
  assert.ok(entry);
  assert.equal(entry.controlMode, 'human');
});
