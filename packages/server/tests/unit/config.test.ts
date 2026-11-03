import { describe, expect, it } from 'vitest';
import { ConfigError, loadHttpConfig } from '../../src/config.js';

describe('loadHttpConfig (hosted mode)', () => {
  it('defaults to the production URL and port 8080', () => {
    const cfg = loadHttpConfig({});
    expect(cfg.publicUrl.origin).toBe('https://mcp.nextbillion.io');
    expect(cfg.issuerUrl.origin).toBe('https://mcp.nextbillion.io');
    expect(cfg.port).toBe(8080);
  });

  it('accepts plain http for localhost, or anywhere with NBAI_ALLOW_HTTP', () => {
    expect(loadHttpConfig({ NBAI_PUBLIC_URL: 'http://localhost:8080' }).publicUrl.port).toBe(
      '8080',
    );
    expect(() => loadHttpConfig({ NBAI_PUBLIC_URL: 'http://mcp.example:8090' })).toThrow(
      ConfigError,
    );
    const cfg = loadHttpConfig({
      NBAI_PUBLIC_URL: 'http://mcp.example:8090',
      NBAI_ALLOW_HTTP: '1',
      PORT: '8090',
    });
    expect(cfg.publicUrl.origin).toBe('http://mcp.example:8090');
    expect(cfg.issuerUrl.origin).toBe('http://mcp.example:8090');
    expect(cfg.port).toBe(8090);
  });

  it('rejects bad ports and URLs with a query or fragment', () => {
    expect(() => loadHttpConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadHttpConfig({ NBAI_PUBLIC_URL: 'https://mcp.nextbillion.io/?x=1' })).toThrow(
      /query/,
    );
    expect(() => loadHttpConfig({ NBAI_PUBLIC_URL: 'not a url' })).toThrow(/absolute URL/);
  });
});
