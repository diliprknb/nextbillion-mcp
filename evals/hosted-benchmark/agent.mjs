// Runs each of the 48 evaluation prompts through a Gemini tool-calling loop against the hosted
// official server and the drk hybrid server. Resumable: finished runs are kept in agent_results.json.
// Usage: set -a; . ./.env; set +a; AGENT_MODEL=gemini-3.5-flash CONC=3 node evals/hosted-benchmark/agent.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const D = import.meta.dirname;
const { MCPClientManager } = await import(D + '/../../node_modules/@mcpjam/sdk/dist/index.js');
const NB = process.env.NBAI_API_KEY, GK = process.env.GEMINI_API_KEY;
const MODEL = process.env.AGENT_MODEL ?? 'gemini-3.5-flash', MAXT = 8, CONC = Number(process.env.CONC ?? 3), CAP = 12000;
const only = (process.env.ONLY ?? '').split(',').filter(Boolean);
const prompts = JSON.parse(readFileSync(D + '/prompts.json', 'utf8')).filter((p) => !only.length || only.includes(p.id));
const OUT = D + '/agent_results.json';
const results = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const URLS = { off: 'https://mcp.nextbillion.io', drk: 'https://nb-mcp-server-84559404454.us-central1.run.app/sse' };
const m = new MCPClientManager();
await m.connectToServer('off', { url: URLS.off, requestInit: { headers: { Authorization: `Bearer ${NB}` } } });
await m.connectToServer('drk', { url: URLS.drk });
const KEEP = new Set(['type', 'description', 'properties', 'items', 'required', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems', 'format', 'nullable']);
function clean(s) {
  if (Array.isArray(s)) return s.map(clean);
  if (!s || typeof s !== 'object') return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'properties') { o.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, clean(pv)])); continue; }
    if (k === 'anyOf' || k === 'oneOf') { Object.assign(o, clean(v.find((x) => x.type && x.type !== 'null') ?? v[0])); continue; }
    if (KEEP.has(k)) o[k] = clean(v);
  }
  if (Array.isArray(o.type)) o.type = o.type.find((t) => t !== 'null') ?? 'string';
  if (o.type === 'array' && !o.items) o.items = { type: 'number' };
  if (o.type === 'object' && !o.properties) o.properties = { _: { type: 'string' } };
  return o;
}
const decls = {};
for (const s of ['off', 'drk']) {
  const t = await m.listTools(s); const arr = t.tools ?? t;
  decls[s] = arr.map((x) => {
    const sc = clean(x.inputSchema);
    // The drk server has no server-side key: the harness injects api_key so the model never sees the secret.
    if (s === 'drk' && sc.properties) { delete sc.properties.api_key; sc.required = (sc.required ?? []).filter((r) => r !== 'api_key'); }
    if (!sc.properties) sc.properties = {};
    if (sc.required && !sc.required.length) delete sc.required;
    return { name: x.name, description: (x.description ?? '').slice(0, 1500), parameters: sc };
  });
}
writeFileSync(D + '/decls.json', JSON.stringify(decls));
const SYS = 'You are an assistant connected to NextBillion.ai tools over MCP. Use the available tools to answer the user. When a tool returns an image or a map URL, mention it. Be concise and report any tool errors honestly.';
async function gem(body) {
  for (let a = 0; a < 6; a++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GK}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 429) { const t = await r.clone().text(); if (/per day/i.test(t)) throw new Error('gemini DAILY QUOTA'); }
    if (r.status === 429 || r.status >= 500) { await new Promise((z) => setTimeout(z, 2000 * (a + 1) ** 2)); continue; }
    const j = await r.json(); if (!r.ok) throw new Error(`gemini ${r.status}: ${JSON.stringify(j).slice(0, 300)}`); return j;
  }
  throw new Error('gemini retries exhausted');
}
const textOf = (r) => (r?.content ?? []).map((c) => (c.type === 'text' ? c.text : `[${c.type} content returned]`)).join('\n');
async function run(server, p) {
  const t0 = performance.now(); const contents = [{ role: 'user', parts: [{ text: p.prompt }] }];
  const calls = []; let tin = 0, tout = 0, final = '', turns = 0, err = null;
  try {
    for (; turns < MAXT; turns++) {
      const j = await gem({ systemInstruction: { parts: [{ text: SYS }] }, contents, tools: [{ functionDeclarations: decls[server] }], generationConfig: { temperature: 0 } });
      tin += j.usageMetadata?.promptTokenCount ?? 0; tout += (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0);
      const parts = j.candidates?.[0]?.content?.parts ?? [];
      if (!j.candidates?.[0]?.content) { err = 'empty candidate: ' + (j.candidates?.[0]?.finishReason ?? JSON.stringify(j.promptFeedback ?? '')); break; }
      contents.push({ role: 'model', parts });
      const fcs = parts.filter((x) => x.functionCall);
      if (!fcs.length) { final = parts.map((x) => x.text ?? '').join(''); break; }
      const resp = [];
      for (const { functionCall: fc } of fcs) {
        const args = { ...(fc.args ?? {}) }; delete args._; if (server === 'drk') args.api_key = NB;
        const t = performance.now(); let txt, isErr = false;
        try { const r = await m.executeTool(server, fc.name, args); txt = textOf(r); isErr = !!r.isError; } catch (e) { txt = 'THROWN: ' + e.message; isErr = true; }
        const shown = { ...args }; if (server === 'drk') delete shown.api_key;
        calls.push({ tool: fc.name, args: shown, isError: isErr, ms: Math.round(performance.now() - t), chars: txt.length, result: txt.slice(0, 1500) });
        resp.push({ functionResponse: { name: fc.name, response: { result: txt.length > CAP ? txt.slice(0, CAP) + `\n…[truncated ${txt.length - CAP} chars]` : txt } } });
      }
      contents.push({ role: 'user', parts: resp });
    }
    if (!final && !err) err = `no final answer after ${MAXT} turns`;
  } catch (e) { err = e.message; }
  return { server, id: p.id, ms: Math.round(performance.now() - t0), turns: turns + 1, tokens_in: tin, tokens_out: tout, calls, final, err };
}
const jobs = []; for (const p of prompts) for (const s of ['off', 'drk']) if (!results[`${p.id}|${s}`]) jobs.push([p, s]);
let done = 0, stop = false;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (jobs.length && !stop) {
    const [p, s] = jobs.shift(); const r = await run(s, p);
    if ((r.err ?? '').startsWith('gemini')) { // rate limit or API failure: not a server result, do not save
      console.log(`SKIP ${p.id} ${s}: ${r.err}`); if (/DAILY QUOTA/.test(r.err)) stop = true; continue;
    }
    results[`${p.id}|${s}`] = r; writeFileSync(OUT, JSON.stringify(results, null, 1));
    console.log(`${++done} ${p.id} ${s} ${r.ms}ms calls=${r.calls.map((c) => c.tool + (c.isError ? '!' : '')).join(',') || '-'} ${r.err ?? ''}`);
  }
}));
console.log(`finished: ${Object.keys(results).length}/${prompts.length * 2} runs saved${stop ? ' (stopped on daily quota)' : ''}`);
process.exit(0);
