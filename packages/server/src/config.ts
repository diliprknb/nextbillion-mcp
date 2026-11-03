export const DEFAULT_BASE_URL = 'https://api.nextbillion.io';
export const DEFAULT_TIMEOUT_MS = 30_000;

export class ConfigError extends Error {}

export interface HttpConfig {
  /** TCP port to listen on. Cloud Run sets PORT; default 8080. */
  port: number;
  /**
   * The public URL users enter in their MCP host, e.g. https://mcp.nextbillion.io. It is the
   * OAuth `resource` identifier and the base of the discovery documents, so it must match
   * exactly what users type (scheme, host, path, no trailing slash).
   */
  publicUrl: URL;
  /** OAuth authorization server issuer; defaults to the public URL (the server is its own AS). */
  issuerUrl: URL;
  baseUrl: string;
  timeoutMs: number;
}

/**
 * Configuration for the hosted (Streamable HTTP) mode. There is no server-wide API key:
 * every request carries the caller's credentials, so NBAI_API_KEY is deliberately ignored
 * (a fallback key would bill the operator for anonymous traffic).
 */
export function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const port = env.PORT ? Number(env.PORT) : 8080;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`PORT must be a TCP port number, got: ${env.PORT}`);
  }
  // Plain http is accepted for localhost, or anywhere with NBAI_ALLOW_HTTP=1 (private
  // networks while testing). Hosted Claude requires https.
  const allowHttp = /^(1|true|yes)$/i.test(env.NBAI_ALLOW_HTTP?.trim() ?? '');
  const publicUrl = parseHttpsUrl(
    env.NBAI_PUBLIC_URL?.trim() || 'https://mcp.nextbillion.io',
    'NBAI_PUBLIC_URL',
    allowHttp,
  );
  const issuerUrl = env.NBAI_ISSUER_URL?.trim()
    ? parseHttpsUrl(env.NBAI_ISSUER_URL.trim(), 'NBAI_ISSUER_URL', allowHttp)
    : publicUrl;
  const timeoutMs = env.NBAI_TIMEOUT_MS ? Number(env.NBAI_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigError(`NBAI_TIMEOUT_MS must be a positive number, got: ${env.NBAI_TIMEOUT_MS}`);
  }
  return {
    port,
    publicUrl,
    issuerUrl,
    baseUrl: env.NBAI_BASE_URL?.trim() || DEFAULT_BASE_URL,
    timeoutMs,
  };
}

function parseHttpsUrl(value: string, name: string, allowHttp = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} must be an absolute URL, got: ${value}`);
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (loopback || allowHttp))) {
    throw new ConfigError(
      `${name} must use https:// (http:// is allowed for localhost, or anywhere with NBAI_ALLOW_HTTP=1), got: ${value}`,
    );
  }
  if (url.search || url.hash)
    throw new ConfigError(`${name} must not carry a query or fragment: ${value}`);
  // Normalise: no trailing slash so `resource` compares equal to what hosts send.
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}
