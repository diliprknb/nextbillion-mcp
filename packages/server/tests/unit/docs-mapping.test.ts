import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  docIdForPath,
  mapDocPath,
  slugify,
  stripFragment,
  type UrlOverrides,
} from '../../scripts/docs/mapping.js';

const docsDir = fileURLToPath(new URL('../../docs/', import.meta.url));
const read = (name: string): string => readFileSync(`${docsDir}${name}`, 'utf8');
const list = (name: string): string[] =>
  read(name)
    .split('\n')
    .filter((l) => l.length > 0);

const overrides = JSON.parse(read('url-overrides.json')) as UrlOverrides;
const files = list('docs-files.txt');
const sitemap = new Set(list('sitemap-urls.txt'));

const urlOf = (relPath: string): string => {
  const result = mapDocPath(relPath, overrides);
  if (result.kind !== 'url') throw new Error(`${relPath} is excluded: ${result.reason}`);
  return result.path;
};

describe('slugify and docIdForPath', () => {
  it('lower-cases and dashes non-alphanumerics', () => {
    expect(slugify('Mobile SDKs')).toBe('mobile-sdks');
    expect(slugify('Dynamics 365')).toBe('dynamics-365');
    expect(slugify('skill_example')).toBe('skill-example');
    expect(slugify('iOS')).toBe('ios');
    expect(slugify('  Route Optimization API ')).toBe('route-optimization-api');
  });

  it('derives the spec doc_id from the repo path', () => {
    expect(
      docIdForPath('Routing/Directions API/Examples/legal-routes-for-a-given-truck-weight.md'),
    ).toBe('routing/directions-api/examples/legal-routes-for-a-given-truck-weight');
    expect(docIdForPath('Places/Geocoding/Batch Geocode/batch-geocode.md')).toBe(
      'places/geocoding/batch-geocode/batch-geocode',
    );
  });

  it('strips URL fragments', () => {
    expect(stripFragment('places/search/search-places-api#browse-api')).toBe(
      'places/search/search-places-api',
    );
    expect(stripFragment('routing/directions-api')).toBe('routing/directions-api');
  });
});

describe('mapDocPath rules', () => {
  it('publishes an index page at its folder URL', () => {
    expect(urlOf('Routing/Directions API/directions-api.md')).toBe('routing/directions-api');
    expect(urlOf('Integrations/integrations.md')).toBe('integrations');
  });

  it('keeps nested example and tutorial paths', () => {
    expect(urlOf('Routing/Directions API/Examples/legal-routes-for-a-given-truck-weight.md')).toBe(
      'routing/directions-api/examples/legal-routes-for-a-given-truck-weight',
    );
    expect(urlOf('Optimization/Route Optimization API/Tutorials/depots.md')).toBe(
      'optimization/route-optimization-api/tutorials/depots',
    );
  });

  it('rewrites aliased folders and keeps the remainder', () => {
    expect(urlOf('Routing/Distance Matrix/synchronous.md')).toBe(
      'routing/distance-matrix-api/synchronous',
    );
    expect(urlOf('Maps/Mobile SDKs/Android/Examples/simple-mapview.md')).toBe(
      'maps/android-maps-sdk/examples/simple-mapview',
    );
    expect(urlOf('Maps/Mobile SDKs/Web Maps/Style Specification/root.md')).toBe(
      'maps/web-maps-sdk-v2/style-specification/root',
    );
  });

  it('collapses the index page before applying a folder alias', () => {
    expect(urlOf('Places/Geocoding/Batch Geocode/batch-geocode.md')).toBe(
      'places/geocoding/batch-api',
    );
    expect(urlOf('Places/Place Lookup/place-lookup.md')).toBe('places/place-lookup-api');
  });

  it('applies page overrides, including section fragments', () => {
    expect(urlOf('Places/Search/Search Places API/browse-api.md')).toBe(
      'places/search/search-places-api#browse-api',
    );
    expect(urlOf('Integrations/ServiceNow/service-now.md')).toBe('integrations/service-now');
  });

  it('reports explicit exclusions with a reason', () => {
    const result = mapDocPath('README.md', overrides);
    expect(result.kind).toBe('excluded');
    if (result.kind === 'excluded') expect(result.reason.length).toBeGreaterThan(0);
  });

  it('resolves the reference pages behind the Places and Routing tools', () => {
    const expected: Record<string, string> = {
      'Places/Geocoding/Batch Geocode/batch-geocode.md': 'places/geocoding/batch-api',
      'Places/Geocoding/Forward Geocode/forward-geocode.md': 'places/geocoding/forward-api',
      'Places/Geocoding/Reverse Geocode/reverse-geocode.md': 'places/geocoding/reverse-api',
      'Places/Geocoding/Structured Geocode/structured-geocode.md':
        'places/geocoding/structured-api',
      'Places/Geocoding/Geocode Postcode/geocode-postcode.md': 'places/geocoding/postcode-api',
      'Places/Place Lookup/place-lookup.md': 'places/place-lookup-api',
      'Places/Autosuggestions/autosuggest-api.md': 'places/autosuggestions-api',
      'Places/Autosuggestions/autocomplete-api.md': 'places/autocomplete-api',
      'Places/Search/Search Places API/discover-api.md':
        'places/search/search-places-api#discover-api',
      'Places/Search/Search Along Route API/search-along-route-api.md':
        'places/search/search-along-route-api',
      'Routing/Directions API/directions-api.md': 'routing/directions-api',
      'Routing/Distance Matrix/synchronous.md': 'routing/distance-matrix-api/synchronous',
      'Routing/Isochrone API/isochrone-api.md': 'routing/isochrone-api',
      'Maps/Static Images API/static-images-api.md': 'maps/static-images-api',
    };
    for (const [file, path] of Object.entries(expected)) {
      expect(urlOf(file), file).toBe(path);
      expect(sitemap.has(stripFragment(path)), `${path} is live`).toBe(true);
    }
  });
});

describe('coverage of the committed docs snapshot', () => {
  it('maps every page to a live URL or excludes it explicitly', () => {
    const problems: string[] = [];
    for (const file of files) {
      const result = mapDocPath(file, overrides);
      if (result.kind === 'url' && !sitemap.has(stripFragment(result.path))) {
        problems.push(`${file} -> ${result.path}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('never sends two pages to the same URL without fragments', () => {
    const plain = new Map<string, string[]>();
    for (const file of files) {
      const result = mapDocPath(file, overrides);
      if (result.kind !== 'url' || result.path.includes('#')) continue;
      plain.set(result.path, [...(plain.get(result.path) ?? []), file]);
    }
    const duplicates = [...plain.entries()].filter(([, owners]) => owners.length > 1);
    expect(duplicates).toEqual([]);
  });

  it('has no stale page overrides', () => {
    const fileSet = new Set(files);
    expect(Object.keys(overrides.pages).filter((k) => !fileSet.has(k))).toEqual([]);
  });
});
