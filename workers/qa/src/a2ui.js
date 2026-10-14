/* Structured, model-authored UI for Ask Antares.

   The model never writes HTML. It asks render_ui for one of the small card
   shapes below; the Worker validates and bounds every field, then the browser
   renders the resulting plain object. Submitted values come back as a
   separate, bounded interaction object on the next turn. */

const CARD_TYPES = new Set(['choice', 'form', 'confirm', 'resource']);
const FIELD_TYPES = new Set(['text', 'email', 'date', 'textarea', 'select']);
const ACTIONS = new Set(['submit', 'confirm', 'cancel']);

const text = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const id = (value, fallback = '') => {
  const clean = String(value == null ? '' : value).trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 48);
  return clean && !/^(?:__proto__|prototype|constructor)$/.test(clean) ? clean : fallback;
};

const optionsOf = (raw, limit) => {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).slice(0, limit).map((option, index) => {
    const source = typeof option === 'string' ? { label: option } : (option || {});
    const label = text(source.label || source.title || source.value, 80);
    const value = id(source.value || source.id || `option-${index + 1}`, `option-${index + 1}`);
    if (!label || seen.has(value)) return null;
    seen.add(value);
    const item = { id: value, label };
    const description = text(source.description, 140);
    if (description) item.description = description;
    return item;
  }).filter(Boolean);
};

const resourcesOf = (items) => (Array.isArray(items) ? items : []).slice(0, 6).map((resource) => {
  if (!resource || typeof resource !== 'object') return null;
  const url = text(resource.url, 1000);
  const title = text(resource.title, 180);
  if (!url || !title) return null;
  const kind = /^(pdf|image|page|link|data)$/.test(resource.kind) ? resource.kind : 'link';
  const item = { kind, title, url };
  const description = text(resource.description, 240);
  const typeLabel = text(resource.typeLabel, 40);
  if (description) item.description = description;
  if (typeLabel) item.typeLabel = typeLabel;
  return item;
}).filter(Boolean);

/* Returns { card, message } or { error }. resolveResources is deliberately
   injected: resource cards can contain only URLs from the Work catalogue. */
export function createA2uiCard(raw, { cardId, resolveResources, limits = {} } = {}) {
  const args = raw && typeof raw === 'object' ? raw : {};
  const type = CARD_TYPES.has(args.type) ? args.type : CARD_TYPES.has(args.kind) ? args.kind : '';
  if (!type) return { error: 'type must be choice, form, confirm, or resource' };
  const title = text(args.title, 100);
  if (!title) return { error: 'title is required' };

  const card = { version: 1, id: id(cardId, 'a2ui-card'), type, title };
  const body = text(args.body || args.description, 360);
  const submitLabel = text(args.submitLabel, 40);
  if (body) card.body = body;
  if (submitLabel) card.submitLabel = submitLabel;

  if (type === 'choice') {
    const options = optionsOf(args.options, Math.max(2, Math.min(8, Number(limits.maxOptions) || 6)));
    if (options.length < 2) return { error: 'choice requires at least two distinct options' };
    card.options = options;
    card.multiple = args.multiple === true;
  }

  if (type === 'form') {
    const seen = new Set();
    const fields = (Array.isArray(args.fields) ? args.fields : [])
      .slice(0, Math.max(1, Math.min(6, Number(limits.maxFields) || 4)))
      .map((field, index) => {
        const source = field && typeof field === 'object' ? field : {};
        const label = text(source.label, 80);
        const name = id(source.name || source.id || `field-${index + 1}`, `field-${index + 1}`);
        const fieldType = FIELD_TYPES.has(source.type) ? source.type : 'text';
        if (!label || seen.has(name)) return null;
        seen.add(name);
        const item = { name, label, type: fieldType, required: source.required === true };
        const placeholder = text(source.placeholder, 100);
        if (placeholder) item.placeholder = placeholder;
        if (fieldType === 'select') {
          const choices = optionsOf(source.options, 8);
          if (choices.length < 2) return null;
          item.options = choices;
        }
        return item;
      }).filter(Boolean);
    if (!fields.length) return { error: 'form requires at least one valid field' };
    card.fields = fields;
  }

  if (type === 'confirm') {
    const confirmLabel = text(args.confirmLabel, 40);
    const cancelLabel = text(args.cancelLabel, 40);
    if (confirmLabel) card.confirmLabel = confirmLabel;
    if (cancelLabel) card.cancelLabel = cancelLabel;
  }

  if (type === 'resource') {
    const query = text(args.query || args.resourceQuery, 200);
    const found = query && typeof resolveResources === 'function' ? resolveResources(query) : [];
    const resources = resourcesOf(found);
    if (!resources.length) return { error: 'resource query matched nothing in the Work catalogue' };
    card.resources = resources;
  }

  return { card, message: text(args.message, 240) };
}
export function parseA2uiInteraction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cardId = text(raw.cardId, 100);
  const type = CARD_TYPES.has(raw.type) ? raw.type : '';
  const action = ACTIONS.has(raw.action) ? raw.action : 'submit';
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(cardId) || !type) return null;
  const values = {};
  const source = raw.values && typeof raw.values === 'object' && !Array.isArray(raw.values) ? raw.values : {};
  for (const [key, value] of Object.entries(source).slice(0, 8)) {
    const name = id(key);
    if (!name) continue;
    if (Array.isArray(value)) values[name] = value.slice(0, 8).map((item) => text(item, 200)).filter(Boolean);
    else values[name] = text(value, 400);
  }
  const title = text(raw.title, 100);
  const summary = text(raw.summary, 500);
  return {
    cardId, type, action, values, ...(title ? { title } : {}), ...(summary ? { summary } : {}),
    trace: { cardId, type, action, fields: Object.keys(values) },
  };
}
export function interactionText(interaction) {
  if (!interaction) return '';
  const values = Object.entries(interaction.values).map(([key, value]) => {
    const shown = Array.isArray(value) ? value.join(', ') : value;
    return `${key}: ${shown || '(empty)'}`;
  }).join('\n');
  return [
    `Structured A2UI response to card ${interaction.cardId}${interaction.title ? ` (${interaction.title})` : ''}.`,
    `Action: ${interaction.action}.`,
    values ? `Values:\n${values}` : '',
  ].filter(Boolean).join('\n').slice(0, 1200);
}
