// Tests for pipeline/lib/oauth-state.js — the signed OAuth state and PKCE.
//
// The attack this exists to stop: someone gets a signed-in user to complete a
// consent flow whose state names the ATTACKER's member row (or vice versa),
// quietly attaching the wrong mailbox to the wrong ledger. Without a signature
// the state is just a URL parameter anyone can type.
//
// Run: node pipeline/oauth-state.test.js

const state = require('./lib/oauth-state.js');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };

const ENV = { OAUTH_STATE_SECRET: 'x'.repeat(48) };
const ENV_OTHER = { OAUTH_STATE_SECRET: 'y'.repeat(48) };
const CLAIMS = { uid: 'user-1', mid: 'member-1' };

console.log('\n-- round trip --');
{
  const s = state.createState(CLAIMS, ENV);
  const back = state.verifyState(s, ENV);
  t('claims survive', back.uid === 'user-1' && back.mid === 'member-1');
  t('carries an expiry', typeof back.exp === 'number' && back.exp > back.iat);
  t('two states of the same claims differ (nonce)', state.createState(CLAIMS, ENV) !== s);
}

console.log('\n-- tampering --');
{
  const s = state.createState(CLAIMS, ENV);
  const [body, mac] = s.split('.');

  const evil = Buffer.from(JSON.stringify({ uid: 'user-1', mid: 'SOMEONE-ELSE', iat: Date.now(), exp: Date.now() + 60000 }), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  t('REFUSES a re-pointed member id', throws(() => state.verifyState(evil + '.' + mac, ENV)));
  t('REFUSES an unsigned state', throws(() => state.verifyState(evil, ENV)));
  t('REFUSES a state signed with another secret', throws(() => state.verifyState(state.createState(CLAIMS, ENV_OTHER), ENV)));
  t('REFUSES a truncated mac', throws(() => state.verifyState(body + '.' + mac.slice(0, -4), ENV)));
  t('REFUSES junk', throws(() => state.verifyState('nonsense', ENV)));
  t('REFUSES empty', throws(() => state.verifyState('', ENV)));
  console.log('        ^ without these, a crafted callback attaches a mailbox to');
  console.log('          whichever member row the attacker names.');
}

console.log('\n-- expiry --');
{
  const now = 1_000_000_000_000;
  const s = state.createState(CLAIMS, ENV, now);
  t('valid inside the window', state.verifyState(s, ENV, now + 60_000).mid === 'member-1');
  t('REFUSES once expired', throws(() => state.verifyState(s, ENV, now + state.STATE_TTL_MS + 1)));
}

console.log('\n-- missing subject --');
{
  // A signed state that somehow carries no subject must still be refused —
  // signature valid is not the same as safe to act on.
  const body = Buffer.from(JSON.stringify({ iat: Date.now(), exp: Date.now() + 60000 }), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const crypto = require('crypto');
  const mac = crypto.createHmac('sha256', ENV.OAUTH_STATE_SECRET).update(body).digest()
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  t('REFUSES a validly-signed state with no uid/mid', throws(() => state.verifyState(body + '.' + mac, ENV)));
}

console.log('\n-- secret hygiene --');
{
  t('missing secret is a hard error', throws(() => state.createState(CLAIMS, {})));
  t('short secret is refused', throws(() => state.createState(CLAIMS, { OAUTH_STATE_SECRET: 'tooshort' })));
}

console.log('\n-- PKCE --');
{
  const p = state.createPkce();
  t('verifier and challenge differ', p.verifier !== p.challenge);
  t('challenge is S256 of the verifier', (() => {
    const crypto = require('crypto');
    const expect = crypto.createHash('sha256').update(p.verifier).digest()
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return p.challenge === expect;
  })());
  t('verifier is URL-safe', /^[A-Za-z0-9_-]+$/.test(p.verifier));
  t('two calls differ', state.createPkce().verifier !== p.verifier);

  const cookie = state.pkceCookie(p.verifier);
  t('cookie is httpOnly', /HttpOnly/.test(cookie));
  t('cookie is Secure', /Secure/.test(cookie));
  t('cookie is SameSite=Lax (survives the Google redirect)', /SameSite=Lax/.test(cookie));
  t('cookie is short-lived', /Max-Age=600/.test(cookie));
  t('reads back', state.readPkceCookie(cookie.split(';')[0]) === p.verifier);
  t('reads back among other cookies', state.readPkceCookie('a=1; ' + cookie.split(';')[0] + '; b=2') === p.verifier);
  t('absent cookie → null', state.readPkceCookie('a=1; b=2') === null);
  t('clearing expires it', /Max-Age=0/.test(state.clearPkceCookie()));
  console.log('        ^ the verifier never appears in a URL, so an intercepted');
  console.log('          authorization code cannot be redeemed on its own.');
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
