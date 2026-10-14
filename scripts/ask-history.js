/* ─────────────────────────────────────────────────────────────────────────
   Work-only Ask Antares conversation cache.

   Messages are written to this browser's localStorage after every turn and
   expire after one hour without a new message. Nothing is synced to the site
   or loaded by Personal. Keeping this in a small standalone module makes the
   expiry and sanitisation rules testable without a browser.
   ───────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var KEY = 'antares.ask.history.v2';
  var VERSION = 2;
  var TTL = 60 * 60 * 1000;
  var MAX_MESSAGES = 40;
  var MAX_CONTENT = 10000;
  var MAX_RESOURCES = 6;
  var MAX_UI = 2;
  var SOURCE = { local: true, cloud: true, tool: true, offline: true };
  var RESOURCE_KIND = { pdf: true, image: true, page: true, link: true, data: true };

  var cleanResource = function (resource) {
    if (!resource || typeof resource !== 'object') return null;
    var url = String(resource.url || '').trim().slice(0, 1000);
    if (/^\/(?!\/)/.test(url) && !/[\u0000-\u001f\u007f]/.test(url)) {
      try { url = encodeURI(decodeURI(url)).replace(/\(/g, '%28').replace(/\)/g, '%29'); } catch (e) { return null; }
    }
    else if (!/^https?:\/\/[^\s]+$/i.test(url)) return null;
    var title = String(resource.title || '').trim().slice(0, 180);
    if (!title) return null;
    var kind = RESOURCE_KIND[resource.kind] ? resource.kind : 'link';
    var item = { kind: kind, title: title, url: url };
    var description = String(resource.description || '').trim().slice(0, 240);
    var typeLabel = String(resource.typeLabel || '').trim().slice(0, 40);
    if (description) item.description = description;
    if (typeLabel) item.typeLabel = typeLabel;
    return item;
  };

  var cleanOption = function (option) {
    if (!option || typeof option !== 'object') return null;
    var optionId = String(option.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
    var label = String(option.label || '').trim().slice(0, 80);
    if (!optionId || !label) return null;
    var item = { id: optionId, label: label };
    var description = String(option.description || '').trim().slice(0, 140);
    if (description) item.description = description;
    return item;
  };

  var cleanUi = function (card) {
    if (!card || card.version !== 1 || !/^(choice|form|confirm|resource)$/.test(card.type)) return null;
    var cardId = String(card.id || '').trim().slice(0, 100);
    var title = String(card.title || '').trim().slice(0, 100);
    if (!cardId || !title) return null;
    var item = { version: 1, id: cardId, type: card.type, title: title };
    ['body', 'submitLabel', 'confirmLabel', 'cancelLabel'].forEach(function (key) {
      var limit = key === 'body' ? 360 : 40;
      var value = String(card[key] || '').trim().slice(0, limit);
      if (value) item[key] = value;
    });
    if (card.type === 'choice') {
      item.options = (Array.isArray(card.options) ? card.options : []).map(cleanOption).filter(Boolean).slice(0, 8);
      if (item.options.length < 2) return null;
      if (card.multiple === true) item.multiple = true;
    }
    if (card.type === 'form') {
      item.fields = (Array.isArray(card.fields) ? card.fields : []).slice(0, 6).map(function (field) {
        if (!field || typeof field !== 'object') return null;
        var name = String(field.name || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
        var label = String(field.label || '').trim().slice(0, 80);
        if (!name || !label) return null;
        var type = /^(email|date|textarea|select)$/.test(field.type) ? field.type : 'text';
        var out = { name: name, label: label, type: type, required: field.required === true };
        var placeholder = String(field.placeholder || '').trim().slice(0, 100);
        if (placeholder) out.placeholder = placeholder;
        if (type === 'select') out.options = (Array.isArray(field.options) ? field.options : []).map(cleanOption).filter(Boolean).slice(0, 8);
        return out;
      }).filter(Boolean);
      if (!item.fields.length) return null;
    }
    if (card.type === 'resource') {
      item.resources = (Array.isArray(card.resources) ? card.resources : []).map(cleanResource).filter(Boolean).slice(0, MAX_RESOURCES);
      if (!item.resources.length) return null;
    }
    if (card.submitted === true) {
      item.submitted = true;
      item.summary = String(card.summary || '').trim().slice(0, 300);
    }
    return item;
  };

  var clean = function (messages) {
    if (!Array.isArray(messages)) return [];
    return messages.map(function (message) {
      if (!message || (message.role !== 'user' && message.role !== 'assistant')) return null;
      var content = String(message.content || '').trim().slice(0, MAX_CONTENT);
      if (!content) return null;
      var item = { role: message.role, content: content };
      if (message.role === 'assistant' && SOURCE[message.via]) item.via = message.via;
      if (message.role === 'assistant' && message.model) item.model = String(message.model).slice(0, 120);
      if (message.role === 'assistant' && /^AQ-[A-Z0-9-]{8,40}$/.test(String(message.traceId || ''))) item.traceId = String(message.traceId);
      if (message.role === 'assistant' && Array.isArray(message.resources)) {
        var resources = message.resources.map(cleanResource).filter(Boolean).slice(0, MAX_RESOURCES);
        if (resources.length) item.resources = resources;
      }
      if (message.role === 'assistant' && Array.isArray(message.ui)) {
        var ui = message.ui.map(cleanUi).filter(Boolean).slice(0, MAX_UI);
        if (ui.length) item.ui = ui;
      }
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
