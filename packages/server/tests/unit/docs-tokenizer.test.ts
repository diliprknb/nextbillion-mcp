import { describe, expect, it } from 'vitest';
import { expandQuery } from '../../src/docs/synonyms.js';
import { isIdentifier, stem, tokenize } from '../../src/docs/tokenizer.js';

describe('stem', () => {
  it('folds plurals and verb forms onto one form', () => {
    expect(stem('polygons')).toBe(stem('polygon'));
    expect(stem('routing')).toBe(stem('routes'));
    expect(stem('geocoding')).toBe(stem('geocode'));
    expect(stem('addresses')).toBe(stem('address'));
    expect(stem('batches')).toBe(stem('batch'));
    expect(stem('isochrones')).toBe(stem('isochrone'));
  });
});

describe('tokenize', () => {
  it('keeps identifiers whole and indexes their parts', () => {
    const terms = tokenize('set truck_weight and option=flexible');
    expect(terms).toContain('truck_weight');
    expect(terms).toContain('option=flexible');
    expect(terms).toContain('truck');
    expect(terms).toContain('weight');
    expect(terms).toContain('flexibl');
    expect(isIdentifier('truck_weight')).toBe(true);
    expect(isIdentifier('truck')).toBe(false);
  });

  it('drops stop words and question words, keeps digits unstemmed', () => {
    expect(tokenize('How do I get the ETA for 2 trucks?')).toEqual(['eta', '2', 'truck']);
  });

  it('is identical for index and query text', () => {
    expect(tokenize('Isochrone contours_minutes')).toEqual(tokenize('isochrone CONTOURS_MINUTES'));
  });
});

describe('expandQuery', () => {
  it('appends the docs vocabulary for everyday phrasing', () => {
    expect(expandQuery('reachable area in 15 minutes')).toContain('isochrone');
    expect(expandQuery('heavy vehicle route')).toContain('truck');
    expect(expandQuery('truck_weight')).toBe('truck_weight');
  });
});
