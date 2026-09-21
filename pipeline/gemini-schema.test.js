#!/usr/bin/env node
/* Every schema sent to Gemini is valid for Gemini, at every depth.
 * `node pipeline/gemini-schema.test.js`
 *
 * `classify_merchant_batch` failed 4 of 4 with HTTP 400 (email-reading-v2 §2).
 * Gemini's responseSchema is a restricted OpenAPI subset and each of these is a
 * hard 400, per this codebase's own scars:
 *   • `additionalProperties` anywhere
 *   • a `type` written as a union (`['string','null']`): it wants nullable:true
 *   • a null inside an `enum`
 *
 * toGeminiSchema rewrote those on the TOP-LEVEL properties only. The batch
 * schema is the first NESTED one ({items: array of {i, node, concept, pool}}),
 * so below the first level it went through untouched, and classify.mjs patched
 * one level by hand. This test walks the converted tree instead of trusting any
 * one level, and captures the request the batch call REALLY sends.
 *
 * What this cannot prove: that Google accepts it. It pins every rule we know.
 */
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const ROOT = HERE + '../supabase/functions/_shared/mailbox/';
const L = await import(ROOT + 'llm.mjs');
const C = await import(ROOT + 'classify.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean'];
/** Every violation in a converted schema, with the path it was found at. */
function violations(node, path, out) {
  out = out || []; path = path || '$';
  if (!node || typeof node !== 'object') { out.push(path + ': not a schema object'); return out; }
  if ('additionalProperties' in node) out.push(path + ': additionalProperties');
  if (Array.isArray(node.type)) out.push(path + ': type is an array ' + JSON.stringify(node.type));
  else if (node.type !== undefined && TYPES.indexOf(node.type) < 0) out.push(path + ': unknown type ' + node.type);
  if (node.type === 'null') out.push(path + ': type null');
  if (Array.isArray(node.enum)) {
    if (node.enum.some((e) => e === null)) out.push(path + ': null inside enum');
    if (node.type !== 'string') out.push(path + ': enum on a non-string type');
    if (!node.enum.length) out.push(path + ': empty enum');
  }
  if (node.type === 'array' && !node.items) out.push(path + ': array without items');
  if (Array.isArray(node.required)) {
    for (const r of node.required) if (!node.properties || !(r in node.properties)) out.push(path + ': required names a missing property ' + r);
  }
  for (const k of Object.keys(node.properties || {})) violations(node.properties[k], path + '.properties.' + k, out);
  if (node.items) violations(node.items, path + '.items', out);
  for (const [i, a] of (node.anyOf || []).entries()) violations(a, path + '.anyOf[' + i + ']', out);
  return out;
}

console.log('\n-- the batch schema, converted --');
{
  const g = L.toGeminiSchema(C.BATCH_SCHEMA);
  const v = violations(g);
  t('no violation at any depth', v.length === 0, v);
  const item = g.properties.items.items;
  t('the nested null-unions became nullable:true', item.properties.node.type === 'string' && item.properties.node.nullable === true
    && item.properties.concept.nullable === true && item.properties.pool.nullable === true, item.properties);
  t('the nested enums lost their null and kept their values', JSON.stringify(item.properties.concept.enum) === JSON.stringify(C.CLASSIFY_CONCEPTS)
    && JSON.stringify(item.properties.pool.enum) === JSON.stringify(C.CLASSIFY_POOLS));
  t('`i` is an integer, as Gemini spells it', item.properties.i.type === 'integer' && item.properties.i.nullable === undefined);
  t('the `required` list INSIDE items survives', JSON.stringify(item.required) === JSON.stringify(['i']));
  t('and the outer one', JSON.stringify(g.required) === JSON.stringify(['items']));
  t('the source schema is not mutated', Array.isArray(C.BATCH_SCHEMA.properties.items.items.properties.node.type));
}

console.log('\n-- what classifyMerchantsBatch REALLY sends --');
{
  let sent = null;
  await C.classifyMerchantsBatch(['ZQ ALPHA', 'ZQ BETA'], { apiKey: 'k' }, async (u, init) => { sent = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"items":[{"i":1,"node":null,"concept":"Dining","pool":null}]}' }] } }] }) }; });
  const schema = sent && sent.generationConfig && sent.generationConfig.responseSchema;
  t('a responseSchema rides the request', !!schema);
  t('it has no violation at any depth', violations(schema).length === 0, violations(schema));
  t('it asks for JSON', sent.generationConfig.responseMimeType === 'application/json');
  const text = JSON.stringify(schema);
  t('no "additionalProperties", no "null" type, anywhere in the serialised request', !/additionalProperties/.test(text) && !/"type":\s*\[/.test(text) && !/\bnull\b/.test(text), text);
}

console.log('\n-- the single classify call --');
{
  let sent = null;
  await C.classifyMerchant('ZQ ALPHA', { apiKey: 'k' }, async (u, init) => { sent = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"node":null,"concept":null,"pool":null}' }] } }] }) }; });
  t('no violation at any depth', violations(sent.generationConfig.responseSchema).length === 0, violations(sent.generationConfig.responseSchema));
}

console.log('\n-- the extraction schema: valid, and UNCHANGED by the rewrite --');
{
  const g = L.toGeminiSchema(L.EXTRACTION_SCHEMA);
  t('no violation at any depth', violations(g).length === 0, violations(g));
  /* The converter as it was, inline: the flat schema that has answered 200 in
     production for months must come out byte-for-byte the same. */
  const old = (schema) => { const copy = JSON.parse(JSON.stringify(schema)); delete copy.additionalProperties;
    for (const key of Object.keys(copy.properties || {})) { const prop = copy.properties[key];
      if (Array.isArray(prop.type)) { prop.type = prop.type.filter((x) => x !== 'null')[0]; prop.nullable = true;
        if (Array.isArray(prop.enum)) prop.enum = prop.enum.filter((e) => e !== null); } }
    return copy; };
  t('byte-identical to what the old converter produced for it', JSON.stringify(g) === JSON.stringify(old(L.EXTRACTION_SCHEMA)));
  t('...while the OLD converter left the batch schema invalid below the first level  <-- the latent 400',
    violations(old(C.BATCH_SCHEMA)).length > 0, violations(old(C.BATCH_SCHEMA)));
}

console.log('\n-- any depth, any nesting --');
{
  const deep = { type: 'object', additionalProperties: false, properties: {
    rows: { type: ['array', 'null'], items: { type: 'object', additionalProperties: false, required: ['cells'], properties: {
      cells: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
        kind: { type: ['string', 'null'], enum: ['a', 'b', null] },
        n: { type: ['integer', 'null'] },
        plain: { type: 'string', enum: ['x', null] },
      } } },
    } } },
    either: { anyOf: [{ type: ['string', 'null'] }, { type: 'object', additionalProperties: false, properties: { z: { type: ['number', 'null'] } } }] },
  } };
  const g = L.toGeminiSchema(deep);
  t('three levels of arrays-of-objects convert clean', violations(g).length === 0, violations(g));
  const cell = g.properties.rows.items.properties.cells.items.properties;
  t('a nullable array is nullable', g.properties.rows.nullable === true && g.properties.rows.type === 'array');
  t('a nullable integer three levels down', cell.n.type === 'integer' && cell.n.nullable === true);
  t('a null in an enum makes the node nullable even when its type was not a union', cell.plain.nullable === true && JSON.stringify(cell.plain.enum) === '["x"]');
  t('anyOf branches are converted too', g.properties.either.anyOf[0].nullable === true && g.properties.either.anyOf[1].properties.z.nullable === true);
  t('a non-nullable type stays non-nullable', L.toGeminiSchema({ type: 'object', properties: { a: { type: 'string' } } }).properties.a.nullable === undefined);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
