/* ─────────────────────────────────────────────────────────────────────────
   Work-only Ask Antares conversation cache.

   Messages are written to this browser's localStorage after every turn and
   expire after one hour without a new message. Nothing is synced to the site
   or loaded by Personal. Keeping this in a small standalone module makes the
   expiry and sanitisation rules testable without a browser.
   ───────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var KEY = 'antares.ask.history.v1';
  var VERSION = 1;
  var TTL = 60 * 60 * 1000;
  var MAX_MESSAGES = 40;
  var MAX_CONTENT = 10000;
  var SOURCE = { local: true, cloud: true, offline: true };

  var clean = function (messages) {
    if (!Array.isArray(messages)) return [];
    return messages.map(function (message) {
      if (!message || (message.role !== 'user' && message.role !== 'assistant')) return null;
      var content = String(message.content || '').trim().slice(0, MAX_CONTENT);
      if (!content) return null;
      var item = { role: message.role, content: content };
      if (message.role === 'assistant' && SOURCE[message.via]) item.via = message.via;
      if (message.role === 'assistant' && message.model) item.model = String(message.model).slice(0, 120);
      return item;
    }).filter(Boolean).slice(-MAX_MESSAGES);
  };

  var clear = function (storage) {
    try { (storage || root.localStorage).removeItem(KEY); } catch (e) { /* storage unavailable */ }
  };

  var load = function (storage, now) {
    var store = storage || root.localStorage;
    var clock = Number.isFinite(now) ? now : Date.now();
    try {
      var raw = store.getItem(KEY);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      var updatedAt = Number(saved && saved.updatedAt);
      if (!saved || saved.version !== VERSION || !Number.isFinite(updatedAt) ||
          clock - updatedAt >= TTL || updatedAt > clock + 60000) {
        clear(store);
        return null;
      }
      var messages = clean(saved.messages);
      if (!messages.length) {
        clear(store);
        return null;
      }
      return { messages: messages, updatedAt: updatedAt };
    } catch (e) {
      clear(store);
      return null;
    }
  };

  var save = function (messages, storage, now) {
    var store = storage || root.localStorage;
    var cleaned = clean(messages);
    if (!cleaned.length) {
      clear(store);
      return null;
    }
    var payload = {
      version: VERSION,
      updatedAt: Number.isFinite(now) ? now : Date.now(),
      messages: cleaned,
    };
    try { store.setItem(KEY, JSON.stringify(payload)); } catch (e) { return null; }
    return payload;
  };

  root.ASK_HISTORY = {
    key: KEY,
    ttl: TTL,
    load: load,
    save: save,
    clear: clear,
  };
})(window);
