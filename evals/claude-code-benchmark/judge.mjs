// Grades each saved run with a Claude Code judge (`claude -p` with a JSON schema, no tools).
// Usage: node evals/claude-code-benchmark/judge.mjs        (env: JUDGE_MODEL optional, CONC default 3)
// Reads results/agent_results.json, writes results/judged.json (resumable).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const D = import.meta.dirname;
const prompts = JSON.parse(readFileSync(D + '/prompts.json', 'utf8'));
const res = JSON.parse(readFileSync(D + '/results/agent_results.json', 'utf8'));
const OUT = D + '/results/judged.json';
const TOOLS = JSON.parse(readFileSync(D + '/results/tools.json', 'utf8'));
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const STATUSES = ['Pass', 'Partial Pass', 'Ungrounded', 'Capability Gap', 'Partial Fail', 'Fail', 'Fail (Bug)'];
const SCHEMA = { type: 'object', properties: { status: { type: 'string', enum: STATUSES }, verdict: { type: 'string' } }, required: ['status', 'verdict'] };
const RUBRIC = `You grade how well an MCP server let an AI assistant complete a NextBillion.ai evaluation prompt. You are given the prompt, the prompt type, the names of ALL tools the server exposes, the assistant's tool-call trace (arguments, error flag, result excerpt) and its final answer. "ToolSearch" calls are Claude Code's own tool discovery, not server actions: ignore them when judging.
Pick exactly one status:
- "Pass": the needed tool(s) were called successfully and the final answer fully satisfies the prompt (including any requested map image/link). For knowledge questions: grounded in documentation tool results and correct.
- "Partial Pass": mostly satisfied, with a minor omission or one recovered error (e.g. a requested map was not rendered, one tool error then success).
- "Ungrounded": a knowledge question answered without calling a documentation/search tool, so the answer is from model memory and not verifiable.
- "Capability Gap": the server exposes no tool able to do what the prompt asks (tool-call prompts), or no documentation tool to ground the answer, and the assistant said so or could not do it. Not attempted because the tool does not exist.
- "Partial Fail": a tool was attempted but a significant part of the request failed or was wrong.
- "Fail": a relevant tool was called but the request was not accomplished (wrong result, refused, no answer).
- "Fail (Bug)": a relevant tool errored on valid input in a way that looks like a server/tool defect (5xx, upstream error, validation error on valid arguments).
Judge from the tool results, not from the assistant's confidence: if the final answer claims facts the tool results do not support, downgrade. Reply with the JSON object only: status and a one or two sentence verdict saying what happened and why.`;

function claudeJudge(text) {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), 'ccjudge-'));
    const args = ['-p', text, '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--tools', '', '--strict-mcp-config',
      '--no-session-persistence', '--disable-slash-commands', '--setting-sources', '', '--max-turns', '3'];
    if (process.env.JUDGE_MODEL) args.push('--model', process.env.JUDGE_MODEL);
    let o = '', e = '';
    const ch = spawn('claude', args, { cwd: dir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => ch.kill('SIGKILL'), 180000);
    ch.stdout.on('data', (b) => (o += b)); ch.stderr.on('data', (b) => (e += b));
    ch.on('close', () => {
      clearTimeout(timer); rmSync(dir, { recursive: true, force: true });
      try {
        const j = JSON.parse(o); let v = j.structured_output;
        if (!v) { const m = String(j.result ?? '').match(/\{[\s\S]*\}/); v = m ? JSON.parse(m[0]) : null; }
        if (v && STATUSES.includes(v.status)) resolve({ ...v, cost_usd: j.total_cost_usd ?? null, model: Object.keys(j.modelUsage ?? {})[0] ?? null }); else reject(new Error('bad judge output: ' + o.slice(0, 200)));
      } catch (x) { reject(new Error(x.message + ' | ' + o.slice(0, 200) + e.slice(0, 200))); }
    });
  });
}

const jobs = [];
for (const p of prompts) for (const s of ['off', 'drk']) if (res[`${p.id}|${s}`] && !out[`${p.id}|${s}`]) jobs.push([p, s]);
let n = 0;
await Promise.all(Array.from({ length: Number(process.env.CONC ?? 3) }, async () => {
  while (jobs.length) {
    const [p, s] = jobs.shift(); const r = res[`${p.id}|${s}`];
    const toolNames = TOOLS[s];
    const trace = r.calls.map((c, i) => `#${i + 1} ${c.tool}(${JSON.stringify(c.args).slice(0, 400)}) -> ${c.isError ? 'ERROR' : 'ok'} [${c.chars} chars]: ${c.result.slice(0, 500).replace(/\s+/g, ' ')}`).join('\n') || '(no tool calls)';
    const text = `${RUBRIC}\n\nPROMPT TYPE: ${p.type}\nPROMPT: ${p.prompt}\n\nSERVER TOOLS (${toolNames.length}): ${toolNames.join(', ')}\n\nTOOL TRACE:\n${trace}\n\nRUN ERROR: ${r.err ?? 'none'}\n\nFINAL ANSWER:\n${(r.final || '(empty)').slice(0, 2500)}`;
    try { out[`${p.id}|${s}`] = await claudeJudge(text); writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log(++n, p.id, s, out[`${p.id}|${s}`].status); }
    catch (e) { console.log('SKIP', p.id, s, e.message.slice(0, 160)); }
  }
}));
console.log(`judged ${Object.keys(out).length}/${Object.keys(res).length}`);
