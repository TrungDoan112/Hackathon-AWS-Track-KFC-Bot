import crypto from 'node:crypto';
import { matchesSensitiveKeyword, normalizeText, withTransaction } from './database.js';

const OVERSIZED_CART_ITEM_THRESHOLD = 100;
const OVERSIZED_CART_TOTAL_THRESHOLD = 1000000;
const MAX_QUANTITY_PER_LINE = 100;

const STOP_WORDS = new Set([
  'cho', 'minh', 'anh', 'chi', 'em', 'xem', 'menu', 'hom', 'nay', 'lay', 'mot',
  'phan', 'mon', 'them', 'nhe', 'nha', 'giup', 'voi', 'cua', 'kfc',
]);

function now() {
  return new Date().toISOString();
}

function json(value) {
  return JSON.stringify(value ?? {});
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function cleanPhone(input) {
  let phone = String(input || '').replace(/\D/g, '');
  if (phone.startsWith('84') && phone.length >= 11) phone = `0${phone.slice(2)}`;
  if (phone.length < 9 || phone.length > 12) {
    throw new DomainError('Số điện thoại chưa hợp lệ.', 'INVALID_PHONE', 400);
  }
  return phone;
}

function cleanVariant(input) {
  return String(input || '').trim().toLowerCase();
}

function shortText(input, max = 100) {
  const value = String(input || '').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR', status = 400) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
  }
}

export class KfcStore {
  constructor(db) {
    this.db = db;
  }

  ensureSession(sessionId, userId) {
    const existing = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (existing) {
      if (existing.user_id !== userId) {
        throw new DomainError(
          'sessionId này đã thuộc về một userId khác.',
          'SESSION_USER_MISMATCH',
          409,
        );
      }
      this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now(), sessionId);
      return this.getSession(sessionId);
    }

    const timestamp = now();
    this.db.prepare(`
      INSERT INTO sessions(id, user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, userId, timestamp, timestamp);
    this.addActivity(sessionId, 'session_started', 'Bắt đầu phiên tư vấn mới', { userId });
    return this.getSession(sessionId);
  }

  getSession(sessionId) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      customerPhone: row.customer_phone,
      lastResponseId: row.last_response_id,
      status: row.status,
      controlMode: row.control_mode,
      zaloChatId: row.zalo_chat_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getControlMode(sessionId) {
    const row = this.db.prepare('SELECT control_mode FROM sessions WHERE id = ?').get(sessionId);
    return row?.control_mode || 'bot';
  }

  setControlMode(sessionId, mode) {
    if (mode !== 'bot' && mode !== 'human') {
      throw new DomainError('control_mode phải là "bot" hoặc "human".', 'INVALID_CONTROL_MODE', 400);
    }
    const session = this.db.prepare('SELECT control_mode FROM sessions WHERE id = ?').get(sessionId);
    if (!session) {
      throw new DomainError('Không tìm thấy session.', 'SESSION_NOT_FOUND', 404);
    }
    if (session.control_mode === mode) {
      return { changed: false, controlMode: mode };
    }

    const timestamp = now();
    withTransaction(this.db, () => {
      this.db.prepare('UPDATE sessions SET control_mode = ?, updated_at = ? WHERE id = ?')
        .run(mode, timestamp, sessionId);
      this.insertActivity(
        sessionId,
        mode === 'human' ? 'handoff_taken_over' : 'handoff_returned',
        mode === 'human' ? 'Nhân viên đã tiếp quản phiên hội thoại' : 'Đã trả lại quyền trả lời cho bot',
      );
    });
    return { changed: true, controlMode: mode };
  }

  setZaloChatId(sessionId, chatId) {
    if (!chatId) return;
    this.db.prepare(`
      UPDATE sessions SET zalo_chat_id = ?, updated_at = ?
      WHERE id = ? AND (zalo_chat_id IS NULL OR zalo_chat_id != ?)
    `).run(String(chatId), now(), sessionId, String(chatId));
  }

  saveLastResponseId(sessionId, responseId) {
    this.db.prepare(`
      UPDATE sessions SET last_response_id = ?, updated_at = ? WHERE id = ?
    `).run(responseId || null, now(), sessionId);
  }

  insertActivity(sessionId, type, label, payload = {}) {
    return this.db.prepare(`
      INSERT INTO activity_events(session_id, type, label, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, type, label, json(payload), now());
  }

  addActivity(sessionId, type, label, payload = {}) {
    return this.insertActivity(sessionId, type, label, payload);
  }

  // Records an anomaly event unless an unresolved one of the same type already
  // exists for the session — prevents a persistently oversized cart or a
  // genuinely looping bot from spamming a duplicate row on every write.
  recordAnomalyOnce(sessionId, type, label, payload = {}) {
    const existing = this.db.prepare(
      'SELECT 1 FROM activity_events WHERE session_id = ? AND type = ? LIMIT 1',
    ).get(sessionId, type);
    if (existing) return;
    this.insertActivity(sessionId, type, label, payload);
  }

  addMessage(sessionId, role, content) {
    const timestamp = now();
    const activityType = role === 'user'
      ? 'customer_message'
      : role === 'human_agent' ? 'human_agent_message' : 'assistant_message';
    const activityLabel = role === 'user'
      ? `Khách: ${shortText(content)}`
      : role === 'human_agent' ? `Nhân viên: ${shortText(content)}` : `AI: ${shortText(content)}`;
    withTransaction(this.db, () => {
      if (role === 'assistant') {
        const previous = this.db.prepare(`
          SELECT content FROM messages WHERE session_id = ? AND role = 'assistant'
          ORDER BY created_at DESC, id DESC LIMIT 1
        `).get(sessionId);
        if (previous && previous.content === content) {
          this.recordAnomalyOnce(sessionId, 'anomaly_bot_stuck', 'Bot có dấu hiệu trả lời lặp lại');
        }
      }

      this.db.prepare(`
        INSERT INTO messages(session_id, role, content, created_at)
        VALUES (?, ?, ?, ?)
      `).run(sessionId, role, content, timestamp);
      this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(timestamp, sessionId);
      this.insertActivity(sessionId, activityType, activityLabel);

      if (role === 'user' && matchesSensitiveKeyword(content)) {
        this.recordAnomalyOnce(sessionId, 'anomaly_sensitive_keyword', 'Tin nhắn khách chứa từ khóa nhạy cảm');
      }
    });
  }

  recordAgentError(sessionId, message) {
    this.addActivity(sessionId, 'agent_error', `Agent gặp lỗi: ${shortText(message, 140)}`);
  }

  claimWebhookEvent({ provider, externalId, sessionId }) {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO webhook_events(
        provider, external_id, session_id, status, received_at
      ) VALUES (?, ?, ?, 'pending', ?)
    `).run(provider, externalId, sessionId, now());
    return {
      claimed: result.changes > 0,
      event: this.getWebhookEvent(provider, externalId),
    };
  }

  completeWebhookEvent(provider, externalId, replyIds = []) {
    this.db.prepare(`
      UPDATE webhook_events
      SET status = 'completed', reply_ids_json = ?, error = NULL, processed_at = ?
      WHERE provider = ? AND external_id = ?
    `).run(json(replyIds), now(), provider, externalId);
    return this.getWebhookEvent(provider, externalId);
  }

  failWebhookEvent(provider, externalId, errorMessage) {
    this.db.prepare(`
      UPDATE webhook_events
      SET status = 'failed', error = ?, processed_at = ?
      WHERE provider = ? AND external_id = ?
    `).run(shortText(errorMessage, 300), now(), provider, externalId);
    return this.getWebhookEvent(provider, externalId);
  }

  getWebhookEvent(provider, externalId) {
    const row = this.db.prepare(`
      SELECT * FROM webhook_events WHERE provider = ? AND external_id = ?
    `).get(provider, externalId);
    if (!row) return null;
    return {
      provider: row.provider,
      externalId: row.external_id,
      sessionId: row.session_id,
      status: row.status,
      replyIds: parseJson(row.reply_ids_json, []),
      error: row.error,
      receivedAt: row.received_at,
      processedAt: row.processed_at,
    };
  }

  searchMenu(sessionId, query, limit = 6) {
    const normalizedQuery = normalizeText(query);
    const tokens = normalizedQuery.split(' ').filter((token) => token && !STOP_WORDS.has(token));
    const rows = this.db.prepare('SELECT * FROM products').all();

    const ranked = rows.map((row) => {
      const normalizedName = normalizeText(row.name);
      const aliases = parseJson(row.aliases_json, []).map(normalizeText);
      const searchText = row.search_text;
      let score = 0;

      if (normalizeText(row.item_id) === normalizedQuery) score += 2000;
      if (aliases.includes(normalizedQuery)) score += 1200;
      if (normalizedName === normalizedQuery) score += 1000;
      if (normalizedName.includes(normalizedQuery) && normalizedQuery) score += 600;

      let matched = 0;
      for (const token of tokens) {
        let tokenScore = 0;
        if (normalizedName.includes(token)) tokenScore = Math.max(tokenScore, 45);
        if (aliases.some((alias) => alias.includes(token))) tokenScore = Math.max(tokenScore, 55);
        if (searchText.includes(token)) tokenScore = Math.max(tokenScore, 12);
        if (tokenScore > 0) matched += 1;
        score += tokenScore;
      }
      if (tokens.length > 0 && matched === tokens.length) score += 180;
      if (row.original_price && row.original_price > row.price) score += 5;
      return { row, score, matched };
    });

    const matches = ranked
      .filter(({ score, matched }) => score > 0 && (tokens.length === 0 || matched > 0))
      .sort((a, b) => b.score - a.score || a.row.price - b.row.price)
      .slice(0, Math.min(Math.max(limit, 1), 10))
      .map(({ row }) => ({
        itemId: row.item_id,
        name: row.name,
        category: row.category,
        price: row.price,
        originalPrice: row.original_price,
        description: row.description,
        imageUrl: row.image_url,
      }));

    this.addActivity(sessionId, 'menu_searched', `Agent tìm menu: “${shortText(query, 60)}”`, {
      query,
      resultIds: matches.map((item) => item.itemId),
    });
    return { query, count: matches.length, items: matches };
  }

  ensureCart(sessionId) {
    let cart = this.db.prepare('SELECT * FROM carts WHERE session_id = ?').get(sessionId);
    if (cart) return cart;
    const timestamp = now();
    const cartId = `cart:${sessionId}`;
    this.db.prepare(`
      INSERT INTO carts(id, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(cartId, sessionId, timestamp, timestamp);
    return this.db.prepare('SELECT * FROM carts WHERE id = ?').get(cartId);
  }

  recalculateCart(cartId) {
    const cart = this.db.prepare('SELECT * FROM carts WHERE id = ?').get(cartId);
    const subtotal = this.db.prepare(`
      SELECT COALESCE(SUM(quantity * unit_price), 0) AS subtotal
      FROM cart_items WHERE cart_id = ?
    `).get(cartId).subtotal;

    let discount = 0;
    let voucher = null;
    if (cart.voucher_code) {
      voucher = this.db.prepare('SELECT * FROM vouchers WHERE code = ?').get(cart.voucher_code);
      if (voucher?.active && subtotal >= voucher.minimum_order) {
        discount = voucher.discount_type === 'fixed'
          ? Math.min(voucher.discount_value, subtotal)
          : Math.min(Math.round(subtotal * voucher.discount_value / 100), subtotal);
      }
    }
    this.db.prepare('UPDATE carts SET discount = ? WHERE id = ?').run(discount, cartId);
    return { subtotal, discount, total: Math.max(subtotal - discount, 0), voucher };
  }

  mapCart(cart) {
    if (!cart) return null;
    const totals = this.recalculateCart(cart.id);
    const items = this.db.prepare(`
      SELECT ci.*, p.name, p.category, p.description, p.image_url
      FROM cart_items ci
      JOIN products p ON p.item_id = ci.product_id
      WHERE ci.cart_id = ?
      ORDER BY ci.created_at, ci.id
    `).all(cart.id).map((row) => ({
      lineId: row.id,
      productId: row.product_id,
      name: row.name,
      category: row.category,
      variant: row.variant,
      quantity: row.quantity,
      note: row.note,
      unitPrice: row.unit_price,
      lineTotal: row.unit_price * row.quantity,
      imageUrl: row.image_url,
    }));
    const fresh = this.db.prepare('SELECT * FROM carts WHERE id = ?').get(cart.id);
    return {
      id: fresh.id,
      sessionId: fresh.session_id,
      status: fresh.status,
      address: fresh.address,
      voucherCode: fresh.voucher_code,
      items,
      subtotal: totals.subtotal,
      discount: totals.discount,
      total: totals.total,
      version: fresh.version,
      updatedAt: fresh.updated_at,
    };
  }

  getCart(sessionId, { create = true } = {}) {
    const cart = create
      ? this.ensureCart(sessionId)
      : this.db.prepare('SELECT * FROM carts WHERE session_id = ?').get(sessionId);
    return this.mapCart(cart);
  }

  updateCart(sessionId, { operations = [], address } = {}) {
    const cart = this.ensureCart(sessionId);
    if (cart.status === 'submitted') {
      throw new DomainError('Đơn này đã chốt. Hãy dùng sessionId mới cho đơn tiếp theo.', 'CART_SUBMITTED');
    }
    if (operations.length === 0 && address === undefined) {
      throw new DomainError('Không có thay đổi nào cho giỏ hàng.', 'EMPTY_CART_UPDATE');
    }

    withTransaction(this.db, () => {
      for (const operation of operations) {
        const product = this.db.prepare('SELECT * FROM products WHERE item_id = ?').get(operation.productId);
        if (!product) {
          throw new DomainError(`Không tìm thấy productId ${operation.productId}.`, 'PRODUCT_NOT_FOUND');
        }

        const variant = cleanVariant(operation.variant);
        if (operation.action === 'remove') {
          if (operation.variant === undefined) {
            this.db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?')
              .run(cart.id, operation.productId);
          } else {
            this.db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ? AND variant = ?')
              .run(cart.id, operation.productId, variant);
          }
          continue;
        }

        const current = this.db.prepare(`
          SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ? AND variant = ?
        `).get(cart.id, operation.productId, variant);

        if (operation.action === 'set_note') {
          if (!current) throw new DomainError('Món cần ghi chú chưa có trong giỏ.', 'CART_LINE_NOT_FOUND');
          this.db.prepare('UPDATE cart_items SET note = ?, updated_at = ? WHERE id = ?')
            .run(shortText(operation.note, 240), now(), current.id);
          continue;
        }

        let quantity = operation.action === 'add'
          ? (current?.quantity || 0) + (operation.quantity || 1)
          : operation.quantity;
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY_PER_LINE) {
          throw new DomainError(
            `Số lượng mỗi món phải từ 0 đến ${MAX_QUANTITY_PER_LINE}.`,
            'INVALID_QUANTITY',
          );
        }
        if (quantity === 0) {
          if (current) this.db.prepare('DELETE FROM cart_items WHERE id = ?').run(current.id);
          continue;
        }

        const note = operation.note === undefined ? (current?.note || '') : shortText(operation.note, 240);
        const timestamp = now();
        if (current) {
          this.db.prepare(`
            UPDATE cart_items SET quantity = ?, note = ?, updated_at = ? WHERE id = ?
          `).run(quantity, note, timestamp, current.id);
        } else {
          this.db.prepare(`
            INSERT INTO cart_items(
              id, cart_id, product_id, variant, quantity, note, unit_price, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            crypto.randomUUID(), cart.id, product.item_id, variant, quantity, note,
            product.price, timestamp, timestamp,
          );
        }
      }

      if (address !== undefined) {
        const cleanedAddress = String(address).trim();
        if (cleanedAddress.length < 5 || cleanedAddress.length > 300) {
          throw new DomainError('Địa chỉ giao hàng cần từ 5 đến 300 ký tự.', 'INVALID_ADDRESS');
        }
        this.db.prepare('UPDATE carts SET address = ? WHERE id = ?').run(cleanedAddress, cart.id);
      }

      const itemCount = this.db.prepare(`
        SELECT COUNT(*) AS count FROM cart_items WHERE cart_id = ?
      `).get(cart.id).count;
      const updatedCart = this.db.prepare('SELECT address FROM carts WHERE id = ?').get(cart.id);
      const status = itemCount === 0 ? 'empty' : updatedCart.address ? 'ready' : 'collecting';
      const timestamp = now();
      this.db.prepare(`
        UPDATE carts SET status = ?, version = version + 1, updated_at = ? WHERE id = ?
      `).run(status, timestamp, cart.id);
      this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(timestamp, sessionId);
      const totals = this.recalculateCart(cart.id);
      this.insertActivity(sessionId, 'cart_updated', 'Agent cập nhật giỏ hàng', {
        operations,
        address: address === undefined ? undefined : String(address).trim(),
      });

      // "More than 10 items" means total quantity summed across lines, not
      // distinct product lines — a cart with 3 lines of quantity 4 each (12
      // total) is oversized even though `itemCount` above (line count) is 3.
      const totalQuantity = this.db.prepare(`
        SELECT COALESCE(SUM(quantity), 0) AS total FROM cart_items WHERE cart_id = ?
      `).get(cart.id).total;
      if (totalQuantity > OVERSIZED_CART_ITEM_THRESHOLD || totals.total > OVERSIZED_CART_TOTAL_THRESHOLD) {
        this.recordAnomalyOnce(sessionId, 'anomaly_oversized_cart', 'Giỏ hàng lớn bất thường', {
          totalQuantity,
          total: totals.total,
        });
      }
    });

    return this.getCart(sessionId, { create: false });
  }

  checkLoyalty(sessionId, phoneInput) {
    const phone = cleanPhone(phoneInput);
    const timestamp = now();
    let customer = this.db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
    withTransaction(this.db, () => {
      if (!customer) {
        this.db.prepare(`
          INSERT INTO customers(phone, display_name, points, updated_at)
          VALUES (?, 'Khách mới', 0, ?)
        `).run(phone, timestamp);
      }
      this.db.prepare(`
        UPDATE sessions SET customer_phone = ?, updated_at = ? WHERE id = ?
      `).run(phone, timestamp, sessionId);
      customer = this.db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
      this.insertActivity(
        sessionId,
        'loyalty_checked',
        `Kiểm tra thành viên ${phone}: ${customer.points} điểm`,
        { phone, points: customer.points },
      );
    });
    return {
      phone,
      displayName: customer.display_name,
      points: customer.points,
    };
  }

  applyVoucher(sessionId, codeInput, phoneInput) {
    const cart = this.ensureCart(sessionId);
    const code = String(codeInput || '').trim().toUpperCase();
    const phone = phoneInput ? cleanPhone(phoneInput) : null;
    let result;

    withTransaction(this.db, () => {
      const freshCart = this.db.prepare('SELECT * FROM carts WHERE id = ?').get(cart.id);
      const subtotal = this.db.prepare(`
        SELECT COALESCE(SUM(quantity * unit_price), 0) AS subtotal
        FROM cart_items WHERE cart_id = ?
      `).get(cart.id).subtotal;
      const voucher = this.db.prepare('SELECT * FROM vouchers WHERE code = ?').get(code);

      if (freshCart.status === 'submitted') {
        result = { success: false, code, reason: 'Đơn đã chốt nên không thể áp dụng voucher.' };
      } else if (!voucher || !voucher.active) {
        result = { success: false, code, reason: 'Mã voucher không tồn tại hoặc đã hết hiệu lực.' };
      } else if (subtotal < voucher.minimum_order) {
        result = {
          success: false,
          code,
          reason: `Đơn cần tối thiểu ${voucher.minimum_order}đ để dùng mã này.`,
          minimumOrder: voucher.minimum_order,
          subtotal,
        };
      } else {
        const timestamp = now();
        this.db.prepare(`
          UPDATE carts
          SET voucher_code = ?, version = version + 1, updated_at = ?
          WHERE id = ?
        `).run(code, timestamp, cart.id);
        const totals = this.recalculateCart(cart.id);
        result = {
          success: true,
          code,
          description: voucher.description,
          discount: totals.discount,
          subtotal: totals.subtotal,
          total: totals.total,
        };
      }

      if (phone) {
        this.db.prepare('UPDATE sessions SET customer_phone = ?, updated_at = ? WHERE id = ?')
          .run(phone, now(), sessionId);
      }
      this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now(), sessionId);
      this.insertActivity(
        sessionId,
        result.success ? 'voucher_applied' : 'voucher_rejected',
        result.success ? `Áp dụng ${code}: giảm ${result.discount}đ` : `${code}: ${result.reason}`,
        result,
      );
    });
    return result;
  }

  mapOrder(row) {
    if (!row) return null;
    const items = this.db.prepare(`
      SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid
    `).all(row.id).map((item) => ({
      productId: item.product_id,
      name: item.product_name,
      variant: item.variant,
      quantity: item.quantity,
      note: item.note,
      unitPrice: item.unit_price,
      lineTotal: item.line_total,
    }));
    return {
      id: row.id,
      orderNumber: row.display_id,
      sessionId: row.session_id,
      userId: row.user_id,
      phone: row.phone,
      address: row.address,
      subtotal: row.subtotal,
      discount: row.discount,
      total: row.total,
      voucherCode: row.voucher_code,
      status: row.status,
      createdAt: row.created_at,
      items,
    };
  }

  createOrder(sessionId, userId, phoneInput) {
    const cart = this.ensureCart(sessionId);
    let output;
    withTransaction(this.db, () => {
      const existing = this.db.prepare('SELECT * FROM orders WHERE source_cart_id = ?').get(cart.id);
      if (existing) {
        output = { success: true, alreadyExisted: true, order: this.mapOrder(existing) };
        return;
      }

      const currentCart = this.getCart(sessionId, { create: false });
      const missing = [];
      if (currentCart.items.length === 0) missing.push('items');
      if (!currentCart.address) missing.push('address');
      if (missing.length > 0) {
        output = { success: false, missing, reason: 'Giỏ hàng chưa đủ thông tin để tạo đơn.' };
        this.insertActivity(sessionId, 'order_waiting', 'Chưa thể tạo đơn: thiếu thông tin', { missing });
        return;
      }

      const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      const phone = phoneInput ? cleanPhone(phoneInput) : session.customer_phone;
      const orderId = crypto.randomUUID();
      const displayId = `KFC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const timestamp = now();
      this.db.prepare(`
        INSERT INTO orders(
          id, display_id, session_id, source_cart_id, user_id, phone, address,
          subtotal, discount, total, voucher_code, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
      `).run(
        orderId, displayId, sessionId, cart.id, userId, phone, currentCart.address,
        currentCart.subtotal, currentCart.discount, currentCart.total,
        currentCart.voucherCode, timestamp,
      );

      const insertItem = this.db.prepare(`
        INSERT INTO order_items(
          id, order_id, product_id, product_name, variant, quantity,
          note, unit_price, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of currentCart.items) {
        insertItem.run(
          crypto.randomUUID(), orderId, item.productId, item.name, item.variant,
          item.quantity, item.note, item.unitPrice, item.lineTotal,
        );
      }
      this.db.prepare(`
        UPDATE carts SET status = 'submitted', version = version + 1, updated_at = ? WHERE id = ?
      `).run(timestamp, cart.id);
      this.db.prepare(`
        UPDATE sessions SET customer_phone = COALESCE(?, customer_phone), updated_at = ? WHERE id = ?
      `).run(phone, timestamp, sessionId);
      this.insertActivity(sessionId, 'order_created', `Đơn mới ${displayId} đã được tạo`, {
        orderId,
        orderNumber: displayId,
        total: currentCart.total,
      });
      output = {
        success: true,
        alreadyExisted: false,
        order: this.mapOrder(this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)),
      };
    });
    return output;
  }

  dashboardSnapshot(requestedSessionId) {
    const sessions = this.db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
        (SELECT COUNT(*) FROM orders o WHERE o.session_id = s.id) AS order_count,
        EXISTS(
          SELECT 1 FROM activity_events a WHERE a.session_id = s.id AND a.type LIKE 'anomaly_%'
        ) AS has_anomaly
      FROM sessions s
      ORDER BY s.updated_at DESC
    `).all().map((row) => ({
      id: row.id,
      userId: row.user_id,
      customerPhone: row.customer_phone,
      messageCount: row.message_count,
      orderCount: row.order_count,
      controlMode: row.control_mode,
      zaloChatId: row.zalo_chat_id,
      hasAnomaly: Boolean(row.has_anomaly),
      updatedAt: row.updated_at,
    }));

    const selectedSessionId = sessions.some((session) => session.id === requestedSessionId)
      ? requestedSessionId
      : sessions[0]?.id || null;
    const selectedSession = selectedSessionId
      ? this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(selectedSessionId)
      : null;
    const cart = selectedSessionId ? this.getCart(selectedSessionId, { create: false }) : null;

    const messages = selectedSessionId
      ? this.db.prepare(`
          SELECT id, role, content, created_at
          FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 40
        `).all(selectedSessionId).reverse().map((row) => ({
          id: row.id,
          role: row.role,
          content: row.content,
          createdAt: row.created_at,
        }))
      : [];

    const activity = selectedSessionId
      ? this.db.prepare(`
          SELECT id, type, label, payload_json, created_at
          FROM activity_events WHERE session_id = ? ORDER BY id DESC LIMIT 80
        `).all(selectedSessionId).map((row) => ({
          id: row.id,
          type: row.type,
          label: row.label,
          payload: parseJson(row.payload_json),
          createdAt: row.created_at,
        }))
      : [];

    const orderRows = this.db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 20').all();
    const orders = orderRows.map((row) => this.mapOrder(row));
    const customer = selectedSession?.customer_phone
      ? this.db.prepare('SELECT * FROM customers WHERE phone = ?').get(selectedSession.customer_phone)
      : null;
    const voucher = cart?.voucherCode
      ? this.db.prepare('SELECT * FROM vouchers WHERE code = ?').get(cart.voucherCode)
      : null;

    const metrics = {
      newOrders: this.db.prepare("SELECT COUNT(*) AS value FROM orders WHERE status = 'new'").get().value,
      revenue: this.db.prepare('SELECT COALESCE(SUM(total), 0) AS value FROM orders').get().value,
      activeCarts: this.db.prepare(`
        SELECT COUNT(*) AS value FROM carts
        WHERE status IN ('collecting', 'ready')
      `).get().value,
      cartDiscount: this.db.prepare('SELECT COALESCE(SUM(discount), 0) AS value FROM carts').get().value,
    };

    const version = this.db.prepare('SELECT COALESCE(MAX(id), 0) AS value FROM activity_events').get().value;
    const menuImportedAt = this.db.prepare("SELECT value FROM metadata WHERE key = 'menu_imported_at'").get()?.value;
    const menuCount = this.db.prepare('SELECT COUNT(*) AS value FROM products').get().value;
    return {
      version,
      updatedAt: now(),
      selectedSessionId,
      controlMode: selectedSession?.control_mode || null,
      zaloChatId: selectedSession?.zalo_chat_id || null,
      sessions,
      metrics,
      cart,
      customer: customer ? {
        phone: customer.phone,
        displayName: customer.display_name,
        points: customer.points,
      } : null,
      voucher: voucher ? {
        code: voucher.code,
        description: voucher.description,
        active: Boolean(voucher.active),
        discountValue: voucher.discount_value,
        minimumOrder: voucher.minimum_order,
        appliedDiscount: cart?.discount || 0,
      } : null,
      orders,
      messages,
      activity,
      source: {
        database: 'data/kfc-demo.sqlite',
        menuFile: 'kfc_menu.json',
        menuCount,
        menuImportedAt,
      },
    };
  }

  resetSession(sessionId) {
    let result;
    withTransaction(this.db, () => {
      this.db.prepare('DELETE FROM webhook_events WHERE session_id = ?').run(sessionId);
      result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    });
    return { reset: result.changes > 0, sessionId };
  }

  resetAll() {
    const count = this.db.prepare('SELECT COUNT(*) AS value FROM sessions').get().value;
    withTransaction(this.db, () => {
      this.db.exec('DELETE FROM webhook_events');
      this.db.exec('DELETE FROM sessions');
    });
    return { resetSessions: count };
  }
}
