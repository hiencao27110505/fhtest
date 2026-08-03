// Vercel serverless function. POST { headers: string[], sampleRows: string[][] }.
// Resolves a CSV column mapping via Gemini — only called when client-side heuristics
// (header-alias match + per-row content sniffing) can't confidently identify the
// date/amount/description columns or agree on a single date/number format for the
// whole column. One call per file-shape, never per row.
//
// Requires GEMINI_API_KEY as a Vercel environment variable (Project Settings > Environment
// Variables). Never expose this key to the client — that's the only reason this function
// exists instead of calling Gemini straight from the browser.

const GEMINI_MODEL = 'gemini-2.5-flash'; // verify current free-tier model name/limits at ai.google.dev before relying on this
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const MAX_SAMPLE_ROWS = 15; // bounds token cost regardless of how large the uploaded file is

const SYSTEM_PROMPT = `You map spreadsheet columns from a personal/family finance CSV export to a fixed schema.
The file may be in Vietnamese, English, or mixed, and may come from a bank, an e-wallet, or a shared-expense app.

For each column, return the field it maps to: occurred_at, amount, description, category, counterparty,
currency, paid_by, split_with — or "unmapped" if it fits none of these.

For "occurred_at", also infer the date convention for the WHOLE column as one of "dd/mm/yyyy", "mm/dd/yyyy",
or "unclear" — look at every sample row together, not one at a time. A single row where the day is <= 12 is
ambiguous on its own (e.g. "3/7" could be 3 July or March 7); only rows where day > 12, or an unambiguous
format like "2026-07-04" or "Jul 9 2026", can actually resolve which convention the file uses. If every row
happens to be ambiguous, say "unclear" rather than guessing.

Never guess wildly: if a column's purpose truly cannot be determined from the header and samples, map it to
"unmapped" and say why in "notes". Do not invent values that are not present in the samples.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    column_mapping: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          column_index: { type: 'INTEGER' },
          field: {
            type: 'STRING',
            enum: [
              'occurred_at', 'amount', 'description', 'category',
              'counterparty', 'currency', 'paid_by', 'split_with', 'unmapped',
            ],
          },
          confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
        },
        required: ['column_index', 'field', 'confidence'],
      },
    },
    date_convention: { type: 'STRING', enum: ['dd/mm/yyyy', 'mm/dd/yyyy', 'unclear', 'not_applicable'] },
    notes: { type: 'STRING' },
  },
  required: ['column_mapping', 'date_convention', 'notes'],
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY not configured on the server' });
    return;
  }

  const { headers, sampleRows } = req.body || {};
  if (!Array.isArray(headers) || !Array.isArray(sampleRows)) {
    res.status(400).json({ error: 'body must be { headers: string[], sampleRows: string[][] }' });
    return;
  }

  const capped = sampleRows.slice(0, MAX_SAMPLE_ROWS);
  const table = [headers.join(' | '), ...capped.map((r) => r.join(' | '))].join('\n');

  const geminiBody = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: table }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0,
    },
  };

  let geminiRes;
  try {
    geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });
  } catch (e) {
    res.status(502).json({ error: 'Gemini request failed', detail: String(e) });
    return;
  }

  if (!geminiRes.ok) {
    const detail = await geminiRes.text();
    // Gemini's own free-tier rate limit (429) surfaces here — there is no additional
    // client-side or server-side throttle in front of it yet. See handoff notes: the
    // email pipeline has explicit per-run/per-day caps for this reason; this endpoint
    // doesn't, since call volume here is per-file-shape and expected to be much lower,
    // but that's an assumption worth revisiting once real usage is observed.
    res.status(502).json({ error: `Gemini returned ${geminiRes.status}`, detail });
    return;
  }

  const data = await geminiRes.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    res.status(502).json({ error: 'Gemini returned no content', raw: data });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    res.status(502).json({ error: 'Gemini response was not valid JSON', raw: text });
    return;
  }

  res.status(200).json(parsed);
};
