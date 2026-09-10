/* Offline test of bearerOk against the REAL worker source.
   Auth is the one place where "looks right" isn't good enough: a mistake
   either locks the owner out or lets anyone write. So load the actual file,
   extract the real function, and drive it with every shape a request can
   take -- including the ones that used to throw or leak. */
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

// Pull out bearerOk verbatim rather than reimplementing it.
const start = src.indexOf('function bearerOk(');
if (start < 0) throw new Error('bearerOk not found — did it get renamed?');
// Find the matching close brace.
let depth = 0, end = -1;
for (let i = src.indexOf('{', start); i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const body = src.slice(start, end);
if (!/timingSafeEqual/.test(body)) {
  console.log('FAIL: bearerOk no longer uses timingSafeEqual');
  process.exit(1);
}
if (/m\[1\]\s*===\s*expected/.test(body)) {
  console.log('FAIL: bearerOk still uses a short-circuiting === compare');
  process.exit(1);
}
/* A behavioural test cannot catch an early `return false` on length
   mismatch: the answer is identical, only the timing differs, and that's
   precisely the leak. Mutation-tested and confirmed — swapping the
   compare-against-self for `return false` keeps all assertions green. So
   assert on the source instead, which is the only signal available here. */
if (/byteLength\s*!==[\s\S]{0,40}return\s+false/.test(body)) {
  console.log('FAIL: early return on length mismatch leaks the secret length');
  process.exit(1);
}
if (!/!\s*crypto\.subtle\.timingSafeEqual\(\s*got\s*,\s*got\s*\)/.test(body)) {
  console.log('FAIL: missing the compare-against-self branch for length mismatch');
  process.exit(1);
}

// Node has no crypto.subtle.timingSafeEqual, so provide one with the same
// contract: throws on length mismatch. If the code under test forgot the
// length guard, this stub makes it blow up exactly like production would.
// NOTE: Node already defines a global `crypto` (WebCrypto) whose `subtle`
// has no timingSafeEqual, and that global wins over a same-named function
// parameter is NOT true -- the parameter shadows it. The earlier failure was
// passing `global.crypto` (the real one) instead of the stub object.
const nodeCrypto = require('node:crypto');
const cryptoStub = {
  subtle: {
    timingSafeEqual(a, b) {
      if (a.byteLength !== b.byteLength) {
        throw new TypeError('Input buffers must have the same byte length');
      }
      return nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    },
  },
};
const bearerOk = new Function('TextEncoder', 'crypto',
  body + '; return bearerOk;')(TextEncoder, cryptoStub);

const req = h => ({ headers: { get: () => h } });
// A fabricated placeholder, NOT the real secret — verified rejected 401 by
// the live Worker. Same length as the real one on purpose, so the
// "wrong secret, same length" case exercises the full-compare path rather
// than falling into the length-mismatch branch.
const SECRET = 'r8Kq2wZpN4vXtL7mJhB3sDfG6yQaE9cU1oPiT5nRxYz';

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}` +
              (ok ? '' : ` — want ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`));
  ok ? pass++ : fail++;
}
function checkNoThrow(label, fn) {
  try { fn(); console.log(`  ok   ${label}`); pass++; }
  catch (e) { console.log(`  FAIL ${label} — threw ${e.name}: ${e.message}`); fail++; }
}

const env = { SHARED_SECRET: SECRET };

console.log('bearerOk — correctness');
check('exact secret → true', bearerOk(req(`Bearer ${SECRET}`), env), true);
check('lowercase scheme → true', bearerOk(req(`bearer ${SECRET}`), env), true);
check('wrong secret, same length → false',
  bearerOk(req('Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), env), false);
check('wrong secret, shorter → false', bearerOk(req('Bearer short'), env), false);
check('wrong secret, longer → false',
  bearerOk(req(`Bearer ${SECRET}${SECRET}`), env), false);
check('correct secret with trailing space → false',
  bearerOk(req(`Bearer ${SECRET} `), env), false);
check('no header → false', bearerOk(req(''), env), false);
check('scheme only → false', bearerOk(req('Bearer '), env), false);
check('wrong scheme → false', bearerOk(req(`Basic ${SECRET}`), env), false);
check('raw secret without scheme → false', bearerOk(req(SECRET), env), false);
check('prefix of the secret → false',
  bearerOk(req(`Bearer ${SECRET.slice(0, 40)}`), env), false);
check('secret plus one char → false', bearerOk(req(`Bearer ${SECRET}x`), env), false);

console.log('\nbearerOk — misconfiguration is distinguishable from rejection');
check('no SHARED_SECRET → null (→ 500, not 401)',
  bearerOk(req(`Bearer ${SECRET}`), {}), null);
check('empty SHARED_SECRET → null', bearerOk(req('Bearer x'), { SHARED_SECRET: '' }), null);

console.log('\nbearerOk — length mismatch must not throw (would become a 500)');
checkNoThrow('1-char token', () => bearerOk(req('Bearer a'), env));
checkNoThrow('very long token', () => bearerOk(req('Bearer ' + 'z'.repeat(5000)), env));
checkNoThrow('unicode token', () => bearerOk(req('Bearer 🔑🔑🔑'), env));

console.log('\nbearerOk — multibyte handled by byte length, not char count');
// 'é' is 2 bytes: a char-length check would call these equal and throw.
checkNoThrow('multibyte same char-count, different byte-count',
  () => bearerOk(req('Bearer ' + 'é'.repeat(43)), env));
check('  …and returns false', bearerOk(req('Bearer ' + 'é'.repeat(43)), env), false);

console.log(`\nbearer: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
