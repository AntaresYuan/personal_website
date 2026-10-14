import assert from 'node:assert/strict';
import { createA2uiCard, parseA2uiInteraction, interactionText } from '../src/a2ui.js';

let pass = 0;
const test = (name, fn) => {
  try { fn(); pass++; }
  catch (error) { console.error(`FAIL ${name}\n${error.stack}`); process.exitCode = 1; }
};

test('choice cards are bounded and normalized', () => {
  const result = createA2uiCard({
    type: 'choice', title: 'Choose a résumé', message: 'One detail first.',
    options: [
      { id: 'en', label: 'English' },
      { id: 'zh', label: 'Chinese' },
      { id: 'zh', label: 'Duplicate' },
    ],
  }, { cardId: 'AQ-1-UI1', limits: { maxOptions: 6 } });
  assert.equal(result.card.id, 'AQ-1-UI1');
  assert.equal(result.card.type, 'choice');
  assert.deepEqual(result.card.options.map((option) => option.id), ['en', 'zh']);
  assert.equal(result.message, 'One detail first.');
});

test('forms keep only supported, unique fields', () => {
  const result = createA2uiCard({
    type: 'form', title: 'A few details', fields: [
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'email', label: 'Again', type: 'script' },
      { name: 'date', label: 'Date', type: 'date' },
    ],
  }, { cardId: 'AQ-2-UI1' });
  assert.deepEqual(result.card.fields.map((field) => [field.name, field.type]), [['email', 'email'], ['date', 'date']]);
});

test('resource cards can only use resolved catalogue items', () => {
  let query = '';
  const result = createA2uiCard({ type: 'resource', title: 'Open a file', query: 'resume' }, {
    cardId: 'AQ-3-UI1',
    resolveResources: (value) => {
      query = value;
      return [{ kind: 'pdf', title: 'Résumé', url: '/media/resume.pdf' }];
    },
  });
  assert.equal(query, 'resume');
  assert.equal(result.card.resources[0].url, '/media/resume.pdf');
  assert.match(createA2uiCard({ type: 'resource', title: 'Invent one', query: 'missing' }, {
    cardId: 'AQ-4-UI1', resolveResources: () => [],
  }).error, /matched nothing/);
});

test('invalid cards fail closed', () => {
  assert.match(createA2uiCard({ type: 'choice', title: 'Only one', options: ['One'] }, { cardId: 'AQ-5-UI1' }).error, /two/);
  assert.match(createA2uiCard({ type: 'html', title: '<script>' }, { cardId: 'AQ-6-UI1' }).error, /type/);
});

test('submitted interactions are bounded and trace metadata omits values', () => {
  const interaction = parseA2uiInteraction({
    cardId: 'AQ-1-UI1', type: 'form', action: 'submit', title: 'Contact',
    values: { email: 'person@example.com', extra: ['one', 'two'] }, summary: 'Details submitted',
  });
  assert.deepEqual(interaction.trace, { cardId: 'AQ-1-UI1', type: 'form', action: 'submit', fields: ['email', 'extra'] });
  assert.doesNotMatch(JSON.stringify(interaction.trace), /person@example/);
  assert.match(interactionText(interaction), /email: person@example\.com/);
});

console.log(`qa a2ui: ${pass} passed, 0 failed`);
if (process.exitCode) process.exit(process.exitCode);
