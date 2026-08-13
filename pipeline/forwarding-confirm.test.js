const fs=require('fs');
const src=fs.readFileSync(require('path').join(__dirname,'bank-email-pipeline.gs'),'utf8');
global.Logger={log:()=>{}};   // the extractor logs when it finds nothing; GAS-only global
eval(src.slice(src.indexOf('function extractForwardingConfirmLink'), src.indexOf('// ---------- Supabase REST helpers')));
// extractPlusTag delegates to extractPlusTags (a forwarding chain can stack several
// aliases in one header), so both are needed — slicing only the first four lines
// left extractPlusTags undefined and the test dead.
eval(src.slice(src.indexOf('function extractPlusTag('), src.indexOf('function markMailboxVerified')));

let pass=0,fail=0;
const t=(n,ok,d)=>{console.log((ok?'  PASS  ':'  FAIL  ')+n+(!ok&&d?'  -> '+d:''));ok?pass++:fail++;};
// extractForwardingConfirmLink takes a Gmail MESSAGE, not a string. The test used
// to pass raw strings, so every candidate body came back empty and the whole file
// reported null — passing a stub keeps it honest against the real signature.
const asMessage=(body)=>({getPlainBody:()=>body,getBody:()=>body});

// realistic Gmail confirmation HTML — includes decoy links that must NOT be followed
const REAL = `<div>trang.nguyen.wh@gmail.com has requested to automatically forward mail to your email address gichisreading+ab3kd9x2mq@gmail.com.
Confirmation code: 928374615<br>
To allow, click: <a href="https://mail.google.com/mail/vf-%5BANGjdJ8x%5D-abc123XYZ_9-tok">https://mail.google.com/mail/vf-%5BANGjdJ8x%5D-abc123XYZ_9-tok</a><br>
Or read our <a href="https://support.google.com/mail/answer/10957">help page</a> or
<a href="https://mail.google.com/mail/u/0/#settings">manage settings</a>.</div>`;

const link = extractForwardingConfirmLink(asMessage(REAL));
t('finds the vf- confirmation link', !!link && link.indexOf('vf-')>0, String(link));
t('ignores the support.google.com help link', !!link && link.indexOf('support.google.com')<0);
t('ignores the #settings link', !!link && link.indexOf('#settings')<0);
t('unescapes &amp; in the URL', extractForwardingConfirmLink(asMessage('x https://mail.google.com/mail/vf-A&amp;b=1 y'))==='https://mail.google.com/mail/vf-A&b=1');
t('returns null when there is no link', extractForwardingConfirmLink(asMessage('no links here at all'))===null);
t('does not match a non-vf gmail URL', extractForwardingConfirmLink(asMessage('https://mail.google.com/mail/u/0/#inbox'))===null);

// the +tag on the confirmation is what attributes it
t('extracts the alias from the To: header', extractPlusTag('gichisreading+ab3kd9x2mq@gmail.com')==='ab3kd9x2mq');
t('null when the address carries no tag', extractPlusTag('gichisreading@gmail.com')===null);

// ---- dispatch: confirmation vs transaction --------------------------------
// The search returns THREE kinds of mail, not two: labelled auto-forwards,
// unlabelled hand-forwards, and confirmations. Dispatching on "has no label =>
// confirmation" fed a real VCB transaction to the confirmation handler on
// 2026-08-13, which found no vf- link and dropped it. Sender is the only
// signal that actually distinguishes them.
eval(src.slice(src.indexOf('var FORWARDING_CONFIRM_SENDER'),src.indexOf('var FORWARDING_CONFIRM_SENDER')+80).split('\n')[0]);
eval(src.slice(src.indexOf('function extractEmailAddress'),src.indexOf('function normalizeSubjectTemplate')));
eval(src.slice(src.indexOf('function isForwardingConfirmationThread'),src.indexOf('function processOneMessage')));
const thread=(...froms)=>({getMessages:()=>froms.map(f=>({getFrom:()=>f}))});

t('Google confirmation is a confirmation',
  isForwardingConfirmationThread(thread('Gmail Team <forwarding-noreply@google.com>'))===true);
t('UNLABELLED hand-forward is a TRANSACTION, not a confirmation',
  isForwardingConfirmationThread(thread('Cao Hien <hiencao27110505@gmail.com>'))===false);
t('auto-forwarded bank mail is a transaction',
  isForwardingConfirmationThread(thread('<VCBDigibank@info.vietcombank.com.vn>'))===false);
t('a lookalike sender is not mistaken for Google',
  isForwardingConfirmationThread(thread('forwarding-noreply@google.com.evil.tld'))===false);
t('unreadable From: is treated as a transaction, not silently confirmed',
  isForwardingConfirmationThread({getMessages:()=>[{getFrom:()=>{throw new Error('boom')}}]})===false);

console.log('\n'+(fail===0?'ALL '+pass+' PASSED':pass+' passed, '+fail+' FAILED'));
process.exit(fail?1:0);
