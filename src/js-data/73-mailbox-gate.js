  // ═══ bank-email onboarding: show the entries only to people who can use them ═══
  /* Both Settings rows of the bank-email feature — "Connect bank email" and
     "Review transactions" — are hidden in index.html and revealed here, once
     can_use_mailbox() (0067) says this account may connect.

     WHY THE REVIEW ROW IS ON THE SAME ANSWER: staged rows are routed by
     member_id from mailbox_connections, and 0058's read policy returns a member
     only their own rows. So "can connect" and "could ever have something to
     review" are the same set of people, and one call settles both. Gating the
     review row on an actual row count instead would mean a second query, and a
     row that appears and disappears as mail arrives — worse, for no gain.

     WHY HIDE RATHER THAN LET IT FAIL: the RPC refuses with 'mailbox_not_in_beta',
     so the data is safe either way — but offering a thing and then refusing it
     reads as broken, and invites people to ask why. A row that isn't there asks
     nothing.

     WHY THIS IS NOT THE SECURITY BOUNDARY, and must not be mistaken for one:
     anyone can call get_or_create_mailbox_alias directly. 0067's check inside
     that function is what actually stops a mailbox being issued. This is the
     manners; that is the lock.

     FAIL-CLOSED: the rows start hidden and are only ever revealed on an explicit
     true. Offline, a slow boot, an RPC error, an older database without 0067 —
     all leave them hidden. The failure people notice is a missing menu row; the
     failure they don't is a stranger's bank mail arriving in our inbox. */

  var _MB_GATE_ROWS = ['set-mailbox-row', 'set-review-row'];
  var _mbGateDone = false;

  async function _mailboxGateApply() {
    if (_mbGateDone) return;
    var rows = _MB_GATE_ROWS
      .map(function (id) { return document.getElementById(id); })
      .filter(Boolean);
    // Not yet in the DOM (or an older shell that predates the ids) — try again
    // on the next tick rather than latching done against nothing.
    if (!rows.length) return;
    try {
      var ok = await _rpc('can_use_mailbox');
      if (ok === true) {
        rows.forEach(function (row) { row.style.display = ''; });
        _mbGateDone = true;
      }
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
