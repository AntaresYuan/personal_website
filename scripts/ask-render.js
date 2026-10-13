/* ─────────────────────────────────────────────────────────────────────────
   Safe rich rendering for Ask Antares.

   Model text is untrusted. This tiny renderer supports only the pieces the
   assistant needs — paragraphs, simple lists, emphasis, inline code and
   links — and escapes everything else. Exact files and destinations arrive
   separately as structured resources and render as cards below the answer.
   ───────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var escape = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var safeUrl = function (raw) {
    var value = String(raw || '').trim();
    if (/^\/(?!\/)/.test(value) && !/[\u0000-\u001f\u007f]/.test(value)) return encodeURI(value);
    if (/^#[A-Za-z][\w:.-]*$/.test(value)) return value;
    if (/^mailto:[^\s@]+@[^\s@]+$/i.test(value)) return value;
    try {
      var url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : '';
    } catch (e) { return ''; }
  };

  var decorate = function (text) {
    return escape(text)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  };

  var inline = function (text) {
    var source = String(text || '');
    var pattern = /\[([^\]\n]{1,200})\]\(([^)\s]{1,1000})\)|(https?:\/\/[^\s<>{}\[\]]+)/gi;
    var out = '', cursor = 0, match;
    while ((match = pattern.exec(source))) {
      out += decorate(source.slice(cursor, match.index));
      var label = match[1] || match[3];
      var candidate = match[2] || match[3];
      var trailing = '';
      if (!match[1]) {
        var trimmed = candidate.replace(/[.,!?;:]+$/, '');
        trailing = candidate.slice(trimmed.length);
        candidate = trimmed;
      }
      var href = safeUrl(candidate);
      if (href) {
        var external = /^https?:/i.test(href);
        out += '<a href="' + escape(href) + '"' + (external ? ' target="_blank" rel="noopener"' : '') + '>' + escape(label.replace(/[.,!?;:]+$/, '')) + '</a>' + escape(trailing);
      } else {
        out += decorate(match[0]);
      }
      cursor = pattern.lastIndex;
    }
    return out + decorate(source.slice(cursor));
  };

  var markdown = function (text) {
    var blocks = String(text || '').replace(/\r\n?/g, '\n').trim().split(/\n{2,}/).filter(Boolean);
    return blocks.map(function (block) {
      var lines = block.split('\n');
      var unordered = lines.length && lines.every(function (line) { return /^\s*[-*]\s+/.test(line); });
      var ordered = lines.length && lines.every(function (line) { return /^\s*\d+[.)]\s+/.test(line); });
      if (unordered || ordered) {
        var tag = ordered ? 'ol' : 'ul';
        return '<' + tag + '>' + lines.map(function (line) {
          return '<li>' + inline(line.replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, '')) + '</li>';
        }).join('') + '</' + tag + '>';
      }
      return '<p>' + lines.map(inline).join('<br>') + '</p>';
    }).join('');
  };

  var ICON_FILE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.8h6.8l4.4 4.4v10.4a1.6 1.6 0 0 1-1.6 1.6H7a1.6 1.6 0 0 1-1.6-1.6V5.4A1.6 1.6 0 0 1 7 3.8Z"/><path d="M13.6 4v4.5h4.5M8.7 13h6.6M8.7 16h4.6"/></svg>';
  var ICON_LINK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 14.5 14.5 9.5M8.1 16.9l-1 .9a3.2 3.2 0 0 1-4.5-4.5l3.1-3.1a3.2 3.2 0 0 1 4.5 0M15.9 7.1l1-.9a3.2 3.2 0 0 1 4.5 4.5l-3.1 3.1a3.2 3.2 0 0 1-4.5 0"/></svg>';
  var ICON_IMAGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.8" y="5.2" width="16.4" height="13.6" rx="2.5"/><circle cx="9" cy="10" r="1.4"/><path d="m4.5 17 4.2-4.1 3.3 3.1 2.4-2.2 5.2 4.7"/></svg>';
  var ICON_ARROW = '<svg class="ask-resource-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5"/></svg>';

  var resources = function (items, labels) {
    if (!Array.isArray(items) || !items.length) return '';
    labels = labels || {};
    var cards = items.slice(0, 6).map(function (item) {
      var href = safeUrl(item && item.url);
      if (!href) return '';
      var kind = /^(pdf|image|page|link|data)$/.test(item.kind) ? item.kind : 'link';
      var icon = kind === 'image' ? ICON_IMAGE : (kind === 'pdf' ? ICON_FILE : ICON_LINK);
      var type = item.typeLabel || (kind === 'pdf' ? 'PDF' : kind === 'image' ? (labels.image || 'Image') : labels.link || 'Link');
      var title = String(item.title || href).slice(0, 180);
      var description = String(item.description || '').slice(0, 240);
      var external = /^https?:/i.test(href);
      return '<a class="ask-resource" data-kind="' + kind + '" href="' + escape(href) + '"' + (external || kind === 'pdf' ? ' target="_blank" rel="noopener"' : '') + '>' +
        '<span class="ask-resource-icon">' + icon + '</span>' +
        '<span class="ask-resource-copy"><strong>' + escape(title) + '</strong>' +
        '<span><b>' + escape(type) + '</b>' + (description ? ' · ' + escape(description) : '') + '</span></span>' + ICON_ARROW + '</a>';
    }).filter(Boolean).join('');
    return cards ? '<div class="ask-resources" aria-label="' + escape(labels.aria || 'Related resources') + '">' + cards + '</div>' : '';
  };

  root.ASK_RENDER = { escape: escape, safeUrl: safeUrl, markdown: markdown, resources: resources };
})(window);
