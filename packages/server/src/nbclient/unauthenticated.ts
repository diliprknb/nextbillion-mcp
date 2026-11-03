import { NbClient, type BinaryResponse, type Query } from './client.js';
import { NbApiError } from './errors.js';

const MESSAGE =
  'This tool calls the NextBillion.ai API and needs an API key. The request carried no ' +
  'Authorization header: sign in to the connector, or send `Authorization: Bearer <NBAI_API_KEY>`.';

/**
 * The client handed to API tools when an HTTP request arrives without credentials. The HTTP
 * layer answers protected tool calls with 401 before the server runs (so hosts start
 * sign-in); this is the defence in depth for anything that slips past that gate, and it
 * guarantees the documentation tools still work because they never touch the client.
 */
export class UnauthenticatedNbClient extends NbClient {
  constructor() {
    super({ apiKey: '' });
  }

  override getJson<T = unknown>(_path: string, _query?: Query): Promise<T> {
    return Promise.reject(new NbApiError({ url: '', message: MESSAGE }));
  }

  override postJson<T = unknown>(_path: string, _query: Query, _body: unknown): Promise<T> {
    return Promise.reject(new NbApiError({ url: '', message: MESSAGE }));
  }

  override getBinary(_path: string, _query?: Query): Promise<BinaryResponse> {
    return Promise.reject(new NbApiError({ url: '', message: MESSAGE }));
  }
}
