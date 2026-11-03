/**
 * Checks a pasted API key against the NextBillion.ai gateway before a token is issued.
 *
 * The probe is `GET /h/geocode?key=…` with no query: the gateway authenticates the key
 * before it validates parameters or SKUs, so an unknown key gets 401 whatever the customer's
 * subscription, while a known key fails later (400 missing parameter, or 403 "Service not
 * enabled" when the customer lacks the geocoding SKU). Failed requests are not billed and
 * serve no result. A 403 whose message names the key's IP or origin restrictions means the
 * key is real but refuses requests from this server's address.
 */
export type ApiKeyProbeResult = 'valid' | 'invalid' | 'restricted' | 'unavailable';

export const DEFAULT_KEY_CHECK_PATH = '/h/geocode';

const RESTRICTION_MESSAGES = [/ip not allowed/i, /restricted sources/i, /mobile app not allowed/i];

export async function probeApiKey(
  checkUrl: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<ApiKeyProbeResult> {
  const url = new URL(checkUrl);
  url.searchParams.set('key', apiKey);
  try {
    const response = await fetchFn(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 401) return 'invalid';
    if (response.status === 403) {
      const body = await response.text().catch(() => '');
      return RESTRICTION_MESSAGES.some((re) => re.test(body)) ? 'restricted' : 'valid';
    }
    if (response.status >= 500) return 'unavailable';
    return 'valid';
  } catch {
    return 'unavailable';
  }
}

export function defaultKeyCheckUrl(baseUrl: string): string {
  return new URL(DEFAULT_KEY_CHECK_PATH, baseUrl.replace(/\/+$/, '') + '/').toString();
}
