// Deletes the assets, geofences and road restrictions that the drk-side runs created, found in results/agent_results.json.
// Usage: set -a; . ./.env; set +a; DRY_RUN=1 node evals/claude-code-benchmark/cleanup.mjs   (list only)
//        set -a; . ./.env; set +a; node evals/claude-code-benchmark/cleanup.mjs              (delete)
// Only successful create calls are considered; ids are read from the saved tool results.
import { readFileSync } from 'node:fs';
const D = import.meta.dirname;
const { MCPClientManager } = await import(D + '/../../node_modules/@mcpjam/sdk/dist/index.js');
const KEY = process.env.NBAI_API_KEY ?? process.env.NB_API_KEY;
const res = JSON.parse(readFileSync(D + '/results/agent_results.json', 'utf8'));
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const found = []; // [deleteTool, id, runKey]
for (const [k, r] of Object.entries(res)) {
  if (r.server !== 'drk') continue;
  for (const c of r.calls) {
    if (c.isError) continue;
    const ids = c.result.match(UUID) ?? [];
    if (c.tool === 'create_asset') ids.slice(0, 1).forEach((id) => found.push(['delete_asset', id, k]));
    if (c.tool === 'create_geofence' || c.tool === 'batch_create_geofences') ids.forEach((id) => found.push(['delete_geofence', id, k]));
    if (c.tool === 'create_road_restriction') ids.slice(0, 1).forEach((id) => found.push(['delete_road_restriction', id, k]));
  }
}
console.log(found.length ? found.map((f) => `${f[0]} ${f[1]} (from ${f[2]})`).join('\n') : 'nothing to delete');
if (process.env.DRY_RUN || !found.length) process.exit(0);
const m = new MCPClientManager();
await m.connectToServer('drk', { url: process.env.DRK_URL ?? 'https://nb-mcp-server-84559404454.us-central1.run.app/sse', requestInit: { headers: { 'x-api-key': KEY } } });
for (const [tool, id] of found) {
  const r = await m.executeTool('drk', tool, { id, api_key: KEY });
  console.log(tool, id, r.isError ? 'ERROR' : 'ok', (r.content?.[0]?.text ?? '').slice(0, 160).replace(/\s+/g, ' '));
}
process.exit(0);
