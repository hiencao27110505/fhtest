const fs=require('fs');
const src=fs.readFileSync(require('path').join(__dirname,'bank-email-pipeline.gs'),'utf8');
// load just the auth helpers + their deps
const start=src.indexOf('function senderAuthEnforced');
const end=src.indexOf('// ---------- Stage 2 helpers ----------');
let _props={};
global.PropertiesService={getScriptProperties:()=>({getProperty:k=>_props[k]||null})};
global.Logger={log:()=>{}};
let MAILBOX=null;
global.resolveMailbox=()=>MAILBOX;
// hand-forward detection calls extractEmailAddress, which lives further up
eval(src.slice(src.indexOf('function extractEmailAddress'),src.indexOf('function normalizeSubjectTemplate')));
eval(src.slice(start,end));

let pass=0,fail=0;
const t=(n,ok,d)=>{console.log((ok?'  PASS  ':'  FAIL  ')+n+(!ok&&d?'  -> '+d:''));ok?pass++:fail++;};
const msg=(hdrs)=>({getHeader:n=>hdrs[n]||''});

MAILBOX={personal_email:'trang.nguyen.wh@gmail.com',member_id:'m1'};
const GOOD={'Authentication-Results':'mx.google.com; dkim=pass header.i=@mbbank.com.vn header.d=mbbank.com.vn header.b=abc; spf=fail','X-Forwarded-For':'trang.nguyen.wh@gmail.com gichisreading+8f2c1@gmail.com'};

console.log('\n-- must PASS (real forwarded bank mail) --');
let r=checkSenderAuthenticity(msg(GOOD),'mbebanking@mbbank.com.vn');
t('genuine DKIM + matching forwarder', r.ok===true, JSON.stringify(r.reasons));
t('note SPF fails on forwarded mail and we ignore it', r.dkim==='pass');

// subdomain sender, parent-domain signature — legitimate
r=checkSenderAuthenticity(msg({...GOOD,'Authentication-Results':'dkim=pass header.d=mbbank.com.vn'}),'noreply@mail.mbbank.com.vn');
t('parent-domain signature accepted (subdomain sender)', r.dkim==='pass', r.reasons.join());

console.log('\n-- must FAIL (the attacks this exists for) --');
r=checkSenderAuthenticity(msg({'Authentication-Results':'dkim=none','X-Forwarded-For':'trang.nguyen.wh@gmail.com'}),'mbebanking@mbbank.com.vn');
t('forged bank email, unsigned', r.ok===false && r.dkim==='fail');

r=checkSenderAuthenticity(msg({'Authentication-Results':'dkim=pass header.d=evil.com','X-Forwarded-For':'trang.nguyen.wh@gmail.com'}),'mbebanking@mbbank.com.vn');
t('signed by the wrong domain', r.ok===false && r.dkim==='misaligned');

r=checkSenderAuthenticity(msg({'Authentication-Results':'dkim=pass header.d=mbbank.com.vn'}),'mbebanking@mbbank.com.vn');
t('posted straight at the alias (no forwarder)', r.ok===false && r.forwarder==='absent');

r=checkSenderAuthenticity(msg({...GOOD,'X-Forwarded-For':'someone.else@gmail.com'}),'mbebanking@mbbank.com.vn');
t('forwarded by an account the alias does not belong to', r.ok===false && r.forwarder==='mismatch');

console.log('\n-- lookalike domain (the sneaky one) --');
r=checkSenderAuthenticity(msg({...GOOD,'Authentication-Results':'dkim=pass header.d=notmbbank.com.vn'}),'x@notmbbank.com.vn');
t('attacker-owned lookalike is DKIM-valid for ITS OWN domain', r.dkim==='pass');
console.log('        ^ expected: DKIM proves the domain, not that it is the real bank —');
console.log('          known_provider_domains is what pins WHICH domain is MB Bank.');

console.log('\n-- hand-forward (a person pressing Forward, not Gmail auto-forwarding) --');
// Gmail signs the forwarder's own outbound mail, and the sender IS the forwarder,
// so DKIM legitimately passes — while proving nothing about the bank.
const HAND={'Authentication-Results':'mx.google.com; dkim=pass header.i=@gmail.com header.d=gmail.com'};
r=checkSenderAuthenticity(msg(HAND),'Trang <trang.nguyen.wh@gmail.com>');
t('recognised as a hand-forward, not a generic missing header', r.forwarder==='manual', JSON.stringify(r));
t('forward_mode records it', r.forward_mode==='manual');
t('DKIM still reports pass — the trap this exists to label', r.dkim==='pass');
t('but it is recorded as authenticating the forwarder, not the bank', r.dkim_authenticates==='forwarder_not_bank');
t('so it does NOT count as authenticated', r.ok===false);

// Somebody else's hand-forward is not the owner's, and must not be excused.
r=checkSenderAuthenticity(msg(HAND),'stranger@gmail.com');
t('a stranger posting at the alias is not treated as a hand-forward', r.forwarder==='absent' && r.forward_mode==='unknown', JSON.stringify(r));

r=checkSenderAuthenticity(msg(GOOD),'mbebanking@mbbank.com.vn');
t('real auto-forwarded mail is still forward_mode=auto', r.forward_mode==='auto' && r.ok===true);

console.log('\n-- enforcement flag --');
t('advisory by default', senderAuthEnforced()===false);
_props.SENDER_AUTH_ENFORCE='true';
t('enforces when set', senderAuthEnforced()===true);

console.log('\n'+(fail===0?'ALL '+pass+' PASSED':pass+' passed, '+fail+' FAILED'));
process.exit(fail?1:0);
