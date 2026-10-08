#!/usr/bin/env node
import { createRequire } from 'node:module';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, loadConfig, resolveImageDir } from './config.js';
import { buildServer, SERVER_NAME } from './core/server.js';
import { logError, logInfo } from './log.js';
import { NbClient } from './nbclient/client.js';

declare const __NBMCP_VERSION__: string | undefined;

/**
 * The version is injected by esbuild at build time so the bundled file is fully
 * standalone (it is also shipped inside the Claude Code plugin, where no package.json
 * sits next to it). Under tsx/vitest the define is absent and package.json is read.
 */
const pkg: { version: string } =
  typeof __NBMCP_VERSION__ === 'string'
    ? { version: __NBMCP_VERSION__ }
    : (createRequire(import.meta.url)('../package.json') as { version: string });

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    console.log(pkg.version);
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      `${SERVER_NAME} ${pkg.version} — MCP server for NextBillion.ai location APIs\n\n` +
        'Runs as an MCP stdio server; configure it in your MCP client, not by hand.\n\n' +
        'Environment variables:\n' +
        '  NBAI_API_KEY      (required) NextBillion.ai API key\n' +
        '  NBAI_BASE_URL     (optional) API base URL, default https://api.nextbillion.io\n' +
        '  NBAI_TIMEOUT_MS   (optional) per-request timeout, default 30000\n' +
        '  NBAI_IMAGE_DIR    (optional) also save rendered maps to this absolute directory, or\n' +
        '                    "tmp" for the OS temp dir; unset = nothing is written to disk\n' +
        '  NBAI_DOCS_INDEX   (optional) path to an alternative documentation index file\n',
    );
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      logError(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const nb = new NbClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
  });

  const imageDir = resolveImageDir();
  if (imageDir.warning) logError(imageDir.warning);
  else if (imageDir.dir) logInfo(`rendered map images will also be saved to ${imageDir.dir}`);

  const handle = serveStdio(() => buildServer(nb, pkg.version));
  logInfo(`${SERVER_NAME} ${pkg.version} listening on stdio`);

  const shutdown = () => {
    void handle.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
