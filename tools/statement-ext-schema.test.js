/* The lane's STATEMENT_EXTS and the database's check on statement_files.file_ext
   must name the same set. 2026-11-08: mailbox-sync v78 listed PDF statements
   while 0139's check still said (xlsx, csv); every PDF insert failed with 23514
   and left a sealed object with no row, once per mailbox per tick, and the fake
   db in pipeline/statement-lane.test.js could not see it. This test reads the
   migrations the way Postgres will apply them: the LAST definition of the
   constraint wins. Run with: node --test tools/statement-ext-schema.test.js */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATEMENT_EXTS } from '../supabase/functions/_shared/mailbox/statement.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase', 'migrations');

function lastFileExtCheck() {
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  let found = null;
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    // 0139 inline form: `file_ext text not null check (file_ext in ('xlsx', 'csv'))`
    // later form:       `add constraint statement_files_file_ext_check check (file_ext in (...))`
    const re = /file_ext\s+in\s*\(([^)]*)\)/gi;
    let m;
    while ((m = re.exec(sql))) {
      const exts = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
      found = { file: f, exts };
    }
  }
  return found;
}

test('statement_files.file_ext check names every extension the lane lists', () => {
  const check = lastFileExtCheck();
  assert.ok(check, 'no file_ext check found in supabase/migrations');
  const missing = STATEMENT_EXTS.filter(e => !check.exts.includes(e));
  assert.deepEqual(missing, [], `STATEMENT_EXTS ${JSON.stringify(STATEMENT_EXTS)} but ${check.file} allows ${JSON.stringify(check.exts)}: the lane will insert a row the database refuses (23514) and leave a sealed object with no row`);
});
