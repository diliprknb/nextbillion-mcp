// Grades each saved agent run with an LLM judge using the status taxonomy of the earlier 48-prompt report.
// Usage: set -a; . ./.env; set +a; JUDGE_MODEL=gemini-3.8-flash node evals/hosted-benchmark/judge.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const D = import.meta.dirname, K = process.env.GEMINI_API_KEY, M = process.env.JUDGE_MODEL ?? 'gemini-3.8-flash';
const prompts = JSON.parse(readFileSync(D + '/prompts.json', 'utf8'));
const res = JSON.parse(readFileSync(D + '/agent_results.json', 'utf8'));
const decls = JSON.parse(readFileSync(D + '/decls.json', 'utf8'));
const OUT = D + '/judged.json';
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const RUBRIC = `You grade how well an MCP server let an AI assistant complete a NextBillion.ai evaluation prompt. You are given the prompt, the prompt type, the names of ALL tools the server exposes, the assistant's tool-call trace (arguments, error flag, result excerpt) and its final answer.
Pick exactly one status:
- "Pass": the needed tool(s) were called successfully and the final answer fully satisfies the prompt (including any requested map image/link). For knowledge questions: grounded in documentation tool results and correct.
- "Partial Pass": mostly satisfied, with a minor omission or one recovered error (e.g. a requested map was not rendered, one tool error then success).
- "Ungrounded": a knowledge question answered without calling a documentation/search tool, so the answer is from model memory and not verifiable.
- "Capability Gap": the server exposes no tool able to do what the prompt asks (tool-call prompts), or no documentation tool to ground the answer, and the assistant said so or could not do it. Not attempted because the tool does not exist.
- "Partial Fail": a tool was attempted but a significant part of the request failed or was wrong.
- "Fail": a relevant tool was called but the request was not accomplished (wrong result, refused, no answer).
- "Fail (Bug)": a relevant tool errored on valid input in a way that looks like a server/tool defect (5xx, upstream error, validation error on valid arguments).
Judge from the tool results, not from the assistant's confidence: if the final answer claims facts the tool results do not support, downgrade. Reply as JSON: {"status": "...", "verdict": "<one or two plain sentences saying what happened and why>"}.`;
async function gem(body) {
  for (let a = 0; a < 6; a++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${M}:generateContent?key=${K}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 429) { const t = await r.clone().text(); if (/per day/i.test(t)) throw new Error('DAILY QUOTA'); }
    if (r.status === 429 || r.status >= 500) { await new Promise((z) => setTimeout(z, 2000 * (a + 1) ** 2)); continue; }
    const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300)); return j;
  }
  throw new Error('retries');
}
const jobs = [];
for (const p of prompts) for (const s of ['off', 'drk']) if (res[`${p.id}|${s}`] && !out[`${p.id}|${s}`]) jobs.push([p, s]);
let n = 0, stop = false;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (jobs.length && !stop) {
    const [p, s] = jobs.shift(); const r = res[`${p.id}|${s}`];
    const trace = r.calls.map((c, i) => `#${i + 1} ${c.tool}(${JSON.stringify(c.args).slice(0, 400)}) -> ${c.isError ? 'ERROR' : 'ok'} [${c.chars} chars]: ${c.result.slice(0, 500).replace(/\s+/g, ' ')}`).join('\n') || '(no tool calls)';
    const text = `${RUBRIC}\n\nPROMPT TYPE: ${p.type}\nPROMPT: ${p.prompt}\n\nSERVER TOOLS (${decls[s].length}): ${decls[s].map((d) => d.name).join(', ')}\n\nTOOL TRACE:\n${trace}\n\nRUN ERROR: ${r.err ?? 'none'}\n\nFINAL ANSWER:\n${(r.final || '(empty)').slice(0, 2500)}`;
    try {
      const j = await gem({ contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } });
      out[`${p.id}|${s}`] = JSON.parse(j.candidates[0].content.parts.map((x) => x.text ?? '').join(''));
      writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log(++n, p.id, s, out[`${p.id}|${s}`].status);
    } catch (e) { console.log('SKIP', p.id, s, e.message.slice(0, 100)); if (/DAILY QUOTA/.test(e.message)) stop = true; }
  }
}));
console.log(`judged ${Object.keys(out).length}/${Object.keys(res).length}`);
process.exit(0);
