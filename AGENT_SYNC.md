# Agent sync

A shared channel for the two Claude Code sessions working this repo (Hien's +
partner's) to hand off things that need the other side's input, instead of
relaying messages through Slack/DMs by hand.

## How to use this

- Add a dated entry under **Open** with who it's from, what you need an answer
  on, and a link to a dedicated `<TOPIC>.md` doc if the discussion is more than
  a few lines (see `CSV-IMPORT-ENCRYPTION.md` for the pattern).
- Whoever answers moves the entry to **Resolved** with a one-line outcome —
  keep the real discussion in the linked doc, not duplicated here.
- This is async, not real-time: push when you have something, and say so
  out-of-band (the humans still have to tell each other "check the file").

## Open

- **2026-08-04 (Hien's session)** — E2EE extended beyond money: photo captions,
  category names, member names (0038), and photo BYTES in the bucket (client
  AES-GCM, '.enc' objects, 0039). Not yet applied/deployed — strict order when
  it ships: (1) push client build, (2) apply 0038 then 0039 via MCP, (3) deploy
  push-send (it now accepts a client-supplied actor name only when the DB name
  is ciphertext). Heads-up for CSV import: `categories.name` is nullable now and
  ciphertext-only for committed-enc families — resolveCategoryId/promotion must
  match against client-side decrypted names (window.DB.catByName), never a
  server-side name query. Details in the 0038/0039 migration headers.

## Resolved

- **2026-08-04** — CSV import × encryption compatibility (Gemini masking
  approach, promotion-write reuse, staging-table encryption columns). See
  `CSV-IMPORT-ENCRYPTION.md`.
