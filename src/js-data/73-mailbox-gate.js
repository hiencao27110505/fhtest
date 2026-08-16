  // ═══ bank-email onboarding: show the entry only to people who can use it ═══
  /* The Settings row "Connect bank email" is hidden in index.html and revealed
     here, once can_use_mailbox() (0067) says this account may connect.

     WHY HIDE RATHER THAN LET IT FAIL: the RPC refuses with 'mailbox_not_in_beta',
     so the data is safe either way — but offering a thing and then refusing it
     reads as broken, and invites people to ask why. A row that isn't there asks
     nothing.

     WHY THIS IS NOT THE SECURITY BOUNDARY, and must not be mistaken for one:
     anyone can call get_or_create_mailbox_alias directly. 0067's check inside
     that function is what actually stops a mailbox being issued. This is the
     manners; that is the lock.

     FAIL-CLOSED: the row starts hidden and is only ever revealed on an explicit
     true. Offline, a slow boot, an RPC error, an older database without 0067 —
     all leave it hidden. The failure people notice is a missing menu row; the
     failure they don't is a stranger's bank mail arriving in our inbox. */

  var _mbGateDone = false;

  async function _mailboxGateApply() {
    if (_mbGateDone) return;
    var row = document.getElementById('set-mailbox-row');
    if (!row) return;
    try {
      var ok = await _rpc('can_use_mailbox');
      if (ok === true) { row.style.display = ''; _mbGateDone = true; }
    } catch (e) {
      // Includes the pre-0067 case, where the function does not exist yet.
      // Staying hidden is the right answer there too: on a database without the
      // allowlist, nobody should be minting mailboxes from the UI.
    }
  }

  /* Waits for hydrate the same way fhNavTo does, rather than hooking into
     another module's boot path — this file owns its own timing and touches
     nothing else, so it cannot break onboarding if it is wrong. */
  window.fhMailboxGate = function () {
    var t0 = Date.now();
    (function _wait() {
      if (window.DB && window.DB._hydrated && window.fhUser) { _mailboxGateApply(); return; }
      if (Date.now() - t0 > 20000) return;
      setTimeout(_wait, 400);
    })();
  };

  if (typeof window !== 'undefined') window.fhMailboxGate();
