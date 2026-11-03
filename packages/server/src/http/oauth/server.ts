import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { API_SCOPE, ApiKeyVerifier } from '../auth.js';
import { ClientError, ClientResolver, isLoopbackHost, redirectUriAllowed } from './clients.js';
import { KeyRing, nowSeconds, verifyPkceS256 } from './crypto.js';
import { logError } from '../../log.js';
import { SUBMIT_SCRIPT_CSP_SOURCE, renderErrorPage, renderSignInPage } from './page.js';
import type { ApiKeyProbeResult } from './probe.js';

export interface AuthorizationServerOptions {
  /** Issuer: the origin (and optional path) that serves `/.well-known/oauth-authorization-server`. */
  issuerUrl: URL;
  /** The MCP server this authorization server protects (RFC 8707 `resource`). */
  resourceUrl: URL;
  keyRing: KeyRing;
  /**
   * Optional check of the pasted key before a token is issued (see probe.ts). When absent,
   * any well-formed key is accepted and an invalid one fails on the first API tool call.
   */
  probeApiKey?: (apiKey: string) => Promise<ApiKeyProbeResult>;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Lifetimes in seconds. */
  ttl?: Partial<typeof DEFAULT_TTL>;
}

export const DEFAULT_TTL = {
  /** The sign-in page may stay open this long before the form must be reloaded. */
  request: 15 * 60,
  code: 2 * 60,
  access: 60 * 60,
  refresh: 30 * 24 * 60 * 60,
};

export const OAUTH_PATHS = {
  metadata: '/.well-known/oauth-authorization-server',
  authorize: '/oauth/authorize',
  token: '/oauth/token',
  register: '/oauth/register',
};

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' };

/**
 * A small OAuth 2.1 authorization server whose only account system is "the user has a
 * NextBillion.ai API key". Users paste the key once on the sign-in page; the server checks
 * it against the API and seals it into the tokens it issues. It keeps no state at all:
 * codes, tokens and dynamically registered clients are all self-contained encrypted
 * payloads (see crypto.ts). Revocation is resetting the key in the console.
 *
 * Meets what Claude's client requires (authorization-code + PKCE S256, CIMD and DCR,
 * form-urlencoded token endpoint, refresh-token rotation, `invalid_grant` on bad refresh
 * tokens, RFC 9207 `iss` on the redirect) and answers within milliseconds, well under the
 * 10-second budget hosts allow for these endpoints.
 */
export class AuthorizationServer {
  readonly issuer: string;
  readonly resource: string;
  readonly clients: ClientResolver;
  readonly verifier: OAuthTokenVerifier;
  private readonly ttl: typeof DEFAULT_TTL;
  private readonly now: () => number;
  private readonly bareKeys = new ApiKeyVerifier();

  constructor(private readonly options: AuthorizationServerOptions) {
    this.issuer = options.issuerUrl.href.replace(/\/$/, '');
    this.resource = options.resourceUrl.href.replace(/\/$/, '');
    this.ttl = { ...DEFAULT_TTL, ...options.ttl };
    this.now = options.now ?? nowSeconds;
    this.clients = new ClientResolver({ keyRing: options.keyRing, fetchFn: options.fetchFn });
    this.verifier = { verifyAccessToken: (token) => this.verifyAccessToken(token) };
  }

  /** RFC 8414 document. */
  metadata(): Record<string, unknown> {
    return {
      issuer: this.issuer,
      authorization_endpoint: this.issuer + OAUTH_PATHS.authorize,
      token_endpoint: this.issuer + OAUTH_PATHS.token,
      registration_endpoint: this.issuer + OAUTH_PATHS.register,
      scopes_supported: [API_SCOPE],
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      service_documentation: 'https://github.com/nextbillion-ai/nextbillion-mcp#readme',
    };
  }

  /** Routes the request if it is one of ours; `undefined` means "not an OAuth route". */
  async handle(request: Request): Promise<Response | undefined> {
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    switch (path) {
      case OAUTH_PATHS.metadata:
        return this.handleMetadata(request);
      case OAUTH_PATHS.register:
        return this.handleRegister(request);
      case OAUTH_PATHS.authorize:
        return request.method === 'POST'
          ? this.handleAuthorizeSubmit(request)
          : this.handleAuthorize(request);
      case OAUTH_PATHS.token:
        return this.handleToken(request);
      default:
        return undefined;
    }
  }

  // ── access tokens ────────────────────────────────────────────────────────────

  private async verifyAccessToken(token: string): Promise<AuthInfo> {
    const payload = this.options.keyRing.open('access', token, this.now());
    if (payload && typeof payload.k === 'string') {
      return {
        token,
        clientId: typeof payload.c === 'string' ? payload.c : 'unknown',
        scopes: [API_SCOPE],
        expiresAt: payload.exp,
        resource: new URL(this.resource),
        extra: { apiKey: payload.k, kind: 'oauth' },
      };
    }
    if (token.startsWith('v1.')) {
      throw new OAuthError(
        OAuthErrorCode.InvalidToken,
        'The access token is invalid or has expired',
      );
    }
    return this.bareKeys.verifyAccessToken(token);
  }

  // ── discovery & registration ────────────────────────────────────────────────

  private handleMetadata(request: Request): Response {
    const cors = corsHeaders();
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { ...cors, allow: 'GET, OPTIONS' } });
    }
    return json(this.metadata(), 200, { ...cors, 'cache-control': 'public, max-age=300' });
  }

  private async handleRegister(request: Request): Promise<Response> {
    const cors = corsHeaders();
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { ...cors, allow: 'POST, OPTIONS' } });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return oauthError('invalid_client_metadata', 'Request body must be JSON', 400, cors);
    }
    try {
      return json(this.clients.register(body), 201, { ...cors, ...NO_STORE });
    } catch (error) {
      if (error instanceof ClientError) return oauthError(error.code, error.message, 400, cors);
      throw error;
    }
  }

  // ── authorization endpoint ──────────────────────────────────────────────────

  private async handleAuthorize(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
    }
    const q = new URL(request.url).searchParams;
    const get = (name: string) => q.get(name) ?? undefined;
    const clientId = get('client_id');
    const redirectUri = get('redirect_uri');
    if (!clientId || !redirectUri) {
      return html(
        renderErrorPage(
          'Sign-in could not start',
          'The sign-in request from the application is incomplete.',
        ),
        400,
      );
    }

    let client;
    try {
      client = await this.clients.resolve(clientId);
    } catch (error) {
      const detail = error instanceof ClientError ? error.message : 'unknown client';
      logError(`sign-in: client ${clientId} rejected`, detail);
      return html(
        renderErrorPage(
          'Unknown application',
          'The application that started this sign-in could not be verified.',
        ),
        400,
      );
    }
    // Never redirect to an unregistered URI: that is how authorization codes get stolen.
    if (!redirectUriAllowed(redirectUri, client.redirectUris)) {
      return html(
        renderErrorPage(
          'Sign-in could not start',
          'The return address requested by the application is not registered.',
        ),
        400,
      );
    }

    const redirectError = (code: string, description: string) =>
      redirect(
        withParams(redirectUri, {
          error: code,
          error_description: description,
          state: get('state'),
          iss: this.issuer,
        }),
      );

    if (get('response_type') !== 'code')
      return redirectError('unsupported_response_type', 'response_type must be code');
    const challenge = get('code_challenge');
    if (!challenge || get('code_challenge_method') !== 'S256') {
      return redirectError('invalid_request', 'PKCE with code_challenge_method=S256 is required');
    }
    const resource = get('resource');
    if (resource && resource.replace(/\/$/, '') !== this.resource) {
      return redirectError('invalid_target', `resource must be ${this.resource}`);
    }
    const scope = get('scope');
    if (scope && scope.split(' ').some((s) => s && s !== API_SCOPE && s !== 'offline_access')) {
      return redirectError('invalid_scope', `supported scopes: ${API_SCOPE}`);
    }

    const requestToken = this.options.keyRing.seal(
      'code',
      { st: 'req', c: client.clientId, ru: redirectUri, ch: challenge, s: get('state') },
      this.ttl.request,
      this.now(),
    );
    return html(
      renderSignInPage({
        appHost: client.displayHost,
        appName: client.clientName,
        redirectHost: new URL(redirectUri).host,
        redirectIsLoopback: isLoopbackHost(new URL(redirectUri).hostname),
        requestToken,
      }),
      200,
      { redirectUri },
    );
  }

  private async handleAuthorizeSubmit(request: Request): Promise<Response> {
    const form = await readForm(request);
    if (!form)
      return html(
        renderErrorPage('Sign-in could not continue', 'The sign-in request is invalid.'),
        400,
      );
    const req = this.options.keyRing.open('code', form.get('request') ?? '', this.now());
    if (
      !req ||
      req.st !== 'req' ||
      typeof req.ru !== 'string' ||
      typeof req.c !== 'string' ||
      typeof req.ch !== 'string'
    ) {
      return html(renderErrorPage('Sign-in expired', 'This sign-in page has expired.'), 400);
    }
    const redirectUri = req.ru;
    const state = typeof req.s === 'string' ? req.s : undefined;
    const apiKey = (form.get('api_key') ?? '').trim();

    const again = async (error: string) => {
      let client;
      try {
        client = await this.clients.resolve(req.c as string);
      } catch {
        return html(
          renderErrorPage(
            'Unknown application',
            'The application that started this sign-in could not be verified.',
          ),
          400,
        );
      }
      return html(
        renderSignInPage({
          appHost: client.displayHost,
          appName: client.clientName,
          redirectHost: new URL(redirectUri).host,
          redirectIsLoopback: isLoopbackHost(new URL(redirectUri).hostname),
          requestToken: form.get('request') ?? '',
          error,
        }),
        400,
        { redirectUri },
      );
    };

    if (!ApiKeyVerifier.looksLikeKey(apiKey)) return again('Please enter a valid API key.');
    if (this.options.probeApiKey) {
      const probe = await this.options.probeApiKey(apiKey);
      if (probe === 'invalid') {
        return again('This API key is not valid. Check it in the console and try again.');
      }
      if (probe === 'restricted') {
        return again(
          'This API key has IP or origin restrictions. Allow the NextBillion.ai MCP service in the ' +
            "key's settings (see the documentation for the address), or use a key without restrictions.",
        );
      }
      if (probe === 'unavailable') {
        return again('The key could not be verified right now. Please try again in a moment.');
      }
    }

    const code = this.options.keyRing.seal(
      'code',
      { st: 'code', c: req.c, ru: redirectUri, ch: req.ch, k: apiKey },
      this.ttl.code,
      this.now(),
    );
    return redirect(withParams(redirectUri, { code, state, iss: this.issuer }));
  }

  // ── token endpoint ──────────────────────────────────────────────────────────

  private async handleToken(request: Request): Promise<Response> {
    const cors = corsHeaders();
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { ...cors, allow: 'POST, OPTIONS' } });
    }
    const form = await readForm(request);
    if (!form) {
      return oauthError(
        'invalid_request',
        'Body must be application/x-www-form-urlencoded',
        400,
        cors,
      );
    }
    const grant = form.get('grant_type');
    const now = this.now();

    if (grant === 'authorization_code') {
      const code = this.options.keyRing.open('code', form.get('code') ?? '', now);
      if (!code || code.st !== 'code' || typeof code.k !== 'string') {
        return oauthError(
          'invalid_grant',
          'The authorization code is invalid or has expired',
          400,
          cors,
        );
      }
      const clientId = form.get('client_id');
      if (clientId && clientId !== code.c)
        return oauthError('invalid_grant', 'client_id does not match the code', 400, cors);
      const redirectUri = form.get('redirect_uri');
      if (redirectUri && redirectUri !== code.ru)
        return oauthError('invalid_grant', 'redirect_uri does not match the code', 400, cors);
      const verifier = form.get('code_verifier');
      if (!verifier || !verifyPkceS256(verifier, code.ch as string)) {
        return oauthError('invalid_grant', 'PKCE code_verifier does not match', 400, cors);
      }
      return json(this.issueTokens(code.k, code.c as string, now), 200, { ...cors, ...NO_STORE });
    }

    if (grant === 'refresh_token') {
      const refresh = this.options.keyRing.open('refresh', form.get('refresh_token') ?? '', now);
      if (!refresh || typeof refresh.k !== 'string') {
        return oauthError(
          'invalid_grant',
          'The refresh token is invalid or has expired',
          400,
          cors,
        );
      }
      const clientId = form.get('client_id');
      if (clientId && clientId !== refresh.c)
        return oauthError('invalid_grant', 'client_id does not match the token', 400, cors);
      // Rotation: every refresh hands out a new refresh token; the old one lapses at its expiry.
      return json(this.issueTokens(refresh.k, refresh.c as string, now), 200, {
        ...cors,
        ...NO_STORE,
      });
    }

    return oauthError(
      'unsupported_grant_type',
      'grant_type must be authorization_code or refresh_token',
      400,
      cors,
    );
  }

  private issueTokens(apiKey: string, clientId: string, now: number): Record<string, unknown> {
    return {
      access_token: this.options.keyRing.seal(
        'access',
        { k: apiKey, c: clientId, r: this.resource },
        this.ttl.access,
        now,
      ),
      token_type: 'Bearer',
      expires_in: this.ttl.access,
      scope: API_SCOPE,
      refresh_token: this.options.keyRing.seal(
        'refresh',
        { k: apiKey, c: clientId },
        this.ttl.refresh,
        now,
      ),
    };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, mcp-protocol-version',
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * Error pages get a locked-down policy. The sign-in page additionally allows its submit
 * script (by hash) and, in `form-action`, the application's redirect URI: Chromium applies
 * `form-action` to the redirect that follows a form submission, so without the registered
 * redirect origin the browser blocks the hand-back to the application after a successful
 * sign-in.
 */
function html(body: string, status = 200, signIn?: { redirectUri: string }): Response {
  let formAction = "'self'";
  let scriptSrc = '';
  if (signIn) {
    formAction += ` ${new URL(signIn.redirectUri).origin}`;
    scriptSrc = `; script-src ${SUBMIT_SCRIPT_CSP_SOURCE}`;
  }
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...NO_STORE,
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'${scriptSrc}; form-action ${formAction}; base-uri 'none'`,
    },
  });
}

function oauthError(
  code: string,
  description: string,
  status: number,
  headers: Record<string, string>,
): Response {
  return json({ error: code, error_description: description }, status, { ...headers, ...NO_STORE });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, ...NO_STORE } });
}

function withParams(base: string, params: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}

async function readForm(request: Request): Promise<URLSearchParams | undefined> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.startsWith('application/x-www-form-urlencoded')) return undefined;
  return new URLSearchParams(await request.text());
}
