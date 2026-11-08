-- 0162 — statement_shapes seed: the Techcombank credit-card statement mail
-- (statement-coverage-spec SC6; printed by `npm run coverage`). The lane lists
-- and seals PDF statements since 2026-11-08 (pdf-statements-spec PS1); without
-- this row the first Techcombank statement per mailbox costs one model verdict
-- to decide "statement or not". The shape is what statementShape() computes
-- from the real subject "Techcombank – Thong bao sao ke the tin dung –
-- Statement - 10-2026" (digits and non-letters stripped), pinned by
-- tools/statement-coverage.test.js against taxonomy/statement-formats.json.
insert into public.statement_shapes (sender_address, shape, is_statement, source) values
  ('thetindung@techcombank.com.vn', 'techcombank thong bao sao ke the tin dung statement', true, 'seed')
on conflict (sender_address, shape) do nothing;
