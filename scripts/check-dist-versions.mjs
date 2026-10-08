// Verifies distribution manifests reference the same version as the npm package.
// Codex uses the plugin version as a cache key, so drift silently breaks installs.
import { readFileSync } from 'node:fs';

const serverVersion = JSON.parse(readFileSync('packages/server/package.json', 'utf8')).version;
const manifests = [
  'distributions/claude-code/.claude-plugin/plugin.json',
  'distributions/codex/.codex-plugin/plugin.json',
  'distributions/claude-desktop/manifest.json',
];
const marketplace = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
if (marketplace.plugins[0].version !== serverVersion) {
  console.error(
    `.claude-plugin/marketplace.json: version ${marketplace.plugins[0].version} != package version ${serverVersion}`,
  );
  process.exit(1);
}
// The Claude Code plugin runs its bundled dist/index.js (no npm pin); only Codex pins npx.
const mcpConfigs = ['distributions/codex/.mcp.json'];

let failed = false;
for (const path of manifests) {
  const manifestVersion = JSON.parse(readFileSync(path, 'utf8')).version;
  if (manifestVersion !== serverVersion) {
    console.error(`${path}: version ${manifestVersion} != package version ${serverVersion}`);
    failed = true;
  }
}
for (const path of mcpConfigs) {
  const config = readFileSync(path, 'utf8');
  if (!config.includes(`nextbillion-mcp@${serverVersion}`)) {
    console.error(`${path}: does not pin nextbillion-mcp@${serverVersion}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`All distribution manifests match version ${serverVersion}.`);
