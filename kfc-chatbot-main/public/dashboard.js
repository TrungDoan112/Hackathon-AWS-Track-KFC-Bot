import { t, getLocale, setLocale, applyStaticLocale } from './i18n.js';

const elements = {
  connectionState: document.querySelector('#connectionState'),
  connectionText: document.querySelector('#connectionText'),
  sessionSelect: document.querySelector('#sessionSelect'),
  resetButton: document.querySelector('#resetButton'),
  langToggle: document.querySelector('#langToggle'),
  lastUpdated: document.querySelector('#lastUpdated'),
  sourceInfo: document.querySelector('#sourceInfo'),
  metricOrders: document.querySelector('#metricOrders'),
  metricRevenue: document.querySelector('#metricRevenue'),
  metricCarts: document.querySelector('#metricCarts'),
  metricDiscount: document.querySelector('#metricDiscount'),
  cartStatus: document.querySelector('#cartStatus'),
  cartContent: document.querySelector('#cartContent'),
  customerContent: document.querySelector('#customerContent'),
  ordersCount: document.querySelector('#ordersCount'),
  ordersContent: document.querySelector('#ordersContent'),
  activityContent: document.querySelector('#activityContent'),
  messagesContent: document.querySelector('#messagesContent'),
  toast: document.querySelector('#toast'),
  controlModeBadge: document.querySelector('#controlModeBadge'),
  takeOverButton: document.querySelector('#takeOverButton'),
  handBackButton: document.querySelector('#handBackButton'),
  composerForm: document.querySelector('#composerForm'),
  composerInput: document.querySelector('#composerInput'),
  composerSend: document.querySelector('#composerSend'),
  composerHint: document.querySelector('#composerHint'),
};

const currency = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});
const dateTime = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  day: '2-digit',
  month: '2-digit',
});

let selectedSessionId = new URLSearchParams(location.search).get('sessionId') || '';
let lastRenderKey = '';
let lastData = null;
let pollDelay = 1000;
let toastTimer;

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMoney(value = 0) {
  return currency.format(Number(value) || 0);
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : dateTime.format(date);
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 2600);
}

function setConnection(state, text) {
  elements.connectionState.dataset.state = state;
  elements.connectionText.textContent = text;
}

function statusPresentation(status) {
  return {
    empty: [t('cart.status.empty'), 'status-empty'],
    collecting: [t('cart.status.collecting'), 'status-collecting'],
    ready: [t('cart.status.ready'), 'status-ready'],
    submitted: [t('cart.status.submitted'), 'status-submitted'],
  }[status] || [t('cart.status.empty'), 'status-empty'];
}

function renderSessions(data) {
  const previous = selectedSessionId;
  elements.sessionSelect.innerHTML = data.sessions.length
    ? data.sessions.map((session) => `
        <option value="${escapeHtml(session.id)}" ${session.id === data.selectedSessionId ? 'selected' : ''}>
          ${session.hasAnomaly ? '⚠️ ' : ''}${session.controlMode === 'human' ? '🧑‍💼 ' : ''}${escapeHtml(session.id)} · ${t('session.messageCount', { count: session.messageCount })}
        </option>
      `).join('')
    : `<option value="">${t('session.none')}</option>`;
  selectedSessionId = data.selectedSessionId || '';
  elements.resetButton.disabled = !selectedSessionId;
  if (selectedSessionId && previous !== selectedSessionId) {
    const url = new URL(location.href);
    url.searchParams.set('sessionId', selectedSessionId);
    history.replaceState({}, '', url);
  }
}

function renderControlPanel(data) {
  const selectedSession = data.sessions.find((session) => session.id === data.selectedSessionId);
  const hasSession = Boolean(selectedSession);
  const isHuman = selectedSession?.controlMode === 'human';

  elements.controlModeBadge.textContent = isHuman ? t('handoff.controlBadgeHuman') : t('handoff.controlBadgeBot');
  elements.controlModeBadge.className = `status-badge ${isHuman ? 'status-human' : 'status-empty'}`;

  elements.takeOverButton.hidden = isHuman;
  elements.takeOverButton.disabled = !hasSession;
  elements.handBackButton.hidden = !isHuman;
  elements.handBackButton.disabled = !hasSession;

  const hasZaloChat = Boolean(selectedSession?.zaloChatId);
  elements.composerForm.hidden = !isHuman || !hasZaloChat;
  elements.composerHint.hidden = !isHuman || hasZaloChat;
}

function renderMetrics(metrics) {
  elements.metricOrders.textContent = metrics.newOrders;
  elements.metricRevenue.textContent = formatMoney(metrics.revenue);
  elements.metricCarts.textContent = metrics.activeCarts;
  elements.metricDiscount.textContent = formatMoney(metrics.cartDiscount);
}

function renderCart(cart) {
  const [statusLabel, statusClass] = statusPresentation(cart?.status);
  elements.cartStatus.textContent = statusLabel;
  elements.cartStatus.className = `status-badge ${statusClass}`;
  if (!cart || cart.items.length === 0) {
    elements.cartContent.className = 'empty-state';
    elements.cartContent.innerHTML = `
      <span class="empty-icon">🍗</span>
      <p>${t('cart.emptyItems')}</p>
    `;
    return;
  }

  elements.cartContent.className = 'cart-body';
  elements.cartContent.innerHTML = `
    <div>
      ${cart.items.map((item) => `
        <div class="cart-line">
          <span class="quantity-box">${item.quantity}×</span>
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="line-meta">
              ${item.variant ? `<span class="tag">${escapeHtml(item.variant)}</span>` : ''}
              ${item.note ? `<span class="tag tag-note">${escapeHtml(item.note)}</span>` : ''}
              ${formatMoney(item.unitPrice)} ${t('cart.perItem')}
            </div>
          </div>
          <span class="line-price">${formatMoney(item.lineTotal)}</span>
        </div>
      `).join('')}
    </div>
    <div class="cart-details">
      <div class="address-box">
        <small>${t('cart.address.label')}</small>
        <strong>${cart.address ? escapeHtml(cart.address) : t('cart.address.missing')}</strong>
      </div>
      <div class="summary">
        <div class="summary-row"><span>${t('cart.subtotal')}</span><strong>${formatMoney(cart.subtotal)}</strong></div>
        <div class="summary-row discount"><span>${cart.voucherCode ? t('cart.voucherDiscount', { code: escapeHtml(cart.voucherCode) }) : t('cart.discount')}</span><strong>− ${formatMoney(cart.discount)}</strong></div>
        <div class="summary-row total"><span>${t('cart.total')}</span><strong>${formatMoney(cart.total)}</strong></div>
      </div>
    </div>
  `;
}

function renderCustomer(customer, voucher) {
  if (!customer && !voucher) {
    elements.customerContent.className = 'empty-state compact';
    elements.customerContent.innerHTML = `<span class="empty-icon">★</span><p>${t('customer.empty')}</p>`;
    return;
  }
  elements.customerContent.className = 'customer-body';
  elements.customerContent.innerHTML = `
    <div class="customer-card">
      <small>${t('customer.account')}</small>
      <strong>${customer ? escapeHtml(customer.phone) : t('customer.noPhone')}</strong>
      ${customer ? `<strong class="points">${t('customer.points', { points: customer.points })}</strong>` : ''}
    </div>
    <div class="customer-card">
      <small>${t('customer.voucher')}</small>
      <strong>${voucher ? escapeHtml(voucher.code) : t('customer.voucherNone')}</strong>
      ${voucher ? `
        <p>${escapeHtml(voucher.description)}</p>
        <span class="status-badge ${voucher.appliedDiscount > 0 ? 'status-ready' : 'status-collecting'}">
          ${voucher.appliedDiscount > 0 ? t('customer.voucherApplied', { amount: formatMoney(voucher.appliedDiscount) }) : t('customer.voucherNotEligible')}
        </span>
      ` : ''}
    </div>
  `;
}

function renderOrders(orders) {
  elements.ordersCount.textContent = t('orders.count', { count: orders.length });
  if (!orders.length) {
    elements.ordersContent.className = 'empty-state compact';
    elements.ordersContent.innerHTML = `<span class="empty-icon">🧾</span><p>${t('orders.empty')}</p>`;
    return;
  }
  elements.ordersContent.className = 'order-list';
  elements.ordersContent.innerHTML = orders.map((order) => `
    <details class="order-card">
      <summary>
        <div>
          <h3>${escapeHtml(order.orderNumber)}</h3>
          <time>${formatTime(order.createdAt)} · ${escapeHtml(order.sessionId)}</time>
          <address>${escapeHtml(order.address)}</address>
        </div>
        <span class="order-total">${formatMoney(order.total)}</span>
        <span class="new-badge">${t('orders.new')}</span>
      </summary>
      <div class="order-detail">
        ${order.items.map((item) => `
          <div class="order-item">
            <span>${item.quantity}× ${escapeHtml(item.name)}${item.variant ? ` · ${escapeHtml(item.variant)}` : ''}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</span>
            <strong>${formatMoney(item.lineTotal)}</strong>
          </div>
        `).join('')}
        ${order.voucherCode ? `<div class="order-item"><span>${t('cart.voucherDiscount', { code: escapeHtml(order.voucherCode) })}</span><strong>− ${formatMoney(order.discount)}</strong></div>` : ''}
        ${order.phone ? `<div class="order-item"><span>${t('orders.phone')}</span><strong>${escapeHtml(order.phone)}</strong></div>` : ''}
      </div>
    </details>
  `).join('');
}

function renderActivity(activity) {
  if (!activity.length) {
    elements.activityContent.className = 'empty-state compact';
    elements.activityContent.innerHTML = `<p>${t('activity.empty')}</p>`;
    return;
  }
  elements.activityContent.className = 'timeline';
  elements.activityContent.innerHTML = activity.map((event) => `
    <div class="event" data-type="${escapeHtml(event.type)}">
      <p>${escapeHtml(event.label)}</p>
      <time>${formatTime(event.createdAt)}</time>
    </div>
  `).join('');
}

function renderMessages(messages) {
  if (!messages.length) {
    elements.messagesContent.className = 'empty-state compact';
    elements.messagesContent.innerHTML = `<p>${t('conversation.empty')}</p>`;
    return;
  }
  elements.messagesContent.className = 'messages';
  elements.messagesContent.innerHTML = messages.map((message) => `
    <div class="message ${escapeHtml(message.role)}">
      ${message.role === 'human_agent' ? `<span class="human-agent-label">${t('message.humanAgentLabel')}</span>` : ''}
      ${escapeHtml(message.content)}
      <time>${formatTime(message.createdAt)}</time>
    </div>
  `).join('');
  elements.messagesContent.scrollTop = elements.messagesContent.scrollHeight;
}

function render(data) {
  renderSessions(data);
  renderControlPanel(data);
  renderMetrics(data.metrics);
  renderCart(data.cart);
  renderCustomer(data.customer, data.voucher);
  renderOrders(data.orders);
  renderActivity(data.activity);
  renderMessages(data.messages);
  elements.lastUpdated.textContent = t('lastUpdated.value', { time: formatTime(data.updatedAt) });
  elements.sourceInfo.textContent = t('source.value', { count: data.source.menuCount, file: data.source.menuFile });
}

async function poll() {
  try {
    const query = selectedSessionId ? `?sessionId=${encodeURIComponent(selectedSessionId)}` : '';
    const response = await fetch(`/api/dashboard/snapshot${query}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    lastData = data;
    setConnection('online', t('connection.online'));
    pollDelay = 1000;
    const renderKey = `${data.version}:${data.selectedSessionId || ''}:${data.sessions.length}`;
    if (renderKey !== lastRenderKey) {
      render(data);
      lastRenderKey = renderKey;
    } else {
      elements.lastUpdated.textContent = t('lastUpdated.value', { time: formatTime(data.updatedAt) });
    }
  } catch (error) {
    setConnection('offline', t('connection.offline'));
    pollDelay = 5000;
  } finally {
    setTimeout(poll, pollDelay);
  }
}

elements.sessionSelect.addEventListener('change', () => {
  selectedSessionId = elements.sessionSelect.value;
  lastRenderKey = '';
  const url = new URL(location.href);
  if (selectedSessionId) url.searchParams.set('sessionId', selectedSessionId);
  else url.searchParams.delete('sessionId');
  history.replaceState({}, '', url);
});

elements.resetButton.addEventListener('click', async () => {
  if (!selectedSessionId) return;
  if (!window.confirm(t('reset.confirm', { sessionId: selectedSessionId }))) return;
  elements.resetButton.disabled = true;
  try {
    const response = await fetch('/api/demo/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: selectedSessionId }),
    });
    if (!response.ok) throw new Error('Reset failed');
    showToast(t('reset.success'));
    selectedSessionId = '';
    lastRenderKey = '';
  } catch {
    showToast(t('reset.failure'));
  } finally {
    elements.resetButton.disabled = false;
  }
});

elements.langToggle.addEventListener('click', () => {
  setLocale(getLocale() === 'vi' ? 'en' : 'vi');
  applyStaticLocale(document);
  if (lastData) render(lastData);
});

async function postSessionAction(path) {
  return fetch(`/api/sessions/${encodeURIComponent(selectedSessionId)}/${path}`, { method: 'POST' });
}

function wireSessionActionButton(button, path, successKey, failureKey) {
  button.addEventListener('click', async () => {
    if (!selectedSessionId) return;
    button.disabled = true;
    try {
      const response = await postSessionAction(path);
      if (!response.ok) throw new Error(`${path} failed`);
      showToast(t(successKey));
      lastRenderKey = '';
    } catch {
      showToast(t(failureKey));
      button.disabled = false;
    }
  });
}

wireSessionActionButton(elements.takeOverButton, 'take-over', 'handoff.takeOverSuccess', 'handoff.takeOverFailure');
wireSessionActionButton(elements.handBackButton, 'hand-back', 'handoff.handBackSuccess', 'handoff.handBackFailure');

elements.composerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = elements.composerInput.value.trim();
  if (!selectedSessionId || !message) return;
  elements.composerSend.disabled = true;
  elements.composerInput.disabled = true;
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(selectedSessionId)}/human-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || t('handoff.sendFailure'));
    elements.composerInput.value = '';
    showToast(t('handoff.sendSuccess'));
    lastRenderKey = '';
  } catch (error) {
    showToast(error.message || t('handoff.sendFailure'));
  } finally {
    elements.composerSend.disabled = false;
    elements.composerInput.disabled = false;
  }
});

applyStaticLocale(document);
elements.connectionText.textContent = t('connection.connecting');
elements.lastUpdated.textContent = t('lastUpdated.empty');
elements.sourceInfo.textContent = t('source.loading');
elements.cartStatus.textContent = t('cart.status.empty');
elements.ordersCount.textContent = t('orders.count', { count: 0 });
poll();

