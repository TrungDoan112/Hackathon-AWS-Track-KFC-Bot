import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/infrastructure/database.js';
import { KfcStore } from '../src/infrastructure/store.js';

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

test('imports 94 menu items and finds Vietnamese aliases without diacritics', () => {
  const fixture = createTestStore();
  try {
    assert.equal(fixture.menuCount, 94);
    fixture.store.ensureSession('menu-test', 'user-test');
    const result = fixture.store.searchMenu('menu-test', 'combo ga ran vui ve', 3);
    assert.equal(result.items[0].itemId, 'kfc-2813');
    assert.equal(result.items[0].price, 159000);
  } finally {
    fixture.cleanup();
  }
});

test('messy order keeps final variants and Pepsi note atomically', () => {
  const fixture = createTestStore();
  try {
    fixture.store.ensureSession('messy-test', 'user-test');
    const cart = fixture.store.updateCart('messy-test', {
      operations: [
        { action: 'set_quantity', productId: 'kfc-2743', quantity: 1, variant: 'cay' },
        { action: 'set_quantity', productId: 'kfc-2743', quantity: 1, variant: 'không cay' },
        { action: 'set_quantity', productId: 'kfc-2770', quantity: 1 },
        { action: 'set_quantity', productId: 'kfc-2782', quantity: 1, note: 'Ít đá' },
      ],
    });
    assert.equal(cart.items.length, 4);
    assert.equal(cart.subtotal, 117000);
    assert.equal(cart.items.find((item) => item.productId === 'kfc-2782').note, 'Ít đá');
    assert.deepEqual(
      cart.items.filter((item) => item.productId === 'kfc-2743').map((item) => item.variant).sort(),
      ['cay', 'không cay'],
    );
  } finally {
    fixture.cleanup();
  }
});

test('loyalty and voucher are deterministic and voucher is idempotent', () => {
  const fixture = createTestStore();
  try {
    fixture.store.ensureSession('integration-test', 'user-test');
    fixture.store.updateCart('integration-test', {
      operations: [
        { action: 'set_quantity', productId: 'kfc-2813', quantity: 1 },
      ],
    });
    const loyalty = fixture.store.checkLoyalty('integration-test', '0901234567');
    assert.equal(loyalty.points, 150);
    const first = fixture.store.applyVoucher('integration-test', 'KFC50K', '0901234567');
    const second = fixture.store.applyVoucher('integration-test', 'KFC50K', '0901234567');
    assert.equal(first.success, true);
    assert.equal(first.discount, 50000);
    assert.equal(second.discount, 50000);
    assert.equal(fixture.store.getCart('integration-test').total, 109000);
  } finally {
    fixture.cleanup();
  }
});

test('KFC10 through KFC100 apply the matching percentage to the cart', () => {
  const fixture = createTestStore();
  try {
    fixture.store.ensureSession('percentage-voucher-test', 'user-test');
    fixture.store.updateCart('percentage-voucher-test', {
      operations: [
        { action: 'set_quantity', productId: 'kfc-2813', quantity: 1 },
      ],
    });

    for (let percentage = 10; percentage <= 100; percentage += 10) {
      const result = fixture.store.applyVoucher('percentage-voucher-test', `kfc${percentage}`);
      assert.equal(result.success, true);
      assert.equal(result.code, `KFC${percentage}`);
      assert.equal(result.subtotal, 159000);
      assert.equal(result.discount, Math.round(159000 * percentage / 100));
      assert.equal(result.total, 159000 - result.discount);
    }

    const cart = fixture.store.getCart('percentage-voucher-test');
    assert.equal(cart.voucherCode, 'KFC100');
    assert.equal(cart.discount, 159000);
    assert.equal(cart.total, 0);
  } finally {
    fixture.cleanup();
  }
});

test('create order is idempotent and persists the backend-calculated total', () => {
  const fixture = createTestStore();
  try {
    fixture.store.ensureSession('order-test', 'user-test');
    fixture.store.updateCart('order-test', {
      operations: [
        { action: 'set_quantity', productId: 'kfc-2813', quantity: 1 },
      ],
      address: '123 Nguyễn Văn Linh',
    });
    const first = fixture.store.createOrder('order-test', 'user-test');
    const second = fixture.store.createOrder('order-test', 'user-test');
    assert.equal(first.success, true);
    assert.equal(first.alreadyExisted, false);
    assert.equal(first.order.total, 159000);
    assert.equal(second.alreadyExisted, true);
    assert.equal(second.order.id, first.order.id);
    assert.equal(fixture.store.dashboardSnapshot('order-test').orders.length, 1);
  } finally {
    fixture.cleanup();
  }
});
