/* ─────────────────────────────────────────────────────────────────────────
   Build-time HTML helpers shared by build-html.js (the Work home page) and
   lib/personal-blocks.js (the lists Personal re-renders from content/*.json).

   Both pages are "template AND artifact": the build walks known element ids
   and swaps their innerHTML, so re-running with unchanged content produces an
   identical file.
   ───────────────────────────────────────────────────────────────────────── */

const escape = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

// Match the exact set of tags render.js's safeRich allows (em / strong / br)
const safeRich = (s) => escape(s).replace(/&lt;(\/?(em|strong|br)\s*\/?)&gt;/gi, '<$1>');

// Replace innerHTML of an element matched by `openRe`. The regex must
// capture the tag name as group 1. Walks the HTML balancing same-name
// opens/closes so nested same-tag elements (e.g. divs inside divs) are
// handled correctly — that matters on re-runs where the previous build
// already populated the container.
const replaceInnerOpenMatch = (html, openRe, content, label) => {
  const openMatch = openRe.exec(html);
  if (!openMatch) {
    console.warn(`[build] no element matched: ${label}`);
    return html;
  }
  const tagName = openMatch[1].toLowerCase();
  const contentStart = openMatch.index + openMatch[0].length;

  const openTagRe  = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const closeTagRe = new RegExp(`</${tagName}\\s*>`, 'gi');

  let depth = 1;
  let pos = contentStart;
  while (depth > 0) {
    openTagRe.lastIndex  = pos;
    closeTagRe.lastIndex = pos;
    const nextOpen  = openTagRe.exec(html);
    const nextClose = closeTagRe.exec(html);
    if (!nextClose) {
      console.warn(`[build] unterminated <${tagName}> for ${label}`);
      return html;
    }
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) {
        return html.slice(0, contentStart) + content + html.slice(nextClose.index);
      }
      pos = nextClose.index + nextClose[0].length;
    }
  }
  return html;
};

const replaceInner = (html, id, content) =>
  replaceInnerOpenMatch(
    html,
    new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)([^>]*\\sid=["']${id}["'][^>]*)>`, 'i'),
    content,
    `id="${id}"`
  );

// Set or replace an attribute on the element with the given id.
const setAttr = (html, id, attr, value) => {
  const re = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9]*)([^>]*\\sid=["']${id}["'][^>]*)>`,
    'i'
  );
  return html.replace(re, (m, tag, attrs) => {
    const attrRe = new RegExp(`\\s${attr}=["'][^"']*["']`);
    const newAttrs = attrRe.test(attrs)
      ? attrs.replace(attrRe, ` ${attr}="${value}"`)
      : attrs + ` ${attr}="${value}"`;
    return `<${tag}${newAttrs}>`;
  });
};

module.exports = { escape, safeRich, replaceInnerOpenMatch, replaceInner, setAttr };
