/* Offline tests for the comments Worker's pure helpers (src/lib.js):
   what a visitor may submit, what gets held for review, how Llama Guard's
   answer is read, and what the public API is allowed to reveal. */
import assert from 'node:assert/strict';
import {
  validateComment, reviewReasons, parseGuard, publicComment, pageOk, kindsOf, countsOf, newId, ID, VISITOR, clean,
} from '../src/lib.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}\n  ${e.message}`); }
};

const P = '^/blog/[a-z0-9-]+/$';
const ok = (over = {}) => validateComment({ page: '/blog/hello/', name: 'Mei', body: 'Lovely post.', ...over }, { pagePattern: P, ownerName: 'Antares' });

t('a plain comment passes', () => {
  const { value, error } = ok();
  assert.equal(error, undefined);
  assert.deepEqual(value, { page: '/blog/hello/', name: 'Mei', email: null, body: 'Lovely post.', parent: null, reasons: [] });
});
t('CJK text and emoji count as characters, not bytes', () => {
  assert.ok(ok({ name: '\u8881'.repeat(40) }).value);
  assert.equal(ok({ name: '\u8881'.repeat(41) }).error, 'name-too-long');
  assert.ok(ok({ body: '😀'.repeat(2000) }).value);
  assert.equal(ok({ body: '😀'.repeat(2001) }).error, 'body-too-long');
});
t('pages outside the pattern are refused', () => {
  for (const page of ['/', '/blog/', '/blog/../admin/', '/blog/Hello/', '/projects/x/', 'https://x.com/blog/a/', 42]) {
    assert.equal(ok({ page }).error, 'bad-page', String(page));
  }
  assert.equal(pageOk('/projects/a/', '^/(blog|projects)/[a-z0-9-]+/$'), true);
  assert.equal(pageOk('/blog/a/', '('), false);           // a broken pattern fails closed
});
t('names and bodies are required and trimmed', () => {
  assert.equal(ok({ name: '   ' }).error, 'name-required');
  assert.equal(ok({ body: '\n\n  ' }).error, 'body-required');
  assert.equal(ok({ name: '  Mei   Lin ' }).value.name, 'Mei Lin');
  assert.equal(ok({ body: 'a\n\n\n\n\nb  \n' }).value.body, 'a\n\nb');
});
t('a link in the name is refused; in the body it is held', () => {
  assert.equal(ok({ name: 'cheap.shop' }).error, 'name-has-link');
  assert.deepEqual(ok({ body: 'see https://spam.example' }).value.reasons, ['link']);
  assert.deepEqual(ok({ body: 'visit www.example' }).value.reasons, ['link']);
  assert.deepEqual(ok({ body: 'buy at best-deals.xyz now' }).value.reasons, ['link']);
  // Ordinary prose with dots is not a link.
  assert.deepEqual(ok({ body: 'I use Next.js and Node, e.g. for SSR. Version 2.0.' }).value.reasons, []);
});
t('the owner\'s name and long runs are held', () => {
  assert.deepEqual(ok({ name: 'antares' }).value.reasons, ['owner-name']);
  assert.deepEqual(ok({ body: 'wooooooooooooooooooow' }).value.reasons, ['repeat']);
  assert.deepEqual(reviewReasons({ name: 'A', body: 'hahaha' }, 'Antares'), []);
});
t('emails are optional but must look like one', () => {
  assert.equal(ok({ email: 'mei@example.com' }).value.email, 'mei@example.com');
  assert.equal(ok({ email: 'not-an-email' }).error, 'bad-email');
  assert.equal(ok({ email: '<x@y.z>' }).error, 'bad-email');
});
t('control, zero-width and bidi characters are stripped', () => {
  assert.equal(clean('a‮b​c\u0007d'), 'abcd');
  assert.equal(ok({ name: 'M​ei' }).value.name, 'Mei');
});
t('parent ids are checked', () => {
  assert.equal(ok({ parent: 'c_abcdefghijkl' }).value.parent, 'c_abcdefghijkl');
  assert.equal(ok({ parent: "c_1' OR 1=1" }).error, 'bad-parent');
});
t('non-objects are refused', () => {
  for (const v of [null, 'x', [1], 3]) assert.equal(validateComment(v, { pagePattern: P }).error, 'bad-json');
});
t('Llama Guard: object, text and junk answers', () => {
  assert.deepEqual(parseGuard({ response: { safe: true } }), { safe: true, categories: [] });
  assert.deepEqual(parseGuard({ response: { safe: false, categories: ['S10'] } }), { safe: false, categories: ['S10'] });
  assert.deepEqual(parseGuard({ response: 'safe' }), { safe: true, categories: [] });
  assert.deepEqual(parseGuard('unsafe\nS1,S10'), { safe: false, categories: ['S1', 'S10'] });
  assert.equal(parseGuard(undefined).safe, false);
  assert.equal(parseGuard({ response: 'maybe' }).safe, false);
});
t('the public shape never carries email or ip', () => {
  const row = { id: 'c_abcdefghijkl', page: '/blog/a/', parent: null, name: 'Mei', email: 'm@x.io', body: 'hi', status: 'published', owner: 0, ip_hash: 'ff', created_at: 1 };
  const pub = publicComment(row);
  assert.deepEqual(Object.keys(pub).sort(), ['at', 'body', 'id', 'name', 'owner', 'parent']);
  assert.equal(JSON.stringify(pub).includes('m@x.io'), false);
});
t('reaction kinds come from the env, with a safe default', () => {
  assert.deepEqual(kindsOf({ REACTIONS: 'like, love ,BAD,x' }), ['like', 'love']);
  assert.deepEqual(kindsOf({}), ['like', 'love', 'insight', 'fun']);
  assert.deepEqual(countsOf([{ kind: 'like', n: 3 }, { kind: 'evil', n: 9 }], ['like', 'love']), { like: 3, love: 0 });
});
t('ids and visitor ids have the expected shape', () => {
  for (let i = 0; i < 200; i++) assert.match(newId(), ID);
  assert.match('abcdefghijklmnop', VISITOR);
  assert.doesNotMatch('short', VISITOR);
});

console.log(`comments: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
