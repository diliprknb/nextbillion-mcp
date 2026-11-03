#!/usr/bin/env node
import { createRequire } from 'node:module';
import { ConfigError, loadHttpConfig } from './config.js';
import { buildServer, SERVER_NAME } from './core/server.js';
import {
  configureDocsIndex,
  docsIndexInfo,
  refreshDocsIndex,
  startDocsIndex,
} from './docs/store.js';
import { createHttpApp } from './http/app.js';
import { startHttpServer } from './http/node-server.js';
import { KeyRing } from './http/oauth/crypto.js';
import { defaultKeyCheckUrl, probeApiKey } from './http/oauth/probe.js';
import { logError, logInfo } from './log.js';
import { NbClient } from './nbclient/client.js';

declare const __NBMCP_VERSION__: string | undefined;

/**
 * The version is injected by esbuild at build time so the bundled file is fully
 * standalone. Under tsx/vitest the define is absent and package.json is read.
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
      `${SERVER_NAME} ${pkg.version} — the NextBillion.ai MCP server (hosted at https://mcp.nextbillion.io)\n\n` +
        'Serves MCP over Streamable HTTP. Callers sign in through the built-in OAuth server or send\n' +
        '`Authorization: Bearer <API key>`; there is no server-wide API key.\n\n' +
        'Environment variables:\n' +
        '  PORT              (optional) TCP port, default 8080\n' +
        '  NBAI_PUBLIC_URL   (optional) URL users enter, default https://mcp.nextbillion.io\n' +
        '  NBAI_ISSUER_URL   (optional) OAuth issuer, default = NBAI_PUBLIC_URL\n' +
        '  NBAI_ALLOW_HTTP   (optional) 1 = accept an http:// public URL (private test networks)\n' +
        '  NBAI_TOKEN_KEY    (required in production) 32-byte base64 key(s) that seal tokens;\n' +
        '                    comma-separated, current first, to rotate\n' +
        '  NBAI_KEY_CHECK_URL (optional) gateway URL used to check pasted keys at sign-in,\n' +
        '                    default <NBAI_BASE_URL>/h/geocode (an unbilled request)\n' +
        '  NBAI_DOCS_GITHUB_TOKEN (required for live docs) read token for the docs repository;\n' +
        '                    the index is rebuilt from it at start and whenever main moves\n' +
        '  NBAI_DOCS_REPO    (optional) owner/name, default nextbillion-ai/nb-public-docs\n' +
        '  NBAI_DOCS_REF     (optional) branch, default main\n' +
        '  NBAI_DOCS_REFRESH_MINUTES (optional) how often to check, default 10; 0 = once at start\n' +
        '  NBAI_BASE_URL     (optional) API base URL, default https://api.nextbillion.io\n' +
        '  NBAI_TIMEOUT_MS   (optional) per-request timeout, default 30000\n',
    );
    return;
  }
  void serveHttp();
}

/**
 * One process serves many callers over Streamable HTTP. Every request carries its own
 * credentials; nothing about a caller is kept between requests.
 */
async function serveHttp(): Promise<void> {
  let config;
  try {
    config = loadHttpConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      logError(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  if (process.env.NBAI_API_KEY) {
    logError('NBAI_API_KEY is ignored: callers send their own key per request');
  }

  let keys;
  try {
    keys = KeyRing.fromEnv(process.env.NBAI_TOKEN_KEY);
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  if (keys.ephemeral) {
    logError(
      'NBAI_TOKEN_KEY is not set: using a random key, so tokens will not survive a restart and ' +
        'other instances cannot read them. Set a 32-byte base64 key for any real deployment.',
    );
  }

  // Documentation: rebuilt in-process from the docs repository at start and whenever its
  // main branch moves (checked every NBAI_DOCS_REFRESH_MINUTES). Nothing is bundled: until
  // a build succeeds the documentation tools point at the public docs site. See docs/store.ts.
  const docsRepo = process.env.NBAI_DOCS_REPO?.trim() || 'nextbillion-ai/nb-public-docs';
  const docsToken = process.env.NBAI_DOCS_GITHUB_TOKEN?.trim() || undefined;
  const refreshMinutes = Number(process.env.NBAI_DOCS_REFRESH_MINUTES ?? 10);
  if (!docsToken) {
    logError(
      'NBAI_DOCS_GITHUB_TOKEN is not set: no documentation index; the documentation tools ' +
        'will point at the public docs site',
    );
  }
  configureDocsIndex(
    docsToken
      ? {
          github: {
            repo: docsRepo,
            ref: process.env.NBAI_DOCS_REF?.trim() || 'main',
            token: docsToken,
          },
        }
      : {},
  );
  if (docsToken) {
    void startDocsIndex().catch((error) =>
      logError('documentation index: start-up build failed', error),
    );
    if (refreshMinutes > 0) {
      setInterval(() => void refreshDocsIndex(), refreshMinutes * 60_000).unref();
    }
    logInfo(
      `documentation index: following ${docsRepo}` +
        (refreshMinutes > 0 ? `, checked every ${refreshMinutes} min` : ', checked once at start'),
    );
  }

  const app = createHttpApp({
    version: pkg.version,
    publicUrl: config.publicUrl,
    issuerUrl: config.issuerUrl,
    docsIndexInfo,
    nbClientFactory: (apiKey) =>
      new NbClient({ apiKey, baseUrl: config.baseUrl, timeoutMs: config.timeoutMs }),
    oauth: {
      keyRing: keys.ring,
      // Pasted keys are checked with an unbilled gateway request (see oauth/probe.ts);
      // NBAI_KEY_CHECK_URL overrides the endpoint.
      probeApiKey: (apiKey) =>
        probeApiKey(process.env.NBAI_KEY_CHECK_URL || defaultKeyCheckUrl(config.baseUrl), apiKey),
    },
  });
  const server = await startHttpServer(app, config.port);
  logInfo(
    `${SERVER_NAME} ${pkg.version} listening on http://0.0.0.0:${config.port}${config.publicUrl.pathname || '/'} (public URL ${config.publicUrl.href})`,
  );

  const shutdown = () => {
    server.close();
    void app.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
