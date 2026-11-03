import { NbClient } from '../../src/nbclient/client.js';

export interface RecordedRequest {
  url: URL;
  method: string;
  body: unknown;
}

export interface FakeFetchOptions {
  /** Responses returned in order; the last one repeats. Defaults to `{}` JSON. */
  responses?: Array<{ status?: number; body?: unknown; contentType?: string }>;
  /** API key the fake client sends; defaults to `test-key-1234`. */
  apiKey?: string;
}

/** An NbClient whose fetch records every request and replays canned responses. */
export function fakeNbClient(options: FakeFetchOptions = {}): {
  nb: NbClient;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fetchFn: typeof fetch = async (input, init) => {
    const spec = options.responses?.[Math.min(call, (options.responses?.length ?? 1) - 1)] ?? {};
    call++;
    requests.push({
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const contentType = spec.contentType ?? 'application/json';
    const payload =
      spec.body instanceof Uint8Array ? (spec.body as Uint8Array) : JSON.stringify(spec.body ?? {});
    return new Response(payload as BodyInit, {
      status: spec.status ?? 200,
      headers: { 'content-type': contentType },
    });
  };
  const nb = new NbClient({
    apiKey: options.apiKey ?? 'test-key-1234',
    fetchFn,
    sleepFn: async () => {},
  });
  return { nb, requests };
}
