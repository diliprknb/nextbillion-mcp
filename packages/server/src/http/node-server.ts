import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { logError, logInfo } from '../log.js';

/** A web-standard request handler: the shape produced by `createHttpApp`. */
export interface FetchApp {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

/**
 * Bridges Node's `http` server to a `fetch(Request) → Response` handler so the same app
 * can run on Cloud Run (Node) and be unit-tested without sockets. Request bodies are
 * streamed, responses are streamed (SSE included). Only `/healthz` and the MCP routes
 * live here; TLS, WAF and rate limiting are the edge's job (Cloudflare).
 */
export function startHttpServer(app: FetchApp, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    void handle(app, req, res);
  });
  // Cloud Run forwards idle connections for up to 15 min; keep Node's limits sane.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 300_000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

async function handle(app: FetchApp, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const started = Date.now();
  const method = req.method ?? 'GET';
  const path = req.url ?? '/';
  try {
    const response = await app.fetch(toWebRequest(req));
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    if (response.body) {
      // Streams SSE responses as they are produced; `pipeline` would wait for completion.
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(res);
      res.on('close', () => {
        logRequest(method, path, response.status, started);
      });
    } else {
      res.end();
      logRequest(method, path, response.status, started);
    }
  } catch (error) {
    logError(`${method} ${path} failed`, error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'server_error' }));
    } else {
      res.destroy();
    }
  }
}

function toWebRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? 'localhost';
  const proto = firstValue(req.headers['x-forwarded-proto']) ?? 'http';
  const url = new URL(req.url ?? '/', `${proto}://${host}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else headers.set(name, value);
  }
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(url, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as unknown as BodyInit) : undefined,
    // Required by undici when the body is a stream.
    ...(hasBody ? { duplex: 'half' as const } : {}),
  } as RequestInit);
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function logRequest(method: string, path: string, status: number, started: number): void {
  // Never log headers or bodies: they carry API keys and tokens.
  logInfo(`${method} ${path.split('?')[0]} ${status} ${Date.now() - started}ms`);
}
