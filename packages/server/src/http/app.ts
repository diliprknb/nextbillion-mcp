import {
  createMcpHandler,
  verifyBearerToken,
  bearerAuthChallengeResponse,
  getOAuthProtectedResourceMetadataUrl,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { buildServer } from '../core/server.js';
import type { NbClient } from '../nbclient/client.js';
import { UnauthenticatedNbClient } from '../nbclient/unauthenticated.js';
import { ALL_TOOLS } from '../tools/index.js';
import {
  API_SCOPE,
  ApiKeyVerifier,
  apiKeyFromAuth,
  authenticationRequired,
  callsProtectedTool,
  protectedToolNames,
} from './auth.js';
import type { FetchApp } from './node-server.js';
import type { KeyRing } from './oauth/crypto.js';
import type { ApiKeyProbeResult } from './oauth/probe.js';
import { AuthorizationServer } from './oauth/server.js';

export interface HttpAppOptions {
  version: string;
  /** The URL users enter in their host; also the OAuth `resource`. No trailing slash. */
  publicUrl: URL;
  /** Issuer of the authorization server advertised to hosts. */
  issuerUrl: URL;
  /** Builds the API client for one request from the caller's key. */
  nbClientFactory: (apiKey: string) => NbClient;
  /** Token verifier; defaults to the authorization server's (or bare API keys without one). */
  verifier?: OAuthTokenVerifier;
  /**
   * Enables the built-in OAuth authorization server at `/oauth/*` (paste-your-API-key
   * sign-in). Without it the server only accepts bare API keys as bearer tokens.
   */
  oauth?: {
    keyRing: KeyRing;
    probeApiKey?: (apiKey: string) => Promise<ApiKeyProbeResult>;
    fetchFn?: typeof fetch;
  };
  /** Extra facts for /health (documentation index version and origin). */
  docsIndexInfo?: () => Record<string, unknown>;
}

const DOCS_URL = 'https://github.com/nextbillion-ai/nextbillion-mcp#readme';
const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

/**
 * The hosted server as a `fetch(Request) → Response` app. Stateless by construction: the
 * MCP SDK builds one server instance per request (`createMcpHandler`), and the API client
 * for that instance is created from the key carried in the request's bearer token. Nothing
 * about a caller is kept between requests.
 *
 * Routes:
 *   GET  /health, /healthz                         liveness (see note on /healthz below)
 *   GET  /.well-known/oauth-protected-resource     RFC 9728 document pointing at the issuer
 *   *    /.well-known/oauth-authorization-server, /oauth/{authorize,token,register}
 *                                                  the built-in authorization server (optional)
 *   *    <publicUrl.pathname>                      the MCP endpoint (both protocol eras)
 */
export function createHttpApp(options: HttpAppOptions): FetchApp {
  const authServer = options.oauth
    ? new AuthorizationServer({
        issuerUrl: options.issuerUrl,
        resourceUrl: options.publicUrl,
        keyRing: options.oauth.keyRing,
        probeApiKey: options.oauth.probeApiKey,
        fetchFn: options.oauth.fetchFn,
      })
    : undefined;
  const verifier = options.verifier ?? authServer?.verifier ?? new ApiKeyVerifier();
  const mcpPath = options.publicUrl.pathname || '/';
  const resource = options.publicUrl.href.replace(/\/$/, '');
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(options.publicUrl);
  const protectedTools = protectedToolNames(ALL_TOOLS);
  const protectedResourceMetadata = {
    resource,
    authorization_servers: [options.issuerUrl.href.replace(/\/$/, '')],
    bearer_methods_supported: ['header'],
    scopes_supported: [API_SCOPE],
    resource_name: 'NextBillion.ai MCP',
    resource_documentation: DOCS_URL,
  };

  const handler = createMcpHandler((ctx) => {
    const apiKey = apiKeyFromAuth(ctx.authInfo);
    const nb = apiKey ? options.nbClientFactory(apiKey) : new UnauthenticatedNbClient();
    return buildServer(nb, options.version);
  });

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      // /health is the public liveness URL; Google's front end intercepts the exact path
      // /healthz on run.app and custom domains (branded 404 before the container), so that one
      // is kept only for the container probes, which bypass the front end.
      if (path === '/health' || path === '/healthz') {
        return json({
          status: 'ok',
          name: 'nextbillion-mcp',
          version: options.version,
          ...(options.docsIndexInfo ? { docs: options.docsIndexInfo() } : {}),
        });
      }
      if (path === '/.well-known/oauth-protected-resource') {
        return wellKnown(request, protectedResourceMetadata);
      }
      if (authServer) {
        const handled = await authServer.handle(request);
        if (handled) return handled;
      }
      if (path !== mcpPath) {
        return json({ error: 'not_found', mcp_endpoint: resource }, 404);
      }
      if (request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html')) {
        return new Response(
          `nextbillion-mcp ${options.version}\n\nThis is an MCP server endpoint, not a web page. ` +
            `Add ${resource} to your MCP host (Claude, Claude Code, Cursor, Codex).\nDocs: ${DOCS_URL}\n`,
          { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } },
        );
      }

      // 1. Verify a bearer token when one is sent. A bad token is refused outright.
      const authorization = request.headers.get('authorization');
      let authInfo;
      if (authorization) {
        try {
          authInfo = await verifyBearerToken(authorization, { verifier, resourceMetadataUrl });
        } catch (error) {
          return bearerAuthChallengeResponse(error, { resourceMetadataUrl });
        }
      }

      // 2. Lazy authentication: anonymous requests may initialise, list tools and use the
      //    documentation tools; a call to an API tool gets the 401 that starts sign-in.
      let parsedBody: unknown;
      let forwarded = request;
      if (request.method === 'POST') {
        const text = await request.text();
        if (text.length > 0) {
          try {
            parsedBody = JSON.parse(text);
          } catch {
            return json({ error: 'invalid_request', error_description: 'Body is not JSON' }, 400);
          }
        }
        forwarded = new Request(request.url, {
          method: 'POST',
          headers: request.headers,
          body: text,
        });
        if (!authInfo) {
          const call = {
            mcpMethod: request.headers.get('mcp-method'),
            mcpName: request.headers.get('mcp-name'),
            body: parsedBody,
          };
          if (callsProtectedTool(call, protectedTools)) {
            return authenticationRequired(
              resourceMetadataUrl,
              'This tool calls the NextBillion.ai API; sign in or send your API key as a bearer token.',
            );
          }
        }
      }

      return handler.fetch(forwarded, { authInfo, parsedBody });
    },
    close: () => handler.close(),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Discovery documents are fetched cross-origin by hosts; answer CORS preflight and GET only. */
function wellKnown(request: Request, document: unknown): Response {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'mcp-protocol-version, content-type',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { ...cors, allow: 'GET, OPTIONS' } });
  }
  return new Response(JSON.stringify(document), {
    status: 200,
    headers: {
      ...cors,
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
    },
  });
}
