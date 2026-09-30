export const LOCALES = ['vi', 'en'];
const DEFAULT_LOCALE = 'vi';
const STORAGE_KEY = 'kfc_dashboard_locale';

// Strings that are identical in both locales (brand names, English loanwords) live here once
// instead of being duplicated verbatim in both STRINGS.vi and STRINGS.en.
const COMMON = {
  'app.eyebrow': 'KFC Vietnam · Conversational Ordering',
  'connection.online': 'Live',
  'customer.kicker': 'System Integration',
  'orders.kicker': 'Kitchen Queue',
  'activity.kicker': 'Agent Activity',
  'conversation.kicker': 'Conversation',
};

const STRINGS = {
  vi: {
    ...COMMON,
    'app.title': 'Order Liveboard',
    'app.subtitle': 'Theo dõi giỏ hàng, đơn mới và hoạt động của AI theo thời gian gần thực.',
    'connection.connecting': 'Đang kết nối',
    'connection.offline': 'Mất kết nối',
    'session.label': 'Phiên demo',
    'session.selectAria': 'Chọn phiên demo',
    'session.none': 'Chưa có phiên',
    'session.messageCount': '{count} tin',
    'reset.button': 'Reset phiên',
    'reset.confirm': 'Reset toàn bộ dữ liệu của phiên "{sessionId}"?',
    'reset.success': 'Đã reset phiên demo',
    'reset.failure': 'Không thể reset phiên lúc này',
    'lastUpdated.empty': 'Chưa có dữ liệu',
    'lastUpdated.value': 'Cập nhật gần nhất: {time}',
    'source.loading': 'Nguồn local đang khởi tạo',
    'source.value': 'Nguồn: SQLite local · {count} món từ {file} · polling 1 giây',
    'metrics.newOrders.label': 'Đơn mới · toàn demo',
    'metrics.newOrders.hint': 'Đơn đã được agent chốt',
    'metrics.revenue.label': 'Doanh thu đã chốt',
    'metrics.revenue.hint': 'Tổng tiền sau giảm giá',
    'metrics.carts.label': 'Giỏ đang xử lý',
    'metrics.carts.hint': 'Đang tư vấn hoặc sẵn sàng chốt',
    'metrics.discount.label': 'Giảm giá trên giỏ',
    'metrics.discount.hint': 'Voucher đã áp dụng hiện tại',
    'cart.kicker': 'Phiên đang chọn',
    'cart.title': 'Giỏ hàng hiện tại',
    'cart.status.empty': 'Chưa có giỏ',
    'cart.status.collecting': 'Đang tư vấn',
    'cart.status.ready': 'Sẵn sàng chốt',
    'cart.status.submitted': 'Đã tạo đơn',
    'cart.empty': 'Gửi tin nhắn vào API để bắt đầu một phiên đặt món.',
    'cart.emptyItems': 'Giỏ hàng đang trống. Các tool update cart sẽ hiển thị món tại đây.',
    'cart.address.label': 'Địa chỉ giao hàng',
    'cart.address.missing': 'Agent cần hỏi thêm địa chỉ trước khi chốt đơn',
    'cart.subtotal': 'Tạm tính',
    'cart.discount': 'Giảm giá',
    'cart.voucherDiscount': 'Voucher {code}',
    'cart.total': 'Tổng thanh toán',
    'cart.perItem': '/ món',
    'customer.title': 'Thành viên & ưu đãi',
    'customer.empty': 'Chưa tra cứu thành viên hoặc voucher.',
    'customer.account': 'Tài khoản thành viên',
    'customer.noPhone': 'Chưa có số điện thoại',
    'customer.points': '{points} điểm',
    'customer.voucher': 'Voucher trên giỏ',
    'customer.voucherNone': 'Chưa áp dụng',
    'customer.voucherApplied': 'Đã giảm {amount}',
    'customer.voucherNotEligible': 'Chưa đủ điều kiện',
    'orders.title': 'Đơn hàng mới',
    'orders.count': '{count} đơn',
    'orders.empty': 'Đơn vừa chốt sẽ xuất hiện ở đây.',
    'orders.new': 'Mới',
    'orders.phone': 'Số điện thoại',
    'activity.title': 'Dòng sự kiện',
    'activity.empty': 'Chưa có hoạt động trong phiên.',
    'conversation.title': 'Hội thoại gần nhất',
    'conversation.empty': 'Transcript local sẽ hiển thị tại đây.',
    'handoff.controlBadgeBot': 'Bot đang trả lời',
    'handoff.controlBadgeHuman': 'Nhân viên đang trả lời',
    'handoff.takeOver': 'Tiếp quản',
    'handoff.handBack': 'Trả lại cho bot',
    'handoff.composerPlaceholder': 'Nhập tin nhắn gửi khách…',
    'handoff.composerAria': 'Tin nhắn gửi khách',
    'handoff.send': 'Gửi',
    'handoff.noZaloChat': 'Phiên này chưa có địa chỉ Zalo trên hồ sơ nên chưa thể gửi tin nhắn trực tiếp.',
    'handoff.takeOverSuccess': 'Đã tiếp quản phiên. Bot tạm dừng trả lời.',
    'handoff.takeOverFailure': 'Không thể tiếp quản phiên lúc này',
    'handoff.handBackSuccess': 'Đã trả lại quyền trả lời cho bot.',
    'handoff.handBackFailure': 'Không thể trả lại quyền cho bot lúc này',
    'handoff.sendSuccess': 'Đã gửi tin nhắn cho khách.',
    'handoff.sendFailure': 'Không thể gửi tin nhắn lúc này',
    'message.humanAgentLabel': 'Nhân viên',
    'lang.toggleLabel': 'EN',
    'lang.toggleAria': 'Chuyển sang tiếng Anh',
    'metrics.sectionAria': 'Chỉ số tổng quan',
  },
  en: {
    ...COMMON,
    'app.title': 'Order Liveboard',
    'app.subtitle': 'Track carts, new orders, and AI activity in near real time.',
    'connection.connecting': 'Connecting',
    'connection.offline': 'Disconnected',
    'session.label': 'Demo session',
    'session.selectAria': 'Select demo session',
    'session.none': 'No session yet',
    'session.messageCount': '{count} msg',
    'reset.button': 'Reset session',
    'reset.confirm': 'Reset all data for session "{sessionId}"?',
    'reset.success': 'Demo session reset',
    'reset.failure': 'Could not reset the session right now',
    'lastUpdated.empty': 'No data yet',
    'lastUpdated.value': 'Last updated: {time}',
    'source.loading': 'Local source initializing',
    'source.value': 'Source: local SQLite · {count} items from {file} · polling every 1s',
    'metrics.newOrders.label': 'New orders · demo-wide',
    'metrics.newOrders.hint': 'Orders confirmed by the agent',
    'metrics.revenue.label': 'Confirmed revenue',
    'metrics.revenue.hint': 'Total after discounts',
    'metrics.carts.label': 'Active carts',
    'metrics.carts.hint': 'In progress or ready to confirm',
    'metrics.discount.label': 'Cart discounts',
    'metrics.discount.hint': 'Currently applied vouchers',
    'cart.kicker': 'Selected session',
    'cart.title': 'Current cart',
    'cart.status.empty': 'No cart yet',
    'cart.status.collecting': 'In progress',
    'cart.status.ready': 'Ready to confirm',
    'cart.status.submitted': 'Order placed',
    'cart.empty': 'Send a message to the API to start an ordering session.',
    'cart.emptyItems': 'The cart is empty. Items updated via the cart tool will show up here.',
    'cart.address.label': 'Delivery address',
    'cart.address.missing': 'Agent still needs to ask for the address before confirming',
    'cart.subtotal': 'Subtotal',
    'cart.discount': 'Discount',
    'cart.voucherDiscount': 'Voucher {code}',
    'cart.total': 'Total due',
    'cart.perItem': '/ item',
    'customer.title': 'Member & offers',
    'customer.empty': 'No member or voucher looked up yet.',
    'customer.account': 'Member account',
    'customer.noPhone': 'No phone number yet',
    'customer.points': '{points} points',
    'customer.voucher': 'Cart voucher',
    'customer.voucherNone': 'Not applied',
    'customer.voucherApplied': 'Saved {amount}',
    'customer.voucherNotEligible': 'Not eligible yet',
    'orders.title': 'New orders',
    'orders.count': '{count} orders',
    'orders.empty': 'Confirmed orders will show up here.',
    'orders.new': 'New',
    'orders.phone': 'Phone number',
    'activity.title': 'Event stream',
    'activity.empty': 'No activity in this session yet.',
    'conversation.title': 'Recent conversation',
    'conversation.empty': 'The local transcript will show up here.',
    'handoff.controlBadgeBot': 'Bot is replying',
    'handoff.controlBadgeHuman': 'Staff is replying',
    'handoff.takeOver': 'Take over',
    'handoff.handBack': 'Hand back to bot',
    'handoff.composerPlaceholder': 'Type a message to the customer…',
    'handoff.composerAria': 'Message to customer',
    'handoff.send': 'Send',
    'handoff.noZaloChat': 'This session has no Zalo address on file, so direct messages cannot be sent yet.',
    'handoff.takeOverSuccess': 'Session taken over. Bot replies paused.',
    'handoff.takeOverFailure': 'Could not take over the session right now',
    'handoff.handBackSuccess': 'Handed control back to the bot.',
    'handoff.handBackFailure': 'Could not hand control back right now',
    'handoff.sendSuccess': 'Message sent to the customer.',
    'handoff.sendFailure': 'Could not send the message right now',
    'message.humanAgentLabel': 'Staff',
    'lang.toggleLabel': 'VI',
    'lang.toggleAria': 'Switch to Vietnamese',
    'metrics.sectionAria': 'Overview metrics',
  },
};

function readStoredLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return LOCALES.includes(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

let currentLocale = readStoredLocale();
document.documentElement.lang = currentLocale;

export function getLocale() {
  return currentLocale;
}

export function setLocale(locale) {
  if (!LOCALES.includes(locale)) return;
  currentLocale = locale;
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // localStorage unavailable (e.g. private browsing) — locale stays in-memory only.
  }
}

export function t(key, params = {}) {
  const template = STRINGS[currentLocale]?.[key] ?? STRINGS[DEFAULT_LOCALE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

// Only for markup dashboard.js never re-renders (headers, panel titles, empty-state fallbacks).
// Elements dashboard.js rewrites via innerHTML on every poll call t() directly in their render
// functions instead — data-i18n on those would be wiped out on the next render anyway.
export function applyStaticLocale(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
}
