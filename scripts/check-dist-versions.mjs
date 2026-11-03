// Verifies the plugin manifests reference the same version as the server package.
// Codex uses the plugin version as a cache key, so drift silently breaks installs.
import { readFileSync } from 'node:fs';

const serverVersion = JSON.parse(readFileSync('packages/server/package.json', 'utf8')).version;
const manifests = [
  '.claude-plugin/marketplace.json',
  'distributions/claude-code/.claude-plugin/plugin.json',
  'distributions/codex/.codex-plugin/plugin.json',
];
let failed = false;
for (const path of manifests) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const version = path.endsWith('marketplace.json') ? json.plugins[0].version : json.version;
  if (version !== serverVersion) {
    console.error(`${path}: version ${version} != package version ${serverVersion}`);
    failed = true;
  }
}
// Both plugins must point at the hosted server; they carry no code.
for (const path of ['distributions/claude-code/.mcp.json', 'distributions/codex/.mcp.json']) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  const server = config.mcpServers?.nextbillion;
  if (server?.type !== 'http' || server?.url !== 'https://mcp.nextbillion.io') {
    console.error(
      `${path}: must declare the hosted server (type http, url https://mcp.nextbillion.io)`,
    );
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(
  `All distribution manifests match version ${serverVersion} and point at the hosted server.`,
);
