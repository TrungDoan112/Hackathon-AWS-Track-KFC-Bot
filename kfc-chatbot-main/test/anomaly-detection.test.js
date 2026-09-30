import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/infrastructure/database.js';
import { KfcStore } from '../src/infrastructure/store.js';

// Phase 1: anomaly detection (oversized cart, bot stuck, sensitive keyword).
// See plans/staff-alerts-cart-edit/phase-01-anomaly-detection.md and spec.md.
//
// These tests are written before the feature is implemented (TDD red phase).
// They are expected to FAIL until store.js inserts `activity_events` rows of
// type `anomaly_oversized_cart`, `anomaly_bot_stuck`, and
// `anomaly_sensitive_keyword` from `updateCart` / `addMessage`.

function createTestStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kfc-demo-test-'));
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

function anomalyRows(db, sessionId, type) {
  return db.prepare(
    'SELECT * FROM activity_events WHERE session_id = ? AND type = ?',
  ).all(sessionId, type);
}

// --- Oversized cart (FR-01) -------------------------------------------------

test('cart exceeding 100 total items inserts exactly one anomaly_oversized_cart event', () => {
  const fixture = createTestStore();
  try {
    const sessionId = 'anomaly-cart-qty-test';
    fixture.store.ensureSession(sessionId, 'user-test');
    // Two lines needed since a single line is capped at 100 (MAX_QUANTITY_PER_LINE).
    // kfc-2775 "Cơm trắng" (12,000₫) + kfc-2768 "Bắp Cải Trộn" (13,000₫), 105 total items.
    fixture.store.updateCart(sessionId, {
      operations: [
        { action: 'set_quantity', productId: 'kfc-2775', quantity: 60 },
        { action: 'set_quantity', productId: 'kfc-2768', quantity: 45 },
      ],
    });
    const rows = anomalyRows(fixture.db, sessionId, 'anomaly_oversized_cart');
    assert.equal(rows.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test('cart staying over the item threshold on a later update does not duplicate the anomaly event', () => {
  const fixture = createTestStore();
  try {
    const sessionId = 'anomaly-cart-qty-dedup-test';
    fixture.store.ensureSession(sessionId, 'user-test');
    fixture.store.updateCart(sessionId, {
      operations: [
        { action: 'set_quantity', productId: 'kfc-2775', quantity: 60 },
        { action: 'set_quantity', productId: 'kfc-2768', quantity: 45 },
      ],
    });
    // Still over threshold on the next update — must not insert a second row.
    fixture.store.updateCart(sessionId, {
      operations: [{ action: 'set_quantity', productId: 'kfc-2775', quantity: 70 }],
    });
    const rows = anomalyRows(fixture.db, sessionId, 'anomaly_oversized_cart');
    assert.equal(rows.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test('cart at or under 100 items and under 1,000,000₫ inserts no oversized-cart anomaly', () => {
  const fixture = createTestStore();
  try {
    const sessionId = 'anomaly-cart-ok-test';
    fixture.store.ensureSession(sessionId, 'user-test');
    // 80 units of a 12,000₫ item: 80 items, 960,000₫ — under both thresholds.
    fixture.store.updateCart(sessionId, {
      operations: [{ action: 'set_quantity', productId: 'kfc-2775', quantity: 80 }],
    });
    const rows = anomalyRows(fixture.db, sessionId, 'anomaly_oversized_cart');
    assert.equal(rows.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test('cart under 100 items but exceeding 1,000,000₫ inserts one anomaly_oversized_cart event', () => {
  const fixture = createTestStore();
  try {
    const sessionId = 'anomaly-cart-price-test';
    fixture.store.ensureSession(sessionId, 'user-test');
    // kfc-2950 "Combo Cùng \"Dzô\"" is 369,000₫ — 3 units = 1,107,000₫, only 3 total items.
    fixture.store.updateCart(sessionId, {
      operations: [{ action: 'set_quantity', productId: 'kfc-2950', quantity: 3 }],
    });
    const cart = fixture.store.getCart(sessionId, { create: false });
    assert.ok(cart.total > 1000000, `expected cart total above 1,000,000, got ${cart.total}`);
    const rows = anomalyRows(fixture.db, sessionId, 'anomaly_oversized_cart');
    assert.equal(rows.length, 1);
  } finally {
    fixture.cleanup();
  }
});

// --- Bot stuck (FR-02) ------------------------------------------------------

test('two consecutive identical assistant replies insert one anomaly_bot_stuck event', () => {
  const fixture = createTestStore();
  try {
    const sessionId = 'anomaly-bot-stuck-test';
    fixture.store.ensureSession(sessionId, 'user-test');
    const reply = 'Xin lỗi, bạn có thể nói lại được không ạ?';
    fixture.store.addMessage(sessionId, 'assistant', reply);
    fixture.store.addMessage(sessionId, 'assistant', reply);
    const rows = anomalyRows(fixture.db, sessionId, 'anomaly_bot_stuck');
    assert.equal(rows.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test('two consecutive different assistant replies insert no anomaly_bot_stuck event', () => {
  const fixture = createTestStore();
  try {
    const sessionId = 'anomaly-bot-not-stuck-test';
    fixture.store.ensureSession(sessionId, 'user-test');
    fixture.store.addMessage(sessionId, 'assistant', 'Dạ, quý khách muốn đặt món gì ạ?');
    fixture.store.addMessage(sessionId, 'assistant', 'Bên em đang có combo Gà Rán Vui Vẻ ạ.');
    const rows = anomalyRows(fixture.db, sessionId, 'anomaly_bot_stuck');
    assert.equal(rows.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test('a third consecutive identical assistant reply does not duplicate the unresolved anomaly', () => {
  const fixture = createTestStore();
  try {
    const sessionId = 'anomaly-bot-stuck-dedup-test';
    fixture.store.ensureSession(sessionId, 'user-test');
    const reply = 'Xin lỗi, bạn có thể nói lại được không ạ?';
    fixture.store.addMessage(sessionId, 'assistant', reply);
    fixture.store.addMessage(sessionId, 'assistant', reply);
    fixture.store.addMessage(sessionId, 'assistant', reply);
    const rows = anomalyRows(fixture.db, sessionId, 'anomaly_bot_stuck');
    assert.equal(rows.length, 1);
  } finally {
    fixture.cleanup();
  }
});

// --- Sensitive keyword (FR-03) ----------------------------------------------

test('a user message containing a VI sensitive keyword inserts one anomaly_sensitive_keyword event', () => {
  const fixture = createTestStore();
  try {
    const sessionId = 'anomaly-keyword-vi-test';
    fixture.store.ensureSession(sessionId, 'user-test');
    fixture.store.addMessage(sessionId, 'user', 'Tôi muốn khiếu nại về đơn hàng vừa rồi.');
    const rows = anomalyRows(fixture.db, sessionId, 'anomaly_sensitive_keyword');
    assert.equal(rows.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test('a user message containing an EN sensitive keyword inserts one anomaly_sensitive_keyword event', () => {
  const fixture = createTestStore();
  try {
    const sessionId = 'anomaly-keyword-en-test';
    fixture.store.ensureSession(sessionId, 'user-test');
    fixture.store.addMessage(sessionId, 'user', 'I want a refund for my order please.');
    const rows = anomalyRows(fixture.db, sessionId, 'anomaly_sensitive_keyword');
    assert.equal(rows.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test('a user message with no sensitive keyword inserts no anomaly_sensitive_keyword event', () => {
  const fixture = createTestStore();
  try {
    const sessionId = 'anomaly-keyword-none-test';
    fixture.store.ensureSession(sessionId, 'user-test');
    fixture.store.addMessage(sessionId, 'user', 'Cho tôi một combo gà rán vui vẻ nhé.');
    const rows = anomalyRows(fixture.db, sessionId, 'anomaly_sensitive_keyword');
    assert.equal(rows.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test('a keyword matching only as a normalized substring of a menu item name does not trigger the anomaly', () => {
  const fixture = createTestStore();
  try {
    const sessionId = 'anomaly-keyword-substring-test';
    fixture.store.ensureSession(sessionId, 'user-test');
    // "bẩn" normalizes to "ban", which is a raw substring of "1 Bánh Trứng" -> "1 banh trung"
    // (real menu item kfc-2780) but is NOT a whole token there ("banh" != "ban").
    // A correct whole-token/phrase matcher must not flag this message.
    fixture.store.addMessage(sessionId, 'user', 'Cho tôi 1 Bánh Trứng nhé.');
    const rows = anomalyRows(fixture.db, sessionId, 'anomaly_sensitive_keyword');
    assert.equal(rows.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test('repeated messages with the same sensitive keyword do not duplicate the unresolved anomaly', () => {
  const fixture = createTestStore();
  try {
    const sessionId = 'anomaly-keyword-dedup-test';
    fixture.store.ensureSession(sessionId, 'user-test');
    fixture.store.addMessage(sessionId, 'user', 'Tôi muốn khiếu nại về đơn hàng vừa rồi.');
    fixture.store.addMessage(sessionId, 'user', 'Tôi sẽ khiếu nại nếu không được giải quyết.');
    const rows = anomalyRows(fixture.db, sessionId, 'anomaly_sensitive_keyword');
    assert.equal(rows.length, 1);
  } finally {
    fixture.cleanup();
  }
});

// --- Dashboard badge (Phase 2, FR-05) ---------------------------------------

test('dashboardSnapshot flags a session with an anomaly event and leaves clean sessions unflagged', () => {
  const fixture = createTestStore();
  try {
    const flaggedId = 'anomaly-badge-flagged-test';
    const cleanId = 'anomaly-badge-clean-test';
    fixture.store.ensureSession(flaggedId, 'user-test');
    fixture.store.ensureSession(cleanId, 'user-test');
    fixture.store.addMessage(flaggedId, 'user', 'Tôi muốn khiếu nại về đơn hàng vừa rồi.');

    const snapshot = fixture.store.dashboardSnapshot(cleanId);
    const flagged = snapshot.sessions.find((session) => session.id === flaggedId);
    const clean = snapshot.sessions.find((session) => session.id === cleanId);
    assert.equal(flagged.hasAnomaly, true);
    assert.equal(clean.hasAnomaly, false);
  } finally {
    fixture.cleanup();
  }
});

test('dashboardSnapshot flags a session with multiple anomaly types just once each in the sessions array', () => {
  const fixture = createTestStore();
  try {
    const sessionId = 'anomaly-badge-multi-test';
    fixture.store.ensureSession(sessionId, 'user-test');
    fixture.store.addMessage(sessionId, 'user', 'Tôi muốn khiếu nại về đơn hàng vừa rồi.');
    fixture.store.updateCart(sessionId, {
      operations: [{ action: 'set_quantity', productId: 'kfc-2950', quantity: 3 }],
    });

    const snapshot = fixture.store.dashboardSnapshot(sessionId);
    const entries = snapshot.sessions.filter((session) => session.id === sessionId);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].hasAnomaly, true);
  } finally {
    fixture.cleanup();
  }
});
