import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/infrastructure/database.js';
import { KfcStore, DomainError } from '../src/infrastructure/store.js';
import { ChatService, HandoffMutedError } from '../src/application/chat-service.js';

function createTestStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kfc-handoff-test-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const menuPath = path.resolve('kfc_menu.json');
  const { db, menuCount } = openDatabase({ databasePath, menuPath });
  return {
    db,
    menuCount,
    databasePath,
    directory,
    store: new KfcStore(db),
    cleanup() {
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function activityEventsOfType(fixture, sessionId, type) {
  return fixture.db.prepare(
    'SELECT * FROM activity_events WHERE session_id = ? AND type = ? ORDER BY id',
  ).all(sessionId, type);
}

test('a newly created session defaults to control_mode bot', () => {
  const fixture = createTestStore();
  try {
    const session = fixture.store.ensureSession('handoff-default', 'user-test');
    assert.equal(session.controlMode, 'bot');
    assert.equal(fixture.store.getControlMode('handoff-default'), 'bot');
  } finally {
    fixture.cleanup();
  }
});

test('setControlMode is idempotent: repeated same-mode call does not duplicate activity events', () => {
  const fixture = createTestStore();
  try {
    fixture.store.ensureSession('handoff-idempotent', 'user-test');
    const first = fixture.store.setControlMode('handoff-idempotent', 'human');
    assert.deepEqual(first, { changed: true, controlMode: 'human' });

    const second = fixture.store.setControlMode('handoff-idempotent', 'human');
    assert.deepEqual(second, { changed: false, controlMode: 'human' });

    const events = activityEventsOfType(fixture, 'handoff-idempotent', 'handoff_taken_over');
    assert.equal(events.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test('setControlMode transitions bot -> human -> bot, logging exactly one event per real transition', () => {
  const fixture = createTestStore();
  try {
    fixture.store.ensureSession('handoff-transitions', 'user-test');

    const toHuman = fixture.store.setControlMode('handoff-transitions', 'human');
    assert.deepEqual(toHuman, { changed: true, controlMode: 'human' });
    assert.equal(
      activityEventsOfType(fixture, 'handoff-transitions', 'handoff_taken_over').length,
      1,
    );

    const backToBot = fixture.store.setControlMode('handoff-transitions', 'bot');
    assert.deepEqual(backToBot, { changed: true, controlMode: 'bot' });
    assert.equal(
      activityEventsOfType(fixture, 'handoff-transitions', 'handoff_returned').length,
      1,
    );
    // The take-over event count should still be exactly 1 (not re-logged).
    assert.equal(
      activityEventsOfType(fixture, 'handoff-transitions', 'handoff_taken_over').length,
      1,
    );

    assert.equal(fixture.store.getControlMode('handoff-transitions'), 'bot');
  } finally {
    fixture.cleanup();
  }
});

test('setControlMode throws DomainError for an invalid mode string', () => {
  const fixture = createTestStore();
  try {
    fixture.store.ensureSession('handoff-invalid-mode', 'user-test');
    assert.throws(
      () => fixture.store.setControlMode('handoff-invalid-mode', 'robot'),
      (error) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'INVALID_CONTROL_MODE');
        return true;
      },
    );
  } finally {
    fixture.cleanup();
  }
});

test('setControlMode throws DomainError SESSION_NOT_FOUND for a missing session', () => {
  const fixture = createTestStore();
  try {
    assert.throws(
      () => fixture.store.setControlMode('session-does-not-exist', 'human'),
      (error) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, 'SESSION_NOT_FOUND');
        return true;
      },
    );
  } finally {
    fixture.cleanup();
  }
});

test('addMessage with role human_agent succeeds and logs a distinct activity event', () => {
  const fixture = createTestStore();
  try {
    fixture.store.ensureSession('handoff-human-message', 'user-test');
    assert.doesNotThrow(() => {
      fixture.store.addMessage('handoff-human-message', 'human_agent', 'Xin chào, tôi là nhân viên hỗ trợ.');
    });

    const row = fixture.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? AND role = ?',
    ).get('handoff-human-message', 'human_agent');
    assert.ok(row);
    assert.equal(row.content, 'Xin chào, tôi là nhân viên hỗ trợ.');

    const humanEvents = activityEventsOfType(fixture, 'handoff-human-message', 'human_agent_message');
    assert.equal(humanEvents.length, 1);

    const botEvents = activityEventsOfType(fixture, 'handoff-human-message', 'assistant_message');
    const customerEvents = activityEventsOfType(fixture, 'handoff-human-message', 'customer_message');
    assert.equal(botEvents.length, 0);
    assert.equal(customerEvents.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test('ChatService.chat() throws HandoffMutedError and never reaches the agent when already human-controlled', async () => {
  const calls = [];
  const stubStore = {
    ensureSession(sessionId, userId) {
      calls.push(['ensureSession', sessionId, userId]);
      return { id: sessionId, userId, lastResponseId: null, controlMode: 'human' };
    },
    setZaloChatId(sessionId, chatId) {
      calls.push(['setZaloChatId', sessionId, chatId]);
    },
    addMessage(sessionId, role, content) {
      calls.push(['addMessage', sessionId, role, content]);
    },
    getControlMode(sessionId) {
      calls.push(['getControlMode', sessionId]);
      return 'human';
    },
    saveLastResponseId(sessionId, responseId) {
      calls.push(['saveLastResponseId', sessionId, responseId]);
    },
    recordAgentError(sessionId, message) {
      calls.push(['recordAgentError', sessionId, message]);
    },
    getSession(sessionId) {
      calls.push(['getSession', sessionId]);
      return { id: sessionId };
    },
  };

  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-not-used';
  try {
    const chatService = new ChatService({ store: stubStore, model: 'gpt-test' });
    const events = [];
    const emit = (type, payload) => events.push([type, payload]);

    await assert.rejects(
      () => chatService.chat({
        sessionId: 'handoff-muted-session',
        userId: 'user-test',
        message: 'Xin chào',
        emit,
      }),
      (error) => {
        assert.ok(error instanceof HandoffMutedError);
        return true;
      },
    );

    // The bot must never have saved a response id (proof the agent never ran).
    assert.ok(!calls.some((call) => call[0] === 'saveLastResponseId'));
    // recordAgentError must not fire for a HandoffMutedError (it's not a genuine failure).
    assert.ok(!calls.some((call) => call[0] === 'recordAgentError'));
    // A handoff SSE event should have been emitted instead of a generic error.
    assert.ok(events.some(([type]) => type === 'handoff'));
    assert.ok(!events.some(([type]) => type === 'error'));
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test('re-opening an existing database via openDatabase a second time does not error or create a second backup', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kfc-handoff-reopen-test-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const menuPath = path.resolve('kfc_menu.json');
  try {
    const first = openDatabase({ databasePath, menuPath });
    first.db.close();

    const second = openDatabase({ databasePath, menuPath });
    second.db.close();

    const files = fs.readdirSync(directory);
    const backups = files.filter((name) => name.includes('.backup-'));
    assert.equal(backups.length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('setZaloChatId sets the value and is idempotent when called again with the same chatId', () => {
  const fixture = createTestStore();
  try {
    fixture.store.ensureSession('handoff-zalo-chat-id', 'user-test');
    assert.doesNotThrow(() => fixture.store.setZaloChatId('handoff-zalo-chat-id', 'zalo-chat-123'));
    assert.equal(fixture.store.getSession('handoff-zalo-chat-id').zaloChatId, 'zalo-chat-123');

    assert.doesNotThrow(() => fixture.store.setZaloChatId('handoff-zalo-chat-id', 'zalo-chat-123'));
    assert.equal(fixture.store.getSession('handoff-zalo-chat-id').zaloChatId, 'zalo-chat-123');
  } finally {
    fixture.cleanup();
  }
});
