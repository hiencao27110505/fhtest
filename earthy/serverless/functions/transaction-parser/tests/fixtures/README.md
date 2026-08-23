# Email fixtures

Real transaction mail, fetched the way the pipeline receives it.

## How to populate

    GMAIL_TOKEN_KEY=... DATABASE_URL=... GOOGLE_OAUTH_CLIENT_ID=... \
    GOOGLE_OAUTH_CLIENT_SECRET=... \
      uv run --no-project python tools/fetch_fixtures.py <mailbox> [label]

Writes two files per message:

    emails/<source>-<id>.html   the body as Gmail delivered it
    bodies/<source>-<id>.txt    the same, after ingest normalises it

`bodies/` is what the tests read, because that is what reaches the parser:
normalisation happens in gmail-transaction-ingest, before the Pub/Sub topic.

## Why fetched, not saved from a browser

These used to be pages saved with "Save page as", and that was a poor stand-in
in three ways that all pointed the same direction — the file was not what
production sees:

* It carried the Gmail interface: `Print all`, `Main menu`, the label sidebar.
* It carried the whole inbox listing. One file held thirteen messages, so any
  measurement of "where in the body is the amount" was measuring the wrong
  body.
* It carried Gmail's AI summary, which prints the transaction amount a second
  time in wording no bank uses. A rule learned from that file would anchor on
  text that does not exist in a real mail.

Fetching through `messages.get(format="full")` — the same call ingest makes —
avoids all three by construction.

## Both parts are real

Gmail hands over `text/plain` when a mail has one and `text/html` otherwise,
and this corpus contains both. That is worth keeping: the plain part has no
tags at all, so a line ending is its only field boundary, and a bug that only
affects one of the two shapes is a bug half the corpus would miss.

## These are NOT committed

`emails/` and `bodies/` are gitignored. They are real mail — real names, phone
numbers, addresses, references and amounts — and the repo does not carry that.

Which is why `test_fixtures.py` asserts PROPERTIES rather than values: it
cannot pin `amount == 391500` when the file that figure came from is not in
the repo. It checks that a body naming an amount yields one, that every figure
masks and restores, and that nothing which is not money gets masked. Those
hold for whatever mail the next person fetches.

With `bodies/` empty every test there skips. An empty corpus is a missing
corpus, not a broken parser.
