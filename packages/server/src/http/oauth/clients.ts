import type { KeyRing } from './crypto.js';

/** What the authorization server needs to know about the app asking for access. */
export interface ResolvedClient {
  clientId: string;
  /** Host shown on the consent page as the application asking for access. */
  displayHost: string;
  clientName?: string;
  redirectUris: string[];
  kind: 'cimd' | 'dcr';
}

export class ClientError extends Error {
  constructor(
    readonly code: 'invalid_client' | 'invalid_request' | 'invalid_client_metadata',
    message: string,
  ) {
    super(message);
  }
}

export interface ClientResolverOptions {
  keyRing: KeyRing;
  fetchFn?: typeof fetch;
  /** CIMD documents are cached for this long (hosts give the flow 10 seconds). */
  cacheTtlMs?: number;
  now?: () => number;
}

const DCR_PREFIX = 'dcr.';
const CIMD_TIMEOUT_MS = 5_000;

/**
 * Two registration-free ways for a client to identify itself, both stateless on our side:
 *
 * - **CIMD** (Client ID Metadata Document): `client_id` is an HTTPS URL that serves the
 *   client's own metadata. Claude's hosted apps and Claude Code use this. We fetch the
 *   document, check its `client_id` equals the URL, and take the redirect URIs from it.
 * - **DCR** (RFC 7591) for clients that register: instead of storing the registration, the
 *   returned `client_id` is the registration itself, sealed with the token key. Presenting
 *   the id proves it came from us; opening it gives the redirect URIs back.
 */
export class ClientResolver {
  private readonly cache = new Map<string, { until: number; client: ResolvedClient }>();
  private readonly fetchFn: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: ClientResolverOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.cacheTtlMs = options.cacheTtlMs ?? 300_000;
    this.now = options.now ?? Date.now;
  }

  /** RFC 7591 registration; returns the client information document to answer with. */
  register(metadata: unknown): Record<string, unknown> {
    const m = (metadata ?? {}) as Record<string, unknown>;
    const redirectUris = m.redirect_uris;
    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      !redirectUris.every(isHttpUrl)
    ) {
      throw new ClientError(
        'invalid_client_metadata',
        'redirect_uris must be a non-empty array of URLs',
      );
    }
    const authMethod = m.token_endpoint_auth_method ?? 'none';
    if (authMethod !== 'none') {
      throw new ClientError(
        'invalid_client_metadata',
        'only public clients are supported: token_endpoint_auth_method must be "none"',
      );
    }
    const clientName = typeof m.client_name === 'string' ? m.client_name.slice(0, 100) : undefined;
    const sealed = this.options.keyRing.seal('client', { ru: redirectUris, cn: clientName });
    return {
      client_id: DCR_PREFIX + sealed,
      client_id_issued_at: Math.floor(this.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      ...(clientName ? { client_name: clientName } : {}),
    };
  }

  async resolve(clientId: string): Promise<ResolvedClient> {
    if (clientId.startsWith(DCR_PREFIX)) {
      const payload = this.options.keyRing.open('client', clientId.slice(DCR_PREFIX.length));
      if (!payload || !Array.isArray(payload.ru)) {
        throw new ClientError('invalid_client', 'unknown client_id');
      }
      return {
        clientId,
        kind: 'dcr',
        redirectUris: payload.ru as string[],
        clientName: typeof payload.cn === 'string' ? payload.cn : undefined,
        displayHost: typeof payload.cn === 'string' ? payload.cn : 'a registered application',
      };
    }
    if (!/^https:\/\//.test(clientId)) {
      throw new ClientError(
        'invalid_client',
        'client_id must be an https:// metadata URL or a registered id',
      );
    }
    const cached = this.cache.get(clientId);
    if (cached && cached.until > this.now()) return cached.client;
    const client = await this.fetchCimd(clientId);
    this.cache.set(clientId, { until: this.now() + this.cacheTtlMs, client });
    return client;
  }

  private async fetchCimd(clientId: string): Promise<ResolvedClient> {
    let url: URL;
    try {
      url = new URL(clientId);
    } catch {
      throw new ClientError('invalid_client', 'client_id is not a valid URL');
    }
    let doc: Record<string, unknown>;
    try {
      const response = await this.fetchFn(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      doc = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      throw new ClientError(
        'invalid_client',
        `could not fetch the client metadata document: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (doc.client_id !== clientId) {
      throw new ClientError(
        'invalid_client',
        'client metadata document does not name itself as client_id',
      );
    }
    const redirectUris = doc.redirect_uris;
    if (!Array.isArray(redirectUris) || !redirectUris.every(isHttpUrl)) {
      throw new ClientError(
        'invalid_client',
        'client metadata document has no valid redirect_uris',
      );
    }
    return {
      clientId,
      kind: 'cimd',
      redirectUris: redirectUris as string[],
      clientName: typeof doc.client_name === 'string' ? doc.client_name : undefined,
      // The document is self-asserted; the host of its URL is what the user can trust.
      displayHost: url.host,
    };
  }
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Exact match, except that loopback redirect URIs (native apps such as Claude Code bind an
 * ephemeral port) match with the port ignored. RFC 8252 §7.3 requires this for 127.0.0.1
 * and [::1]; `localhost` gets the same treatment because Claude Code registers it.
 */
export function redirectUriAllowed(requested: string, registered: ReadonlyArray<string>): boolean {
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  if (req.hash) return false;
  for (const candidate of registered) {
    if (candidate === requested) return true;
    let reg: URL;
    try {
      reg = new URL(candidate);
    } catch {
      continue;
    }
    if (
      isLoopbackHost(reg.hostname) &&
      reg.hostname === req.hostname &&
      reg.protocol === req.protocol &&
      reg.pathname === req.pathname &&
      reg.search === req.search
    ) {
      return true;
    }
  }
  return false;
}

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}
