// Tests for pipeline/lib/token-crypto.js — the refresh-token envelope.
//
// The point of these is not "does AES work" (it does). It is that every way a
// stolen or relocated ciphertext could be turned into working mailbox access
// is executable here and fails.
//
// Run: node pipeline/token-crypto.test.js

const crypto = require('crypto');
const tc = require('./lib/token-crypto.js');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };

const K1 = crypto.randomBytes(32).toString('base64');
const K2 = crypto.randomBytes(32).toString('base64');
const ENV = { MAILBOX_TOKEN_KEY: `k1:${K1}` };
const ENV_ROTATED = { MAILBOX_TOKEN_KEY: `k2:${K2},k1:${K1}` };
const ENV_OTHER = { MAILBOX_TOKEN_KEY: `k1:${crypto.randomBytes(32).toString('base64')}` };

const TOKEN = '1//09xR3fAkeReFrEsHtOkEnValue-notreal';
const BIND = { connectionId: 'c0ffee00-0000-4000-8000-000000000001', memberId: 'beef0000-0000-4000-8000-000000000002' };

console.log('\n-- round trip --');
{
  const sealed = tc.sealToken(TOKEN, BIND, ENV);
  t('opens back to the same token', tc.openToken(sealed, BIND, ENV) === TOKEN);
  t('envelope is versioned and key-tagged', /^v1\.k1\./.test(sealed), sealed.slice(0, 24));
  t('plaintext does not appear in the envelope', sealed.indexOf(TOKEN) === -1);
  t('member/connection ids are NOT stored in the envelope',
    sealed.indexOf(BIND.connectionId) === -1 && sealed.indexOf(BIND.memberId) === -1);

  const again = tc.sealToken(TOKEN, BIND, ENV);
  t('same token seals differently every time (fresh IV)', again !== sealed);
  t('...and both still open', tc.openToken(again, BIND, ENV) === TOKEN);
}

console.log('\n-- row binding: a ciphertext is useless anywhere but its own row --');
{
  const sealed = tc.sealToken(TOKEN, BIND, ENV);
  t('REFUSES a different connection row',
    throws(() => tc.openToken(sealed, { ...BIND, connectionId: 'c0ffee00-0000-4000-8000-00000000dead' }, ENV)));
  t('REFUSES a different member',
    throws(() => tc.openToken(sealed, { ...BIND, memberId: 'beef0000-0000-4000-8000-00000000dead' }, ENV)));
  t('REFUSES a different purpose', throws(() => tc.openToken(sealed, { ...BIND, purpose: 'something_else' }, ENV)));
  console.log('        ^ an operator who can UPDATE mailbox_connections cannot move');
  console.log('          one user\'s token onto their own row and sync someone else\'s mail.');
}

console.log('\n-- database-only attacker gets nothing --');
{
  const sealed = tc.sealToken(TOKEN, BIND, ENV);
  t('REFUSES a different key (DB dump without the env)', throws(() => tc.openToken(sealed, BIND, ENV_OTHER)));

  const parts = sealed.split('.');
  const body = Buffer.from(parts[3].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  body[2] ^= 0x01;
  const flipped = [parts[0], parts[1], parts[2], body.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')].join('.');
  t('REFUSES a flipped ciphertext byte', throws(() => tc.openToken(flipped, BIND, ENV)));

  const ivParts = sealed.split('.');
  ivParts[2] = Buffer.from(crypto.randomBytes(12)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  t('REFUSES a swapped IV', throws(() => tc.openToken(ivParts.join('.'), BIND, ENV)));
}

console.log('\n-- malformed input is refused, never half-accepted --');
{
  t('empty', throws(() => tc.openToken('', BIND, ENV)));
  t('not an envelope', throws(() => tc.openToken('just-a-string', BIND, ENV)));
  t('too few parts', throws(() => tc.openToken('v1.k1.abc', BIND, ENV)));
  t('unknown version', throws(() => tc.openToken('v9.k1.abc.def', BIND, ENV)));
  t('unknown key id', throws(() => tc.openToken('v1.k9.abc.def', BIND, ENV)));
  t('truncated body', throws(() => tc.openToken('v1.k1.AAAAAAAAAAAAAAAA.AAAA', BIND, ENV)));
  t('sealing requires a binding', throws(() => tc.sealToken(TOKEN, {}, ENV)));
  t('sealing requires a token', throws(() => tc.sealToken('', BIND, ENV)));
}

console.log('\n-- key configuration --');
{
  t('missing key is a hard error, not a silent plaintext fallback', throws(() => tc.sealToken(TOKEN, BIND, {})));
  t('short key is rejected', throws(() => tc.sealToken(TOKEN, BIND, { MAILBOX_TOKEN_KEY: 'k1:' + Buffer.from('too short').toString('base64') })));
  t('malformed entry is rejected', throws(() => tc.sealToken(TOKEN, BIND, { MAILBOX_TOKEN_KEY: 'nokeyid' })));
  t('generated key is the right size', Buffer.from(tc.generateKey(), 'base64').length === 32);
}

console.log('\n-- rotation --');
{
  const oldSealed = tc.sealToken(TOKEN, BIND, ENV);              // sealed under k1
  t('old ciphertext still opens during the rotation window', tc.openToken(oldSealed, BIND, ENV_ROTATED) === TOKEN);
  t('...and is flagged for re-sealing', tc.needsResealing(oldSealed, ENV_ROTATED) === true);

  const newSealed = tc.sealToken(TOKEN, BIND, ENV_ROTATED);      // primary is now k2
  t('new writes use the primary key', /^v1\.k2\./.test(newSealed));
  t('...and are not flagged', tc.needsResealing(newSealed, ENV_ROTATED) === false);
  t('re-sealed token opens', tc.openToken(newSealed, BIND, ENV_ROTATED) === TOKEN);

  t('needsResealing never throws on junk', tc.needsResealing('garbage', ENV_ROTATED) === false);
  t('once the old key is retired, old ciphertext is dead',
    throws(() => tc.openToken(oldSealed, BIND, { MAILBOX_TOKEN_KEY: `k2:${K2}` })));
  console.log('        ^ retiring a key does NOT revoke access — the token still works at');
  console.log('          Google. A suspected key loss means revoking at Google too.');
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
