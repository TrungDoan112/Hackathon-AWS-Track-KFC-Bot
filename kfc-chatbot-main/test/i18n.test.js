import assert from 'node:assert/strict';
import test from 'node:test';

// public/i18n.js is a browser ES module: at import time it reads localStorage,
// and setLocale()/applyStaticLocale() touch `document`. There is no jsdom in
// this repo, so we stub the minimal globals it needs before importing it.

class FakeStorage {
  constructor() {
    this.store = new Map();
  }

  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  setItem(key, value) {
    this.store.set(key, String(value));
  }

  removeItem(key) {
    this.store.delete(key);
  }
}

function fakeElement(dataset = {}) {
  return {
    dataset,
    textContent: '',
    placeholder: '',
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
}

globalThis.localStorage = new FakeStorage();
globalThis.document = {
  documentElement: { lang: '' },
};

const { LOCALES, getLocale, setLocale, t, applyStaticLocale } = await import('../public/i18n.js');

test('default locale is vi and t() returns the Vietnamese string', () => {
  assert.equal(getLocale(), 'vi');
  assert.equal(t('reset.button'), 'Reset phiên');
});

test('setLocale("en") switches the active locale and t() returns the English string', () => {
  setLocale('en');
  try {
    assert.equal(getLocale(), 'en');
    assert.equal(t('reset.button'), 'Reset session');
  } finally {
    setLocale('vi');
  }
});

test('t() interpolates placeholders from params', () => {
  assert.equal(t('session.messageCount', { count: 5 }), '5 tin');
  setLocale('en');
  try {
    assert.equal(t('session.messageCount', { count: 5 }), '5 msg');
  } finally {
    setLocale('vi');
  }
});

test('setLocale() with an unsupported locale is a no-op', () => {
  const before = getLocale();
  setLocale('fr');
  assert.equal(getLocale(), before);
  setLocale('invalid-locale');
  assert.equal(getLocale(), before);
});

test('getLocale() reflects the current locale across setLocale() calls', () => {
  setLocale('en');
  assert.equal(getLocale(), 'en');
  setLocale('vi');
  assert.equal(getLocale(), 'vi');
});

test('t() for a missing key falls back to the key itself', () => {
  assert.equal(t('this.key.does.not.exist'), 'this.key.does.not.exist');
});

test('t() persists the chosen locale to localStorage', () => {
  setLocale('en');
  try {
    assert.equal(globalThis.localStorage.getItem('kfc_dashboard_locale'), 'en');
  } finally {
    setLocale('vi');
  }
});

test('setLocale() updates document.documentElement.lang', () => {
  setLocale('en');
  try {
    assert.equal(globalThis.document.documentElement.lang, 'en');
  } finally {
    setLocale('vi');
  }
  assert.equal(globalThis.document.documentElement.lang, 'vi');
});

test('LOCALES exposes both supported locales', () => {
  assert.deepEqual(LOCALES, ['vi', 'en']);
});

test('applyStaticLocale() writes textContent, placeholder, and aria-label from the string table', () => {
  const textEl = fakeElement({ i18n: 'reset.button' });
  const placeholderEl = fakeElement({ i18nPlaceholder: 'handoff.composerPlaceholder' });
  const ariaEl = fakeElement({ i18nAriaLabel: 'handoff.composerAria' });

  const fakeRoot = {
    querySelectorAll(selector) {
      if (selector === '[data-i18n]') return [textEl];
      if (selector === '[data-i18n-placeholder]') return [placeholderEl];
      if (selector === '[data-i18n-aria-label]') return [ariaEl];
      return [];
    },
  };

  setLocale('vi');
  applyStaticLocale(fakeRoot);

  assert.equal(textEl.textContent, 'Reset phiên');
  assert.equal(placeholderEl.placeholder, 'Nhập tin nhắn gửi khách…');
  assert.equal(ariaEl.attributes['aria-label'], 'Tin nhắn gửi khách');
});

test('applyStaticLocale() reflects the currently active locale (en)', () => {
  const textEl = fakeElement({ i18n: 'reset.button' });
  const fakeRoot = {
    querySelectorAll(selector) {
      if (selector === '[data-i18n]') return [textEl];
      return [];
    },
  };

  setLocale('en');
  try {
    applyStaticLocale(fakeRoot);
    assert.equal(textEl.textContent, 'Reset session');
  } finally {
    setLocale('vi');
  }
});
