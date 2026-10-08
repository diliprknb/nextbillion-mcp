import { describe, expect, it } from 'vitest';
import type { PageRecord } from '../../src/docs/types.js';
import {
  apiSlug,
  dedupe,
  endpointFor,
  extractParameters,
  parseTable,
  unitsFrom,
} from '../../scripts/docs/parameters.js';

const page = (overrides: Partial<PageRecord>): PageRecord => ({
  doc_id: 'routing/directions-api/directions-api',
  title: 'Directions API',
  category: 'Routing',
  api: 'Directions API',
  page_type: 'reference',
  source_url: 'https://docs.nextbillion.ai/routing/directions-api',
  path: 'Routing/Directions API/directions-api.md',
  sections: [],
  ...overrides,
});

const directions = [
  '# Directions API',
  '',
  '## Directions Flexible API',
  '',
  '### Request Parameters',
  '',
  '| Name | Required | Format and Usage | Description |',
  '|------|----------|------------------|-------------|',
  '| `truck_weight` | No | Type: `integer`<br>Default: `5000`<br>Minimum value: 1,<br>Maximum value: 100,000<br>Example: `truck_weight=11770` | Weight of the truck including trailers, in kilograms. Effective only when `mode=truck`. |',
  '| `mode` | No | Type: `string`<br>Default: `car`<br>Allowed values: `car`, `truck`<br>Example: `mode=car` | Driving mode. |',
  '| `origin` | Yes | Type: `string`<br>Format: `latitude,longitude` | Starting point. |',
  '',
  '### Response Schema',
  '',
  '| Field | Type | Description |',
  '|-------|------|-------------|',
  '| `status` | string | State of the response. |',
  '',
  '## Directions Fast API',
  '',
  '### Request Parameters',
  '',
  '| Name | Required | Format and Usage | Description |',
  '|------|----------|------------------|-------------|',
  '| `departure_time` | No | Type: `integer` | Departure as a UNIX timestamp in seconds. |',
  '',
  '## API Query Limits',
  '',
  '| Property | Item 1 (Sofa) | Item 2 (Table) |',
  '| --- | --- | --- |',
  '| size | 3 | 4 |',
].join('\n');

const geofence = [
  '# Geofence API',
  '',
  '## Create a Geofence',
  '',
  '### Request Parameter',
  '',
  '| Name | Required | Format and Usage | Description |',
  '| --- | --- | --- | --- |',
  '| `key` | Yes | Type: `string` | API key. |',
  '',
  '### Request Body',
  '',
  '| Field | Type | Description |',
  '|-------|------|-------------|',
  '| `circle.radius` | number | Radius of the circle in meters. |',
  '| `name` | string | Name of the geofence. |',
  '',
  '## Batch Create Geofences',
  '',
  '### Request Body',
  '',
  '| Field | Type | Description |',
  '|-------|------|-------------|',
  '| `geofences` | array of objects | Geofences to create. |',
].join('\n');

describe('endpointFor and apiSlug', () => {
  it('derives the api slug and the variant from headings', () => {
    expect(apiSlug('Directions API')).toBe('directions');
    expect(apiSlug('Search Places API')).toBe('search-places');
    const p = page({});
    expect(
      endpointFor(p, ['Directions API', 'Directions Flexible API', 'Request Parameters']),
    ).toBe('directions/flexible');
    expect(endpointFor(p, ['Directions API', 'API Query Limits'])).toBe('directions');
    const g = page({ doc_id: 'tracking/geofence-api/geofence-api', api: 'Geofence API' });
    expect(endpointFor(g, ['Geofence API', 'Create a Geofence', 'Request Body'])).toBe(
      'geofence/create',
    );
    expect(endpointFor(g, ['Geofence API', 'Batch Create Geofences', 'Request Body'])).toBe(
      'geofence/batch-create',
    );
    const sync = page({ doc_id: 'routing/distance-matrix/synchronous', api: 'Distance Matrix' });
    expect(
      endpointFor(sync, ['Distance Matrix', 'Distance Matrix Fast API', 'Request Parameters']),
    ).toBe('distance-matrix/synchronous-fast');
    const browse = page({
      doc_id: 'places/search/search-places-api/browse-api',
      api: 'Search Places API',
    });
    expect(endpointFor(browse, ['Browse API', 'Request Parameters'])).toBe('search-places/browse');
  });
});

describe('parseTable and unitsFrom', () => {
  it('parses headers and rows and rejects non-tables', () => {
    const table = parseTable(['| A | B |', '| --- | --- |', '| 1 | x \\| y |'])!;
    expect(table.headers).toEqual(['A', 'B']);
    expect(table.rows).toEqual([['1', 'x | y']]);
    expect(parseTable(['| A | B |', '| 1 | 2 |', '| 3 | 4 |'])).toBeUndefined();
  });

  it('takes units only from the docs wording', () => {
    expect(unitsFrom('Weight of the truck in kilograms.')).toBe('kilograms');
    expect(unitsFrom('Radius in meters')).toBe('meters');
    expect(unitsFrom('Departure as a UNIX timestamp in seconds.')).toBe('seconds');
    expect(unitsFrom('Time as a unix epoch')).toBe('unix timestamp (seconds)');
    expect(unitsFrom('Weight of the truck.')).toBeNull();
  });
});

describe('extractParameters', () => {
  it('reads the query-parameter layout with its format cell, per API variant', () => {
    const records = extractParameters(page({}), directions);
    const weight = records.find((r) => r.name === 'truck_weight')!;
    expect(weight).toMatchObject({
      endpoint: 'directions/flexible',
      type: 'integer',
      required: false,
      default: '5000',
      minimum: '1',
      maximum: '100,000',
      example: 'truck_weight=11770',
      units: 'kilograms',
      location: 'query',
    });
    expect(weight.heading_path).toEqual([
      'Directions API',
      'Directions Flexible API',
      'Request Parameters',
    ]);
    expect(records.find((r) => r.name === 'mode')!.allowed_values).toEqual(['car', 'truck']);
    expect(records.find((r) => r.name === 'origin')!.required).toBe(true);
    expect(records.find((r) => r.name === 'departure_time')).toMatchObject({
      endpoint: 'directions/fast',
      units: 'seconds',
    });
  });

  it('skips response tables and tables that are not parameter tables', () => {
    const names = extractParameters(page({}), directions).map((r) => r.name);
    expect(names).not.toContain('status');
    expect(names).not.toContain('size');
  });

  it('reads request bodies and nested field names, with required unknown', () => {
    const records = extractParameters(
      page({ doc_id: 'tracking/geofence-api/geofence-api', api: 'Geofence API' }),
      geofence,
    );
    const radius = records.find((r) => r.name === 'circle.radius')!;
    expect(radius).toMatchObject({
      endpoint: 'geofence/create',
      type: 'number',
      required: null,
      units: 'meters',
      location: 'body',
    });
    expect(records.find((r) => r.name === 'key')!.location).toBe('query');
    expect(records.find((r) => r.name === 'geofences')!.endpoint).toBe('geofence/batch-create');
  });

  it('dedupes by endpoint and name keeping the first record', () => {
    const a = extractParameters(page({}), directions);
    const merged = dedupe([...a, ...a]);
    expect(merged).toHaveLength(a.length);
  });
});
