import {
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import type { NbTool } from '../tools/types.js';

/** The one scope this server knows: "call the NextBillion.ai API with the caller's key". */
export const API_SCOPE = 'nextbillion.api';

/**
 * Accepts a bare NextBillion.ai API key as the bearer token. Keys are opaque strings that
 * the console issues (documented as 32 alphanumeric characters; the check is kept loose
 * because internal keys have other lengths and the gateway is the authority). Nothing is validated against the API here: an
 * invalid key fails on the first API call with a readable 401 tool error, which keeps the
 * authentication step free of upstream latency (hosts give it 10 seconds).
 *
 * 0.4.0's OAuth authorization server adds encrypted tokens in front of this verifier; the
 * bare-key path stays for developers and CI (`Authorization: Bearer <NBAI_API_KEY>`).
 */
export class ApiKeyVerifier implements OAuthTokenVerifier {
  /**
   * Deliberately loose: keys issued by the console are 32 alphanumeric characters, but
   * internal keys come in other lengths and the API gateway is the only authority on what is
   * valid. This only rejects what cannot be sent as a bearer token or query value (empty,
   * whitespace/control characters, absurd length) and unexpanded `${...}` templates.
   */
  static readonly PATTERN = /^[\x21-\x7e]{1,512}$/;
  static looksLikeKey(value: string): boolean {
    return ApiKeyVerifier.PATTERN.test(value) && !/[${}"'`<>\\]/.test(value);
  }
  /** Tokens are re-presented on every call, so the expiry only has to satisfy the SDK. */
  static readonly TTL_SECONDS = 3600;

  verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!ApiKeyVerifier.looksLikeKey(token)) {
      return Promise.reject(
        new OAuthError(
          OAuthErrorCode.InvalidToken,
          'The bearer token is not a NextBillion.ai API key. Send `Authorization: Bearer <your API key>`.',
        ),
      );
    }
    return Promise.resolve({
      token,
      clientId: 'api-key',
      scopes: [API_SCOPE],
      expiresAt: Math.floor(Date.now() / 1000) + ApiKeyVerifier.TTL_SECONDS,
      extra: { apiKey: token, kind: 'api_key' },
    });
  }
}

/** The API key a verified request carries, if any. */
export function apiKeyFromAuth(auth: AuthInfo | undefined): string | undefined {
  const key = auth?.extra?.apiKey;
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

/**
 * Tools that call the NextBillion.ai API need the caller's key; the documentation tools
 * (closed world, in-process index) do not. The split follows the annotations the tools already
 * declare, so a new API tool is protected without a second list to maintain.
 */
export function protectedToolNames(tools: ReadonlyArray<NbTool>): ReadonlySet<string> {
  return new Set(tools.filter((t) => t.annotations?.openWorldHint === true).map((t) => t.name));
}

export interface InboundCall {
  /** `Mcp-Method` header (2026-07-28 revision routes on headers). */
  mcpMethod?: string | null;
  /** `Mcp-Name` header: the tool name for `tools/call`. */
  mcpName?: string | null;
  /** Parsed JSON body (2025-era requests carry the method inside). */
  body?: unknown;
}

/**
 * Whether an inbound request is a `tools/call` of a protected tool. Hosts only start sign-in
 * when the HTTP response itself is a 401, so this check runs before the MCP SDK sees the
 * request: a tool handler cannot produce a 401, only a 200 with a tool error.
 */
export function callsProtectedTool(
  call: InboundCall,
  protectedTools: ReadonlySet<string>,
): boolean {
  if (call.mcpMethod === 'tools/call') {
    return typeof call.mcpName === 'string' && protectedTools.has(call.mcpName);
  }
  const messages = Array.isArray(call.body) ? call.body : [call.body];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const { method, params } = message as { method?: unknown; params?: { name?: unknown } };
    if (
      method === 'tools/call' &&
      typeof params?.name === 'string' &&
      protectedTools.has(params.name)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The 401 that makes a host open its sign-in flow: `WWW-Authenticate: Bearer` with
 * `resource_metadata` pointing at the protected resource document and the scope to ask for.
 */
export function authenticationRequired(resourceMetadataUrl: string, description: string): Response {
  return bearerAuthChallengeResponse(new OAuthError(OAuthErrorCode.InvalidToken, description), {
    resourceMetadataUrl,
    requiredScopes: [API_SCOPE],
  });
}
