// Builds the Claude Desktop extension bundle (.mcpb) from the server bundle.
//
// Stages manifest + server + icon + README + LICENSE into dist-mcpb/stage, validates the
// manifest with the official mcpb CLI, checks the declared tool names against the tools the
// bundled server actually serves, and packs dist-mcpb/nextbillion-mcp-<version>.mcpb.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'distributions/claude-desktop');
const bundle = join(root, 'packages/server/dist/index.js');
const mcpbCli = join(root, 'node_modules/@anthropic-ai/mcpb/dist/cli/cli.js');

function fail(message) {
  console.error(`build-mcpb: ${message}`);
  process.exit(1);
}

/** Tool names as served by the bundled server, in tools/list order. */
async function servedToolNames() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundle],
    env: { ...process.env, NBAI_API_KEY: 'build-time-placeholder' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'build-mcpb', version: '0.0.0' });
  await client.connect(transport);
  try {
    return (await client.listTools()).tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}

if (!existsSync(bundle))
  fail('packages/server/dist/index.js is missing; run `npm run build` first');
const version = JSON.parse(
  readFileSync(join(root, 'packages/server/package.json'), 'utf8'),
).version;
const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
if (manifest.version !== version) {
  fail(`manifest.json version ${manifest.version} != package version ${version}`);
}

// The extension must never write to disk: image saving stays opt-in and unexposed.
const configuredEnv = manifest.server?.mcp_config?.env ?? {};
if ('NBAI_IMAGE_DIR' in configuredEnv || 'NBAI_IMAGE_DIR' in (manifest.user_config ?? {})) {
  fail('NBAI_IMAGE_DIR must not be set or exposed by the extension');
}

const declared = (manifest.tools ?? []).map((tool) => tool.name);
const served = await servedToolNames();
if (JSON.stringify(declared) !== JSON.stringify(served)) {
  fail(
    `manifest.json tools do not match the served tools.\n  declared: ${declared.join(', ')}\n  served:   ${served.join(', ')}`,
  );
}

const out = join(root, 'dist-mcpb');
const stage = join(out, 'stage');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(stage, 'server'), { recursive: true });
writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
cpSync(bundle, join(stage, 'server/index.js'));
// The server resolves its documentation index at ../data/docs-index.json relative to itself.
mkdirSync(join(stage, 'data'), { recursive: true });
cpSync(join(root, 'packages/server/data/docs-index.json'), join(stage, 'data/docs-index.json'));
cpSync(join(source, 'icon.png'), join(stage, 'icon.png'));
cpSync(join(root, 'README.md'), join(stage, 'README.md'));
cpSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));

execFileSync(process.execPath, [mcpbCli, 'validate', join(stage, 'manifest.json')], {
  stdio: 'inherit',
});
const file = join(out, `nextbillion-mcp-${version}.mcpb`);
execFileSync(process.execPath, [mcpbCli, 'pack', stage, file], { stdio: 'inherit' });

const bytes = statSync(file).size;
const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
console.log(
  `\n${file}\n  size:   ${Math.round(bytes / 1024)} kB\n  sha256: ${sha256}\n  tools:  ${served.length}`,
);
