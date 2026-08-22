const { createClient } = window.supabase;   // vendored UMD global (see preload in <head>)

// Public config — publishable key + Google Client ID are safe to ship (RLS protects data).
const SUPABASE_URL = 'https://iizyukzfsbdkbrgfupwq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KQnm-h0bn3gCa1i_dlkapw_7b8kPRDD';
const GOOGLE_CLIENT_ID = '860668973723-ud2mbr4kj9nb41elbkvlp3lt5fibpf8v.apps.googleusercontent.com';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
window.sb = sb;

// supabase-js resolves { data, error } on HTTP 4xx (it does NOT throw), so a bare
// `try { await sb.rpc(...) } catch` silently misses DB errors and reports false success.
// Unwrap here so every caller's try/catch behaves as intended.
async function _rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; }

const g = (id) => document.getElementById(id);

// ---- returning-user resume (see the gate script in <head>) ----
const _resuming = () => document.documentElement.classList.contains('fh-resume');
// We got in: remember it, so the next cold start paints the splash, not sign-in.
function fhResumeArm() { try { localStorage.setItem('fh-resume', '1'); } catch (e) { } }
// Data is on screen: retire the splash.
function fhResumeDone() {
  clearTimeout(window.__fhResumeWatch);
  const s = g('fh-splash'); if (!s) return;
  s.classList.add('gone');
  setTimeout(() => { s.remove(); document.documentElement.classList.remove('fh-resume'); }, 300);
}
// Warm start was wrong (no session / no family): the cached screen has to go, and
// onboarding — which the warm start hid — has to come back, or there's no way to sign in.
function fhWarmAbandon() {
  // fh-fam/fh-onboarded are a second, independent warm cache (read by obInit()
  // before any session check) — leaving them behind after sign-out let a
  // previous account's family name/members render on the next cold start,
  // on a device where two accounts actually sign in and out of the same app.
  try { if (window.fhSnapClear) window.fhSnapClear(); else localStorage.removeItem('fh-snap'); localStorage.removeItem('fh-fam'); localStorage.removeItem('fh-onboarded'); } catch (e) { }
  document.documentElement.classList.remove('fh-warm', 'fh-stale', 'fh-warm-boot');
  const onb = g('onboarding'); if (onb) onb.classList.remove('done');
}
// The session was NOT there after all (expired / signed out elsewhere) — drop the
// optimistic flag and hand the screen back to onboarding.
function fhResumeFail() {
  clearTimeout(window.__fhResumeWatch);
  try { localStorage.removeItem('fh-resume'); } catch (e) { }
  document.documentElement.classList.remove('fh-resume');
  const s = g('fh-splash'); if (s) s.remove();
}

// Continue once we have a session (no redirect — we never left the app).
async function afterLogin(session) {
  if (!session) return;
  window.fhUser = session.user;
  // Device gate (trust rec #6): a remotely-revoked device signs itself out right
  // here, before any family data loads. Fail-open on any error so a transient
  // check failure never strands a legitimate user. Registers this device + arms
  // its foreground revocation heartbeat on the way through.
  try { if (window.fhDeviceCheck && (await window.fhDeviceCheck()) === false) return; } catch (e) { }
  // Per-member language preference: seed from the profile so a member's choice follows
  // them to a new device. The in-app switcher (Settings → Language) writes both this and
  // localStorage 'fh-lang'; the hydrate reads localStorage, so keep them in sync here.
  try {
    const { data: _pl } = await sb.from('profiles').select('language').eq('id', session.user.id).maybeSingle();
    if (_pl && (_pl.language === 'vi' || _pl.language === 'en')) { window.LANG = _pl.language; try { localStorage.setItem('fh-lang', _pl.language); } catch (e) { } }
  } catch (e) { }
  try {
    const md = session.user.user_metadata || {};
    if (window.FAM) {
      window.FAM.user.email = session.user.email || '';
      const nm = md.full_name || md.name || '';
      if (nm && !window.FAM.user.name) window.FAM.user.name = nm;
    }
  } catch (e) { }
  // Multi-family: which families do you belong to?
  // A transient failure here must not read as "no families" — that would send an
  // existing user into onboarding and have them create a duplicate family.
  let fams = [], famsErr = null;
  try { fams = (await _rpc('my_families')) || []; }
  catch (e) { famsErr = e; console.warn('my_families failed', e); }
  if (famsErr) {
    fhResumeFail(); fhWarmAbandon();
    window.toast && window.toast(_friendly(famsErr));
    return;
  }
  const onb = g('onboarding');
  const active = fams.find((f) => f.is_active);
  if (active) {
    if (onb) onb.classList.add('done');
    // Authoritative active family, straight from the server. Seeding it here
    // saves loadFamilyData() a profiles round trip, and overwriting (rather
    // than defaulting) means a warm boot whose snapshot carries a stale fid —
    // someone switched family on another device — still lands on the right one.
    if (window.DB) window.DB.fid = active.family_id;
    fhResumeArm();                             // next cold start can skip straight to the splash
    // finally: a failed load must still hand the screen over, never strand us on the splash
    try { await window.loadFamilyData(); }     // auto-enter the active family → real data + DB.fid set
    finally { fhResumeDone(); }                // (no go('home') here — it would stomp on deep links)
  } else if (fams.length) {
    fhResumeFail(); fhWarmAbandon();           // no active family → the picker owns the screen
    showFamilyPicker(fams);                    // in families but none active → pick one
  } else if (onb && typeof window.obGo === 'function') {
    fhResumeFail(); fhWarmAbandon();
    window.__obFromPicker = false;
    onb.classList.remove('done'); window.obGo('start');   // brand-new → name a family / take the waiting invite
  } else {
    fhResumeFail(); fhWarmAbandon();
  }
}

// Full-screen "Your families" picker (shown on login, and from Settings → Switch family)
/* Lives inside .phone so it stays in the device frame on desktop, pads for the
   notch and home indicator, and offers a way back when it was opened from
   Settings rather than as the login landing (it used to be a dead end). */
function showFamilyPicker(fams, opts) {
  const onb = g('onboarding');
  const dismissible = !!(opts && opts.dismissible);
  let ov = document.getElementById('fh-fam-ov'); if (ov) ov.remove();
  ov = document.createElement('div'); ov.id = 'fh-fam-ov'; ov.className = 'fh-fam-ov';
  const cards = (fams || []).map((f) =>
    '<button class="fh-fam-card" data-fid="' + _esc(f.family_id) + '">'
    + '<div class="fh-fam-ico">' + _esc(String(f.name || '?').slice(0, 1).toUpperCase()) + '</div>'
    + '<div class="fh-fam-grow"><div class="fh-fam-name">' + _esc(f.name || L('Gia đình', 'Family')) + '</div>'
    + '<div class="fh-fam-meta">' + (f.is_owner ? L('Chủ nhà', 'Owner') : L('Thành viên', 'Member')) + (f.is_active ? L(' · hiện tại', ' · current') : '') + '</div></div>'
    + '<svg class="fh-fam-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>'
  ).join('');
  ov.innerHTML = '<div class="fh-fam-inner">'
    + (dismissible ? '<button class="fh-fam-back" id="fh-fam-back" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg></button>' : '')
    + '<div class="fh-fam-h">' + L('Gia đình của bạn', 'Your families') + '</div>'
    + '<div class="fh-fam-sub">' + L('Chọn một để mở, hoặc tạo / tham gia gia đình khác.', 'Pick one to open, or start / join another.') + '</div>'
    + cards
    + '<button id="fh-fam-new" class="fh-s-line">' + L('Tạo gia đình mới', 'Create a new family') + '</button>'
    + '<button id="fh-fam-join" class="fh-s-ghost">' + L('Tham gia bằng mã', 'Join with a code') + '</button>'
    + '</div>';
  (document.getElementById('phone') || document.body).appendChild(ov);
  if (dismissible) document.getElementById('fh-fam-back').onclick = () => ov.remove();
  ov.querySelectorAll('.fh-fam-card').forEach((btn) => {
    btn.onclick = async () => {
      if (btn.dataset.busy) return;
      btn.dataset.busy = '1'; btn.classList.add('busy');
      // switch_family resolves {error} on 4xx — unwrap it, or a failed switch
      // would drop us into the *previous* family looking like a success.
      try { await _rpc('switch_family', { p_family_id: btn.getAttribute('data-fid') }); }
      catch (e) {
        delete btn.dataset.busy; btn.classList.remove('busy');
        window.toast && window.toast(_friendly(e)); return;
      }
      // The switch landed, so the cached fid now points at the family we just
      // left — drop it and let the hydrate re-read the active one.
      if (window.DB) window.DB.fid = null;
      await (window.loadFamilyData ? window.loadFamilyData() : loadActiveFamily());
      ov.remove();
      if (onb) onb.classList.add('done');
      if (typeof window.go === 'function') window.go('home');
    };
  });
  document.getElementById('fh-fam-new').onclick = () => {
    ov.remove();
    if (onb) onb.classList.remove('done');
    if (window.FAM) { window.FAM.mode = 'create'; window.FAM.familyName = ''; window.FAM.members = []; window.FAM.budget = 0; window.FAM.catBudget = null; }
    window.__obFromPicker = true;                        // back arrow on "Your family" reopens this picker
    if (typeof window.obChoose === 'function') window.obChoose('create');
  };
  document.getElementById('fh-fam-join').onclick = () => {
    ov.remove();
    if (onb) onb.classList.remove('done');
    if (window.FAM) window.FAM.mode = 'join';
    window.__obFromPicker = true;
    if (typeof window.obGo === 'function') window.obGo('start');
  };
}
// First real read: pull the active family's name + members from the DB into the header.
// (Budget / categories / transactions come in the next slice — those numbers are still mock.)
async function loadActiveFamily() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session || !window.FAM) return;
  const uid = session.user.id;
  const { data: prof } = await sb.from('profiles').select('family_id').eq('id', uid).maybeSingle();
  const fid = prof && prof.family_id; if (!fid) return;
  const [famRes, memRes] = await Promise.all([
    sb.from('families').select('name, currency, default_language').eq('id', fid).maybeSingle(),
    sb.from('members').select('name, color, is_shared, user_id').eq('family_id', fid).is('archived_at', null).order('created_at')
  ]);
  const fam = famRes.data, mems = memRes.data || [];
  if (fam) {
    window.FAM.familyName = fam.name;
    if (fam.default_language) window.LANG = fam.default_language;
    if (fam.currency) window.CUR = fam.currency;
  }
  window.FAM.members = mems.filter((m) => !m.is_shared).map((m) => ({
    name: m.name, color: m.color || '#8f8a99', me: m.user_id === uid
  }));
  try {
    localStorage.setItem('fh-fam', JSON.stringify(window.FAM));
    localStorage.setItem('fh-lang', window.LANG);
    localStorage.setItem('fh-cur', window.CUR);
  } catch (e) { }
  if (typeof window.applyLang === 'function') window.applyLang();
  if (typeof window.applyFam === 'function') window.applyFam();
}

window.fhSwitchFamily = async function () {
  let fams;
  // A failed lookup must not look like "you have no families" — that used to
  // route people into creating a duplicate one.
  try { fams = await _rpc('my_families'); }
  catch (e) { window.toast && window.toast(_friendly(e)); return; }
  if (!fams || !fams.length) { window.toast && window.toast(L('Chưa có gia đình nào khác', 'No other families yet')); return; }
  showFamilyPicker(fams, { dismissible: true });     // opened from Settings → must be escapable
};

// ── Google Identity Services: ID-token popup that stays INSIDE the installed PWA ──
let rawNonce = null;
async function makeNonce() {
  rawNonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawNonce));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
/* Sign-in blocks on a token exchange plus a family hydrate — seconds on cellular.
   Cover the screen while it runs so the Google button can't be tapped twice, and
   report failure inline instead of in a system alert. */
function authBusy(on) {
  let el = g('fh-authbusy');
  if (on) {
    if (!el) {
      el = document.createElement('div'); el.id = 'fh-authbusy';
      el.innerHTML = '<span class="fu-dot"></span><span>' + L('Đang đăng nhập…', 'Signing you in…') + '</span>';
      (g('phone') || document.body).appendChild(el);
    }
    el.style.display = 'flex';
  } else if (el) el.style.display = 'none';
}
window.handleSignInWithGoogle = async (response) => {
  authBusy(true);
  const { data, error } = await sb.auth.signInWithIdToken({
    provider: 'google', token: response.credential, nonce: rawNonce
  });
  if (error) { authBusy(false); window.toast && window.toast(_friendly(error)); return; }
  try { await afterLogin(data.session); }
  finally { authBusy(false); }
};
function gisReady() { return window.google && google.accounts && google.accounts.id; }
async function waitGIS(ms) {
  const t0 = Date.now();
  while (!gisReady()) { if (Date.now() - t0 > (ms || 5000)) return false; await new Promise((r) => setTimeout(r, 80)); }
  return true;
}
/* DISABLED: the GIS pre-built button hid our own #ob-gbtn and rendered on top of the
   footer. Everyone now goes through the custom button → obGoogle() redirect flow below.
   The ID-token path is kept intact (handleSignInWithGoogle still works) — to bring the
   pre-built button back, delete the early return on the next line. */
async function mountGoogleButton() {
  return false;
  /* eslint-disable no-unreachable */
  if (!(await waitGIS())) return false;         // GIS blocked/offline → keep the redirect fallback
  const hashedNonce = await makeNonce();
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: window.handleSignInWithGoogle,
    nonce: hashedNonce,
    ux_mode: 'popup',
    use_fedcm_for_prompt: true
  });
  const custom = g('ob-gbtn'); if (custom) custom.style.display = 'none';
  const foot = g('ob-auth-foot');                       // the intro screen's footer (sign-in lives on screen 1 now)
  let holder = g('ob-gholder');
  if (!holder && foot) {
    holder = document.createElement('div');
    holder.id = 'ob-gholder';
    holder.style.cssText = 'display:flex;justify-content:center;margin-bottom:14px';
    foot.insertBefore(holder, foot.firstChild);
  }
  if (holder) google.accounts.id.renderButton(holder, {
    type: 'standard', shape: 'pill', theme: 'outline', text: 'continue_with', size: 'large',
    width: String(Math.min(400, Math.max(240, foot ? foot.clientWidth - 48 : 368)))   // fill the footer like the custom button did
  });
  return true;
  /* eslint-enable no-unreachable */
}

// Fallback (desktop / GIS unavailable): the redirect flow, still on the original custom button.
window.obGoogle = async function () {
  try { sessionStorage.setItem('fh-ob-locale', JSON.stringify({ lang: window.LANG, cur: window.CUR })); } catch (e) { }
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google', options: {
      redirectTo: location.href.split('#')[0].split('?')[0],
      scopes: "https://www.googleapis.com/auth/gmail.readonly",
      // queryParams: {
      //   access_type: 'offline',
      //   prompt: 'consent',
      // },
    },
  });
  if (error) { authBusy(false); window.toast && window.toast(_friendly(error)); }
};

/* ── Google provider tokens → localStorage (TEST ONLY, not the shipping design) ──
   Supabase does NOT persist provider_token / provider_refresh_token: they are on the
   session object only for the SIGNED_IN event right after the redirect, and are gone
   from every later getSession()/refresh. So capture them here or they're unrecoverable
   without sending the user back through consent.

   provider_refresh_token arrives ONLY on the first consent for a given Google account
   (that's what access_type=offline + prompt=consent in obGoogle above are buying), so
   never overwrite a stored one with the undefined of a subsequent sign-in.

   SECURITY: localStorage is readable by any script on this origin and survives sign-out,
   and these grant Gmail-read access to the user's mailbox. This is a scaffold for testing
   the Gmail scope only — before shipping, move the exchange server-side (store the refresh
   token in a service-role-only table, never hand the client a long-lived Google token).
   window.fhClearGoogleTokens() wipes them; _fhLocalWipe (70-goals-income-onboard-ui)
   should clear 'fh-gtok' too once this stops being test-only. */
const _GTOK_KEY = 'fh-gtok';
window.fhGoogleTokens = function () {
  try { return JSON.parse(localStorage.getItem(_GTOK_KEY) || 'null'); } catch (e) { return null; }
};
window.fhClearGoogleTokens = function () {
  try { localStorage.removeItem(_GTOK_KEY); } catch (e) { }
};
function _saveGoogleTokens(session) {
  if (!session || !session.provider_token) return;          // nothing new to keep
  const prev = window.fhGoogleTokens() || {};
  const rec = {
    access_token: session.provider_token,
    // keep the old refresh token when this sign-in didn't reissue one
    refresh_token: session.provider_refresh_token || prev.refresh_token || null,
    // Google access tokens last ~1h; the session's expiry is the closest marker we have
    saved_at: Math.floor(Date.now() / 1000),
    expires_at: session.expires_at || null,
    email: (session.user && session.user.email) || null
  };
  try { localStorage.setItem(_GTOK_KEY, JSON.stringify(rec)); } catch (e) { }
}
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') _saveGoogleTokens(session);
  if (event === 'SIGNED_OUT') window.fhClearGoogleTokens();
});
