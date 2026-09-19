-- ---------------------------------------------------------------------------
-- 0140 — seed the three statement formats verified by hand (2026-09-19).
--        Spec: docs/specs/statement-capture-spec.md §13, §15
--
-- The verdict "is this mail format a statement?" normally costs one model call per
-- format, and the project runs on the Gemini free tier. These three were checked
-- against the real mails and the real attached files, so they are written down
-- instead of asked about: anyone banking with VIB or using MoMo captures their
-- statements with zero model calls.
--
-- `shape` is statementShape(subject) from
-- supabase/functions/_shared/mailbox/statement.mjs -- the subject lower-cased with
-- every digit and every non-letter removed. It MUST be produced by that function,
-- never typed by eye: a seed that does not match byte for byte is simply never
-- found, and the model is asked anyway. Regenerate with:
--
--   node --input-type=module -e "const S=await import('./supabase/functions/_shared/mailbox/statement.mjs'); console.log(S.statementShape('<subject>'))"
--
-- The VIB card subject names the card product ("VIB CASH BACK"); another product
-- is another shape and costs its one call. That is the design working, not a gap.
--
-- `on conflict do nothing`: a verdict the model already stored wins over a re-run
-- of this file, and re-applying it is harmless.
--
-- Next free migration number after this one: 0141. Verify against
-- `git ls-tree origin/main supabase/migrations/` and AGENT_SYNC.md before claiming it.
-- ---------------------------------------------------------------------------
insert into public.statement_shapes (sender_address, shape, is_statement, source) values
  ('info@card.vib.com.vn',     'sao ke the tin dung vib cash back thang nam', true, 'seed'),
  ('info@myvib.vib.com.vn',    'sao kê tài khoản',                            true, 'seed'),
  ('no-reply@mservice.com.vn', 'sao kê lịch sử giao dịch',                    true, 'seed')
on conflict (sender_address, shape) do nothing;
