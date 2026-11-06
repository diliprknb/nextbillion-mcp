// Saves each server's tool names to results/tools.json (used by judge.mjs and the report).
// Usage: set -a; . ./.env; set +a; node evals/claude-code-benchmark/list_tools.mjs
import { writeFileSync } from 'node:fs';
const D = import.meta.dirname;
const { MCPClientManager } = await import(D + '/../../node_modules/@mcpjam/sdk/dist/index.js');
const KEY = process.env.NBAI_API_KEY ?? process.env.NB_API_KEY;
const m = new MCPClientManager();
await m.connectToServer('off', { url: process.env.OFF_URL ?? 'https://mcp.nextbillion.io', requestInit: { headers: { Authorization: `Bearer ${KEY}` } } });
await m.connectToServer('drk', { url: process.env.DRK_URL ?? 'https://nb-mcp-server-84559404454.us-central1.run.app/sse', requestInit: { headers: { 'x-api-key': KEY } } });
const out = {};
for (const s of ['off', 'drk']) { const t = await m.listTools(s); out[s] = (t.tools ?? t).map((x) => x.name); console.log(s, out[s].length, 'tools'); }
writeFileSync(D + '/results/tools.json', JSON.stringify(out, null, 1));
process.exit(0);
