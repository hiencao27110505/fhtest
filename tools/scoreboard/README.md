# Email-reading scoreboard

Replays the owner's own mail corpus through the real reader
(`supabase/functions/_shared/mailbox/extract.mjs`), locally, model OFF, and
prints aggregates: per sender domain and overall, how many mails the free tiers
read (by tier), how many would need the model, how richly the read rows are
filled, and the signal / provenance / node distributions
(`docs/specs/email-reading-v2-spec.md` §13).

```sh
node tools/scoreboard/run.mjs                 # this checkout's reader
node tools/scoreboard/run.mjs --json
node tools/scoreboard/run.mjs --reader <dir>  # another copy of _shared/mailbox (an older commit, unpacked)
```

Needs the corpus at `research/statements/mail-corpus/` in the MAIN checkout
(git-ignored; `FH_MAIN_CHECKOUT` overrides the path). It is built by
`node tools/pull-mail-corpus.mjs` after a one-time `node tools/gmail-oauth-probe.js connect`.
Without it the script exits 2 and says so.

What it touches: nothing. No network (the model config is null, the fetch it
hands the reader throws), no database (an in-memory stub), no files written.

What it prints: numbers, and keys from closed lists only (contract.mjs field
and signal names, taxonomy kinds, registry domains, tier names). Any other
string prints as `(other)`. No value from any mail can reach the output.

The number that matters: `THE NUMBER: N of M mails would need the model`, and
beside it the count of distinct (sender, subject shape) pairs among them, which
is what a fresh mailbox would actually spend once the junk cache and the learned
formats answer the rest.
