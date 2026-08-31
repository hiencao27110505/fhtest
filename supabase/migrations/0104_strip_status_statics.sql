-- 0104: take the status opinion out of every stored extraction template.
--
-- WHY. `deriveExtractionTemplate` staticised `status` — the value the ONE mail
-- it learned from happened to report — into the template for the whole shape.
-- status is not a property of a shape. It is the outcome of an individual
-- transaction, and it goes both ways:
--
--   • derive off a DECLINED attempt → every later success staticises as
--     "Không thành công". A live Vietcombank card template carried exactly this.
--   • derive off a SUCCESS → every later decline staticises as real spending,
--     which is money the ledger loses twice.
--
-- Nothing downstream corrected either, because statusReadsFailed() reads the
-- mail's own status row and a success body does not read as failed — so the
-- template's opinion was never contradicted by anything.
--
-- Both writers stop emitting the key alongside this migration (templates.mjs
-- and bank-email-pipeline.gs, changed together — they are verbatim copies of
-- one another and a divergence here would not throw, it would return a
-- different status). This removes the key from what is already stored.
--
-- STRIP, NOT PURGE. The obvious move was to null `extraction_regex` on the
-- affected rows and let them relearn. That also throws away anchors that work,
-- and relearning costs a model call per shape on the forwarding transport,
-- which has no label-table tier to fall back on. Deleting one key leaves every
-- working anchor intact and removes the whole hazard: `applyExtractionTemplate`
-- copies `tpl.static` key by key, so an ABSENT key contributes nothing and the
-- shape simply has no opinion about status any more. Same end state, none of
-- the cost.
--
-- Safe by 0099's reasoning: this table is a CACHE. The worst outcome of a wrong
-- edit here is a relearn, never a wrong ledger row.

-- MATERIALIZED is load-bearing, not style. Postgres does not promise it will
-- evaluate a WHERE clause left to right, so a plain `... where regex like '{%'
-- and regex::jsonb -> ...` may run the cast FIRST and throw on the legacy
-- placeholder strings this table still holds from before templates were JSON.
-- The fence guarantees the cast only ever sees rows that already passed the
-- shape check. jsonb_exists() rather than the `?` operator for the same class
-- of reason: `?` is a parameter placeholder to several SQL clients.

begin;

with candidates as materialized (
  select id, extraction_regex
    from public.sender_fingerprints
   where extraction_regex is not null
     and extraction_regex like '{%'
)
update public.sender_fingerprints f
   set extraction_regex = ((c.extraction_regex::jsonb) #- '{static,status}')::text
  from candidates c
 where f.id = c.id
   and jsonb_exists((c.extraction_regex::jsonb) -> 'static', 'status');

commit;
