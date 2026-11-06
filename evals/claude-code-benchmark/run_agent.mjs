// Runs each evaluation prompt through headless Claude Code (`claude -p`) against one MCP server at a time.
// Usage (from repo root):
//   set -a; . ./.env; set +a
//   node evals/claude-code-benchmark/run_agent.mjs                  # all 48 prompts x 2 servers
//   ONLY=01-1,05-1 SERVERS=off CONC=2 node evals/claude-code-benchmark/run_agent.mjs
// Env: NBAI_API_KEY (required). CLAUDE_MODEL (optional, default = Claude Code's model), CONC (default 2),
//      MAX_TURNS (default 8), MAX_BUDGET_USD (per run, default 1.5), OFF_URL / DRK_URL (override endpoints).
// Resumable: finished runs live in results/agent_results.json; runs that never started are not saved.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const D = import.meta.dirname;
const KEY = process.env.NBAI_API_KEY ?? process.env.NB_API_KEY;
if (!KEY) { console.error('NBAI_API_KEY is not set'); process.exit(1); }
const OFF_URL = process.env.OFF_URL ?? 'https://mcp.nextbillion.io';
const DRK_URL = process.env.DRK_URL ?? 'https://nb-mcp-server-84559404454.us-central1.run.app/sse';
const CONC = Number(process.env.CONC ?? 2), MAX_TURNS = process.env.MAX_TURNS ?? '8', BUDGET = process.env.MAX_BUDGET_USD ?? '1.5';
const only = (process.env.ONLY ?? '').split(',').filter(Boolean);
const servers = (process.env.SERVERS ?? 'off,drk').split(',').filter(Boolean);
const prompts = JSON.parse(readFileSync(D + '/prompts.json', 'utf8')).filter((p) => !only.length || only.includes(p.id));
const OUT = D + '/results/agent_results.json';
const results = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
// Same MCP server name for both, so the model sees identical tool-name prefixes (mcp__nextbillion__*).
const SERVER_CFG = {
  off: { type: 'http', url: OFF_URL, headers: { Authorization: `Bearer ${KEY}` } },
  drk: { type: 'sse', url: DRK_URL, headers: { 'x-api-key': KEY } },
};
const SYS = 'You are an assistant connected to NextBillion.ai tools over MCP. Use the available tools to answer the user. When a tool returns an image or a map URL, mention it. Be concise and report any tool errors honestly.';

function runClaude(server, prompt) {
  return new Promise((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), 'ccbench-')); // empty cwd: no CLAUDE.md, no project settings
    const cfg = join(dir, 'mcp.json');
    writeFileSync(cfg, JSON.stringify({ mcpServers: { nextbillion: SERVER_CFG[server] } }), { mode: 0o600 });
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--mcp-config', cfg, '--strict-mcp-config',
      '--allowedTools', 'mcp__nextbillion', '--disallowedTools', 'Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,Agent,NotebookEdit',
      '--permission-mode', 'dontAsk', '--max-turns', MAX_TURNS, '--max-budget-usd', BUDGET, '--no-session-persistence',
      '--disable-slash-commands', '--setting-sources', '', '--append-system-prompt', SYS];
    if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL);
    const t0 = Date.now(); let out = '', err = '';
    const ch = spawn('claude', args, { cwd: dir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => ch.kill('SIGKILL'), Number(process.env.RUN_TIMEOUT_MS ?? 240000));
    ch.stdout.on('data', (b) => (out += b)); ch.stderr.on('data', (b) => (err += b));
    ch.on('close', (code) => { clearTimeout(timer); rmSync(dir, { recursive: true, force: true }); resolve({ code, out, err, ms: Date.now() - t0 }); });
  });
}

function parse(server, p, { code, out, err, ms }) {
  const events = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const res = events.findLast((e) => e.type === 'result');
  const calls = [], byId = new Map();
  for (const e of events) {
    if (e.type === 'assistant') for (const b of e.message?.content ?? []) if (b.type === 'tool_use') {
      const c = { tool: b.name.replace(/^mcp__nextbillion__/, ''), raw: b.name, args: b.input, isError: false, chars: 0, result: '' };
      calls.push(c); byId.set(b.id, c);
    }
    if (e.type === 'user') for (const b of e.message?.content ?? []) if (b.type === 'tool_result' && byId.has(b.tool_use_id)) {
      const c = byId.get(b.tool_use_id);
      const txt = Array.isArray(b.content) ? b.content.map((x) => (x.type === 'text' ? x.text : `[${x.type} content returned]`)).join('\n') : String(b.content ?? '');
      c.isError = !!b.is_error; c.chars = txt.length; c.result = txt.slice(0, 1500);
    }
  }
  const mcp = init?.mcp_servers?.find((s) => s.name === 'nextbillion');
  const connected = mcp?.status === 'connected';
  const u = res?.usage ?? {};
  return {
    server, id: p.id, ms, api_ms: res?.duration_api_ms ?? null, turns: res?.num_turns ?? null,
    model: init?.model ?? null, mcp_status: mcp?.status ?? 'missing', mcp_tools: (init?.tools ?? []).filter((t) => t.startsWith('mcp__nextbillion__')).length,
    tokens_in: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), tokens_out: u.output_tokens ?? 0,
    cost_usd: res?.total_cost_usd ?? null, calls, final: res?.result ?? '', subtype: res?.subtype ?? null,
    err: !connected ? `MCP server not connected (${mcp?.status ?? 'missing'})` : !res ? `no result event (exit ${code}) ${err.slice(0, 200)}` : res.is_error || res.subtype !== 'success' ? `${res.subtype}${res.is_error ? ' (is_error)' : ''}` : null,
  };
}

const jobs = []; for (const p of prompts) for (const s of servers) if (!results[`${p.id}|${s}`]) jobs.push([p, s]);
let done = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (jobs.length) {
    const [p, s] = jobs.shift(); const r = parse(s, p, await runClaude(s, p.prompt));
    if (r.mcp_status !== 'connected' || /no result event/.test(r.err ?? '')) { console.log(`SKIP ${p.id} ${s}: ${r.err}`); continue; } // infrastructure failure, not a server result
    results[`${p.id}|${s}`] = r; writeFileSync(OUT, JSON.stringify(results, null, 1));
    console.log(`${++done} ${p.id} ${s} ${(r.ms / 1000).toFixed(0)}s $${(r.cost_usd ?? 0).toFixed(3)} calls=${r.calls.map((c) => c.tool + (c.isError ? '!' : '')).join(',') || '-'} ${r.err ?? ''}`);
  }
}));
console.log(`finished: ${Object.keys(results).length}/${prompts.length * servers.length} runs saved`);
