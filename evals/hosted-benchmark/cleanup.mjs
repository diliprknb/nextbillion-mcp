// Deletes the asset/geofence/road restriction ids passed as ASSET=..,GEOFENCE=..,RESTRICTION=.. from the drk server.
const D = import.meta.dirname;
const { MCPClientManager } = await import(D + '/../../node_modules/@mcpjam/sdk/dist/index.js');
const m = new MCPClientManager();
await m.connectToServer('drk', { url: 'https://nb-mcp-server-84559404454.us-central1.run.app/sse' });
const tools = (await m.listTools('drk')); const arr = tools.tools ?? tools;
for (const n of ['delete_asset', 'delete_geofence', 'delete_road_restriction']) console.log(n, JSON.stringify(Object.keys(arr.find((t) => t.name === n)?.inputSchema.properties ?? {})));
const key = process.env.NBAI_API_KEY;
const todo = [['delete_asset', process.env.ASSET, 'id'], ['delete_geofence', process.env.GEOFENCE, 'id'], ['delete_road_restriction', process.env.RESTRICTION, 'id']];
for (const [tool, id, f] of todo) { if (!id) continue;
  const props = arr.find((t) => t.name === tool).inputSchema.properties; const idKey = Object.keys(props).find((k) => k !== 'api_key' && /id/.test(k)) ?? f;
  const r = await m.executeTool('drk', tool, { [idKey]: id, api_key: key });
  console.log(tool, id, r.isError ? 'ERROR' : 'ok', (r.content?.[0]?.text ?? '').slice(0, 200).replace(/\s+/g, ' ')); }
process.exit(0);
