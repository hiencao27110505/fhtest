#!/usr/bin/env node
/* Spaces ("Nhóm"), docs/specs/spaces-spec.md: the pure rules in
 * src/js-ui/15-spaces-core.js. Profile defaults, the split arithmetic, the
 * balance sum and the plan of rows a space puts into one member's own book.
 * `node tools/spaces-core.test.js`
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const R = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const ctx = { isVi: () => true, Math, Number, String, Object, Array };
vm.createContext(ctx);
vm.runInContext(R('src/js-ui/15-spaces-core.js'), ctx);
const F = ctx;
const J = (v) => JSON.parse(JSON.stringify(v));
const eq = (a, b) => assert.deepStrictEqual(J(a), J(b));   // rows come out of the vm's realm

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

/* ── profile ── */
t('an existing family (profile {}) keeps every switch it has today, Chia tiền off', () => {
  const p = F.fhSpaceProfileOf('family', {});
  eq(J(p), { preset: 'family', budget: true, split: false, moments: true, react: true, goals: true, ask: true, house: true, source: true, mode: 'chung' });
});
t('a friend space defaults to split, moments, reactions; chia; no source', () => {
  const p = F.fhSpaceProfileOf('friend', null);
  eq(J(p), { preset: 'friend', budget: false, split: true, moments: true, react: true, goals: false, ask: false, house: false, source: false, mode: 'chia' });
});
t('a switch in the profile wins over the preset; junk values are ignored', () => {
  const p = F.fhSpaceProfileOf('friend', { goals: true, react: false, house: 'yes', mode: 'chung' });
  assert.strictEqual(p.goals, true); assert.strictEqual(p.react, false); assert.strictEqual(p.house, false); assert.strictEqual(p.mode, 'chung');
});
t('with Chia tiền off the default mode can only be chung', () => {
  assert.strictEqual(F.fhSpaceProfileOf('friend', { split: false, mode: 'chia' }).mode, 'chung');
  assert.strictEqual(F.fhSpaceProfileOf('family', { split: true, mode: 'chia' }).mode, 'chia');
});
t('an unknown type reads as a friend space, never as a family', () => {
  assert.strictEqual(F.fhSpacePresetOf('trip', {}), 'friend');
  assert.strictEqual(F.fhSpacePresetOf('friend', { preset: 'other' }), 'other');
  assert.strictEqual(F.fhSpacePresetOf(undefined, {}), 'family');   // before the roster is read: nothing may change for a family
});

/* ── split ── */
t('equal among four: 1.240.000 → 310.000 each', () => {
  const r = F.fhSplitCompute({ amt: 1240, members: ['a', 'b', 'c', 'd'] });
  assert.ok(r.ok); eq(J(r.map), { a: 310, b: 310, c: 310, d: 310 });
  assert.strictEqual(r.out, 0); assert.strictEqual(r.inside, 1240); assert.strictEqual(r.parts, 4);
});
t('equal with a remainder: the last member takes the đồng left over, and the shares sum to the bill', () => {
  const r = F.fhSplitCompute({ amt: 100, members: ['a', 'b', 'c'] });
  eq(J(r.map), { a: 33.333, b: 33.333, c: 33.334 });
  assert.strictEqual(F.fhK3(r.map.a + r.map.b + r.map.c), 100);
});
t('a subset: only the ticked members get a share', () => {
  const r = F.fhSplitCompute({ amt: 600, members: ['a', 'b', 'c'] });
  eq(J(r.map), { a: 200, b: 200, c: 200 });
});
t('S32: three members, four shares → the space records 930.000, 310.000 is outside', () => {
  const r = F.fhSplitCompute({ amt: 1240, members: ['a', 'b', 'c'], parts: 4 });
  eq(J(r.map), { a: 310, b: 310, c: 310 });
  assert.strictEqual(r.out, 310); assert.strictEqual(r.inside, 930); assert.strictEqual(r.parts, 4);
  eq(J(F.fhSplitPayload(r, 1240)), { a: 310, b: 310, c: 310, _out: 310, _parts: 4, _bill: 1240 });
});
t('S32: three members, six shares → three outside shares', () => {
  const r = F.fhSplitCompute({ amt: 1240, members: ['a', 'b', 'c'], parts: 6 });
  assert.strictEqual(r.per, 206.667); assert.strictEqual(r.out, 619.999); assert.strictEqual(F.fhK3(r.inside + r.out), 1240);
});
t('parts below the member count is not a thing: it is raised to the member count', () => {
  assert.strictEqual(F.fhSplitCompute({ amt: 300, members: ['a', 'b', 'c'], parts: 2 }).parts, 3);
});
t('exact amounts: what is left over is the outside share', () => {
  const r = F.fhSplitCompute({ amt: 1000, members: ['a', 'b'], exact: { a: 400, b: 350 } });
  eq(J(r.map), { a: 400, b: 350 }); assert.strictEqual(r.out, 250); assert.strictEqual(r.inside, 750);
});
t('exact amounts above the bill are refused', () => {
  const r = F.fhSplitCompute({ amt: 500, members: ['a', 'b'], exact: { a: 400, b: 350 } });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.err, 'over');
});
t('no amount, or nobody ticked, is refused', () => {
  assert.strictEqual(F.fhSplitCompute({ amt: 0, members: ['a'] }).err, 'amount');
  assert.strictEqual(F.fhSplitCompute({ amt: 10, members: [] }).err, 'members');
});
t('a payload with no outside share carries no underscore keys', () => {
  const r = F.fhSplitCompute({ amt: 500, members: ['a', 'b'] });
  eq(Object.keys(F.fhSplitPayload(r, 500)).sort(), ['a', 'b']);
  eq(J(F.fhSplitMembers({ a: 1, _out: 2, b: 3 })), ['a', 'b']);
});

t('editing the amount of an equal split keeps it equal and sums to the new amount', () => {
  eq(F.fhSplitRescale({ a: 310, b: 310, c: 310 }, 1000), { a: 333.333, b: 333.333, c: 333.334 });
});
t('editing the amount of an exact split keeps the proportions', () => {
  eq(F.fhSplitRescale({ a: 400, b: 100 }, 1000), { a: 800, b: 200 });
});
t('an outside share scales with the edited amount, and the bill follows', () => {
  eq(F.fhSplitRescale({ a: 310, b: 310, c: 310, _out: 310, _parts: 4, _bill: 1240 }, 1860), { a: 620, b: 620, c: 620, _out: 620, _parts: 4, _bill: 2480 });
});
t('nothing to rescale: no members or no amount', () => {
  assert.strictEqual(F.fhSplitRescale({ _out: 5 }, 100), null);
  assert.strictEqual(F.fhSplitRescale({ a: 1 }, 0), null);
});

/* ── balances ── */
const M = [{ id: 'm1', name: 'Minh' }, { id: 'm2', name: 'Lan' }, { id: 'm3', name: 'Khoa' }, { id: 'm4', name: 'Vy' }];
const space = () => ({
  members: M,
  txns: [
    { id: 't1', date: '2026-11-22', amt: 500, note: 'Lẩu' },
    { id: 't2', date: '2026-11-19', amt: 1500, note: 'Sân' },
    { id: 't3', date: '2026-11-16', amt: 600, note: 'Phim' },
    { id: 't4', date: '2026-11-13', amt: 660, note: 'Quà' },
    { id: 't5', date: '2026-11-12', amt: 90, note: 'Chung, không ai nợ ai' },
  ],
  shares: {
    t1: { payer: 'm1', map: { m1: 125, m2: 125, m3: 125, m4: 125 } },
    t2: { payer: 'm1', map: { m1: 375, m2: 375, m3: 375, m4: 375 } },
    t3: { payer: 'm2', map: { m1: 200, m2: 200, m3: 200 } },
    t4: { payer: 'm3', map: { m1: 220, m2: 220, m3: 220 } },
  },
  settles: [],
});
t('balances are derived from raw rows and sum to zero; a Chung row moves nothing', () => {
  const b = F.fhSpaceBalancesOf(space());
  eq(b.map((x) => x.net), [1080, -320, -260, -500]);
  assert.strictEqual(b.reduce((a, x) => a + x.net, 0), 0);
});
t('who pays whom: three transfers to Minh, largest first', () => {
  const p = F.fhSpacePairwiseOf(F.fhSpaceBalancesOf(space()));
  eq(p.map((x) => [x.from.name, x.to.name, x.amt]), [['Vy', 'Minh', 500], ['Lan', 'Minh', 320], ['Khoa', 'Minh', 260]]);
});
t('a settle-up moves both sides; settling the proposed list squares the space', () => {
  const d = space();
  d.settles = F.fhSpacePairwiseOf(F.fhSpaceBalancesOf(d)).map((p, i) => ({ id: 's' + i, from: p.from.id, to: p.to.id, amt: p.amt, date: '2026-11-22' }));
  eq(F.fhSpaceBalancesOf(d).map((x) => x.net), [0, 0, 0, 0]);
  assert.strictEqual(F.fhSpacePairwiseOf(F.fhSpaceBalancesOf(d)).length, 0);
});
t('outside-share keys in a map never reach the balance sum', () => {
  const d = { members: M, txns: [{ id: 'x', amt: 930 }], shares: { x: { payer: 'm1', map: { m1: 310, m2: 310, m3: 310, _out: 310, _parts: 4, _bill: 1240 } } }, settles: [] };
  eq(F.fhSpaceBalancesOf(d).map((b) => b.net), [620, -310, -310, 0]);
});
t('an unreadable row is left out rather than counted as zero-or-garbage', () => {
  const d = space(); d.txns[0]._unreadable = true; d.txns[0].amt = null;
  assert.strictEqual(F.fhSpaceBalancesOf(d)[0].net, 1080 - 375);
});

/* ── link ids ── */
t('a link id is UUID-shaped, stable, and differs by role and by row', () => {
  const a = F.fhSpaceLinkId('abc:x');
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.strictEqual(a, F.fhSpaceLinkId('abc:x'));
  assert.notStrictEqual(a, F.fhSpaceLinkId('abc:l'));
  assert.notStrictEqual(a, F.fhSpaceLinkId('abd:x'));
});
t('no collisions across 20.000 row ids × 4 roles', () => {
  const seen = new Set();
  for (let i = 0; i < 20000; i++) for (const r of ['x', 'l', 'o', 's']) seen.add(F.fhSpaceLinkId('0b9c2f4e-7a11-4c3d-9e2f-' + String(i).padStart(12, '0') + ':' + r));
  assert.strictEqual(seen.size, 80000);
});

/* ── the book plan (spec section 12) ── */
const outsideSpace = () => ({ members: M, settles: [],
  txns: [{ id: 'q', date: '2026-11-22', amt: 930, note: 'Quán nướng', catId: 'c1' }],
  shares: { q: { payer: 'm1', map: { m1: 310, m2: 310, m3: 310, _out: 310, _parts: 4, _bill: 1240 } } } });
t('the payer: an expense for the share, a loan to the space for the rest, a loan for the outside share', () => {
  const p = F.fhSpaceBookPlan('F', 'm1', outsideSpace());
  eq(p.map((r) => [r.role, r.kind, r.amt, r.who]), [['x', 'expense', 310, null], ['l', 'loan', 620, '@space:F'], ['o', 'loan', 310, null]]);
  assert.strictEqual(p.reduce((a, r) => a + r.amt, 0), 1240);            // the four parts add back up to what left the account
});
t('a member who did not pay: an expense for the share and a borrowed loan, nothing else', () => {
  const p = F.fhSpaceBookPlan('F', 'm2', outsideSpace());
  eq(p.map((r) => [r.role, r.kind, r.amt, r.who]), [['x', 'expense', 310, null], ['l', 'loan', -310, '@space:F']]);
});
t('a member with no share in the row gets no rows', () => {
  assert.strictEqual(F.fhSpaceBookPlan('F', 'm4', outsideSpace()).length, 0);
});
t('a payer who did not eat: no expense, the whole inside amount is lent', () => {
  const d = { members: M, settles: [], txns: [{ id: 'z', date: '2026-11-01', amt: 600 }], shares: { z: { payer: 'm4', map: { m1: 200, m2: 200, m3: 200 } } } };
  eq(F.fhSpaceBookPlan('F', 'm4', d).map((r) => [r.role, r.amt]), [['l', 600]]);
});
t('a Chung row is not planned: the existing mirror owns it', () => {
  const d = space();
  assert.ok(!F.fhSpaceBookPlan('F', 'm1', d).some((r) => r.src === 't5'));
});
t('a settle-up is a repayment on each side with opposite signs, and nothing for bystanders', () => {
  const d = { members: M, txns: [], shares: {}, settles: [{ id: 's1', from: 'm2', to: 'm1', amt: 320, date: '2026-11-22' }] };
  eq(F.fhSpaceBookPlan('F', 'm2', d).map((r) => [r.kind, r.amt, r.who]), [['repayment', -320, '@space:F']]);
  eq(F.fhSpaceBookPlan('F', 'm1', d).map((r) => [r.kind, r.amt, r.who]), [['repayment', 320, '@space:F']]);
  assert.strictEqual(F.fhSpaceBookPlan('F', 'm3', d).length, 0);
});
t('the book alone gives the same net as the space: Σ loans − Σ repayments against @space', () => {
  const d = space();
  d.settles = [{ id: 's1', from: 'm2', to: 'm1', amt: 100, date: '2026-11-22' }];
  const bal = F.fhSpaceBalancesOf(d);
  M.forEach((m, i) => {
    const rows = F.fhSpaceBookPlan('F', m.id, d).filter((r) => r.who === '@space:F');
    const net = rows.reduce((a, r) => a + (r.kind === 'loan' ? r.amt : -r.amt), 0);
    assert.strictEqual(F.fhK3(net), bal[i].net, m.name);
  });
});
t('same input, same links: the pass is idempotent', () => {
  const a = F.fhSpaceBookPlan('F', 'm1', outsideSpace()).map((r) => r.link), b = F.fhSpaceBookPlan('F', 'm1', outsideSpace()).map((r) => r.link);
  eq(a, b); assert.strictEqual(new Set(a).size, a.length);
});

/* ── the diff ── */
t('diff: nothing in the book → insert everything', () => {
  const plan = F.fhSpaceBookPlan('F', 'm1', outsideSpace());
  const d = F.fhSpaceBookDiff(plan, [], null);
  assert.strictEqual(d.ins.length, 3); assert.strictEqual(d.upd.length, 0); assert.strictEqual(d.del.length, 0);
});
t('diff: the book already matches → nothing to do', () => {
  const plan = F.fhSpaceBookPlan('F', 'm1', outsideSpace());
  const have = plan.map((p, i) => ({ id: 'r' + i, link: p.link, kind: p.kind, amt: p.amt, date: p.date }));
  const d = F.fhSpaceBookDiff(plan, have, null);
  eq([d.ins.length, d.upd.length, d.del.length], [0, 0, 0]);
});
t('diff: an edited amount or date is rewritten', () => {
  const plan = F.fhSpaceBookPlan('F', 'm1', outsideSpace());
  const have = plan.map((p, i) => ({ id: 'r' + i, link: p.link, kind: p.kind, amt: i === 0 ? 300 : p.amt, date: i === 1 ? '2026-11-21' : p.date }));
  eq(F.fhSpaceBookDiff(plan, have, null).upd.map((u) => u.have.id), ['r0', 'r1']);
});
t('diff: a row whose space expense is gone is deleted, but never one older than the read covers', () => {
  const have = [{ id: 'old', link: 'L-old', kind: 'expense', amt: 50, date: '2026-01-05' }, { id: 'new', link: 'L-new', kind: 'expense', amt: 50, date: '2026-11-20' }];
  eq(F.fhSpaceBookDiff([], have, '2026-06-01').del.map((h) => h.id), ['new']);
  eq(F.fhSpaceBookDiff([], have, null).del.map((h) => h.id), ['old', 'new']);
});
t('diff: two rows on one link → the later one is removed', () => {
  const plan = F.fhSpaceBookPlan('F', 'm2', outsideSpace());
  const have = [{ id: 'a', link: plan[0].link, kind: 'expense', amt: 310, date: '2026-11-22' }, { id: 'b', link: plan[0].link, kind: 'expense', amt: 310, date: '2026-11-22' }];
  const d = F.fhSpaceBookDiff(plan, have, null);
  eq(d.del.map((h) => h.id), ['b']); assert.strictEqual(d.ins.length, 1);
});

/* ── the sentinel counterparty ── */
t('@space: is recognised and gives back its id; a person named like one is not', () => {
  assert.strictEqual(F.fhSpaceWho('abc'), '@space:abc');
  assert.strictEqual(F.fhIsSpaceWho('@space:abc'), true); assert.strictEqual(F.fhSpaceWhoFid('@space:abc'), 'abc');
  assert.strictEqual(F.fhIsSpaceWho('Lan'), false); assert.strictEqual(F.fhIsSpaceWho(null), false);
});
t('the split line', () => {
  assert.strictEqual(F.fhSplitLine({ map: { a: 310, b: 310, c: 310, _parts: 4 } }, 'a', (v) => v + 'k'), 'chia 4 · bạn 310k');
  assert.strictEqual(F.fhSplitLine({ map: { a: 200, b: 200 } }, 'z', (v) => v + 'k'), 'chia 2');
  assert.strictEqual(F.fhSplitLine(null, 'a'), '');
});

/* ── the key, sealed to one invitee ── */
const nacl = require(path.join(__dirname, '..', 'vendor', 'tweetnacl.js'));
ctx.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
ctx.atob = (s) => Buffer.from(s, 'base64').toString('binary');
ctx.unescape = unescape; ctx.escape = escape; ctx.encodeURIComponent = encodeURIComponent; ctx.decodeURIComponent = decodeURIComponent;
ctx.Uint8Array = Uint8Array; ctx.JSON = JSON;
const b64 = (u) => Buffer.from(u).toString('base64');
const FID = '0b9c2f4e-7a11-4c3d-9e2f-000000000001', CARD = 'FH-7K2M-Q9XD-4TNB-HW6C-AB12-CD34-EF';
const lan = nacl.box.keyPair(), khoa = nacl.box.keyPair();
t('sealed to Lan: Lan opens it and gets the card', () => {
  const s = F.fhSpaceSealMake(nacl, FID, 'Lan@Gmail.com ', CARD, b64(lan.publicKey));
  const r = F.fhSpaceSealOpen(nacl, s, lan.secretKey, FID);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.card, CARD); assert.strictEqual(r.email, 'lan@gmail.com');
});
t('the stored box holds no readable card, space id or email', () => {
  const s = F.fhSpaceSealMake(nacl, FID, 'lan@gmail.com', CARD, b64(lan.publicKey));
  assert.ok(!s.includes(CARD) && !s.includes(FID) && !/gmail/.test(s) && !/7K2M/.test(s));
  eq(Object.keys(JSON.parse(s)).sort(), ['c', 'e', 'n', 'p', 'v']);
});
t('nobody else can open it', () => {
  const s = F.fhSpaceSealMake(nacl, FID, 'lan@gmail.com', CARD, b64(lan.publicKey));
  eq(F.fhSpaceSealOpen(nacl, s, khoa.secretKey, FID), { ok: false, error: 'not_for_this_key' });
});
t('a box moved onto another space is refused', () => {
  const s = F.fhSpaceSealMake(nacl, FID, 'lan@gmail.com', CARD, b64(lan.publicKey));
  eq(F.fhSpaceSealOpen(nacl, s, lan.secretKey, '0b9c2f4e-7a11-4c3d-9e2f-000000000002'), { ok: false, error: 'other_space' });
});
t('tampered bytes and junk are refused, never thrown', () => {
  const o = JSON.parse(F.fhSpaceSealMake(nacl, FID, 'lan@gmail.com', CARD, b64(lan.publicKey)));
  const raw = Buffer.from(o.c, 'base64'); raw[5] ^= 1; o.c = raw.toString('base64');
  eq(F.fhSpaceSealOpen(nacl, JSON.stringify(o), lan.secretKey, FID), { ok: false, error: 'not_for_this_key' });
  eq(F.fhSpaceSealOpen(nacl, 'not json', lan.secretKey, FID), { ok: false, error: 'format' });
  eq(F.fhSpaceSealOpen(nacl, '{"v":2}', lan.secretKey, FID), { ok: false, error: 'format' });
});
t('two seals of the same card differ (fresh ephemeral key and nonce)', () => {
  assert.notStrictEqual(F.fhSpaceSealMake(nacl, FID, 'a@b.c', CARD, b64(lan.publicKey)), F.fhSpaceSealMake(nacl, FID, 'a@b.c', CARD, b64(lan.publicKey)));
});
t('a wrong-length public key is refused before anything is sealed', () => {
  assert.throws(() => F.fhSpaceSealMake(nacl, FID, 'a@b.c', CARD, b64(new Uint8Array(8))), /bad_pubkey/);
});
t('the confirmation code names the key: stable, 6 characters, different keys differ', () => {
  const a = F.fhSpaceKeyCode(b64(lan.publicKey));
  assert.match(a, /^[0-9A-F]{2}-[0-9A-F]{2}-[0-9A-F]{2}$/);
  assert.strictEqual(a, F.fhSpaceKeyCode(b64(lan.publicKey)));
  assert.notStrictEqual(a, F.fhSpaceKeyCode(b64(khoa.publicKey)));
  assert.strictEqual(JSON.parse(F.fhSpaceSealMake(nacl, FID, 'a@b.c', CARD, b64(lan.publicKey))).p, a);
});
t('an invite link is read from a URL, a bare fragment or pasted text around it', () => {
  const u = 'https://x.app/#fh-s=' + FID + '&fh-k=RkgtN0sy&fh-n=H%E1%BB%99i%20b%E1%BA%A1n%20th%C3%A2n';
  eq(F.fhSpaceLinkParse(u), { fid: FID, k: 'RkgtN0sy', name: 'Hội bạn thân' });
  eq(F.fhSpaceLinkParse('Vào nhóm nhé: ' + u + ' nha'), { fid: FID, k: 'RkgtN0sy', name: 'Hội bạn thân' });
  eq(F.fhSpaceLinkParse('#fh-s=' + FID.toUpperCase()), { fid: FID, k: null, name: '' });
  assert.strictEqual(F.fhSpaceLinkParse('https://x.app/#fh-k=RkgtN0sy'), null);   // a family card link is not a space invite
  assert.strictEqual(F.fhSpaceLinkParse(''), null);
});
t('in-app browsers are recognised; Safari, Chrome and a Telegram Safari sheet are not', () => {
  assert.strictEqual(F.fhInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Zalo iOS/24.10'), true);
  assert.strictEqual(F.fhInAppBrowser('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]'), true);
  assert.strictEqual(F.fhInAppBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A; wv) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36'), true);
  assert.strictEqual(F.fhInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), false);
  assert.strictEqual(F.fhInAppBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'), false);
});

console.log('\nspaces-core: ' + n + ' checks passed');
