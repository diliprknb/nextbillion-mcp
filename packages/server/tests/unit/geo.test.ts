import { describe, expect, it } from 'vitest';
import { boundingBox } from '../../src/geo/bbox.js';
import { bufferArea, bufferLine, bufferPoint } from '../../src/geo/buffer.js';
import { centroidAndLabel } from '../../src/geo/centroid.js';
import { contains } from '../../src/geo/containment.js';
import { normaliseArea, toGeometry, validatePosition } from '../../src/geo/convert.js';
import {
  areaAndPerimeter,
  cardinal,
  destination,
  distance,
  inverse,
  lineLength,
  toAreaUnit,
  toUnit,
} from '../../src/geo/measure.js';
import { nearestCandidates, nearestOnLine } from '../../src/geo/nearest.js';
import { polygonOp } from '../../src/geo/polygon-ops.js';
import { simplifyArea } from '../../src/geo/simplify.js';
import { GeometryError, type Position } from '../../src/geo/types.js';

const BLR: Position = [77.5946, 12.9716];
const MAA: Position = [80.2707, 13.0827];
const DEL: Position = [77.209, 28.6139];
const BOM: Position = [72.8777, 19.076];
const square = (w: number, s: number, e: number, n: number) =>
  normaliseArea({
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  });

/** Relative tolerance of ±0.01 % (the approach doc's bar for geodesic values). */
const near = (actual: number, expected: number, rel = 1e-4) =>
  expect(Math.abs(actual - expected) / expected).toBeLessThan(rel);

describe('measure (geodesic, approach doc tests 1–5)', () => {
  it('distance Bangalore–Chennai = 290.54 km, Delhi–Mumbai = 1144.53 km', () => {
    near(toUnit(distance(BLR, MAA), 'kilometers'), 290.54);
    near(toUnit(distance(DEL, BOM), 'kilometers'), 1144.53);
  });
  it('bearing Bangalore→Chennai = 87.27°, cardinal E', () => {
    const r = inverse(BLR, MAA);
    expect(r.initialBearing).toBeCloseTo(87.27, 1);
    expect(cardinal(r.initialBearing)).toBe('E');
  });
  it('area of the 0.01° square near Bangalore = 120.03 ha', () => {
    const { area } = areaAndPerimeter(square(77.59, 12.97, 77.6, 12.98));
    near(toAreaUnit(area, 'hectares'), 120.03);
  });
  it('length of the two-point line = 3.426 km', () => {
    near(toUnit(lineLength([BLR, [77.62, 12.99]]), 'kilometers'), 3.426, 1e-3);
  });
  it('destination 100 km at 45° from Mumbai = 19.7135 N, 73.5522 E', () => {
    const [lon, lat] = destination(BOM, 45, 100_000);
    expect(lat).toBeCloseTo(19.7135, 3);
    expect(lon).toBeCloseTo(73.5522, 3);
  });
  it('subtracts holes from the area', () => {
    const outer = square(0, 0, 1, 1)[0]![0]!;
    const hole = square(0.25, 0.25, 0.75, 0.75)[0]![0]!;
    const withHole = areaAndPerimeter([[outer, hole]]).area;
    const full = areaAndPerimeter([[outer]]).area;
    near(withHole / full, 0.75, 1e-3);
  });
});

describe('containment (test 6) and buffer (test 7)', () => {
  it('finds the points inside a 1 km corridor around the line', () => {
    const corridor = bufferLine([BLR, [77.62, 12.99]], 1000, 16);
    expect(contains(corridor, [77.605, 12.98])).toBe('inside');
    expect(contains(corridor, [77.61, 12.985])).toBe('inside');
    expect(contains(corridor, [77.7, 13.05])).toBe('outside');
  });
  it('respects holes and reports boundary points', () => {
    const outer = square(0, 0, 10, 10)[0]![0]!;
    const hole = square(4, 4, 6, 6)[0]![0]!;
    expect(contains([[outer, hole]], [5, 5])).toBe('outside');
    expect(contains([[outer, hole]], [2, 2])).toBe('inside');
    expect(contains([[outer, hole]], [0, 5])).toBe('boundary');
  });
  it('buffers a point into a 16-step circle of the right radius', () => {
    const [[ring]] = bufferPoint(BLR, 500, 16);
    expect(ring!.length).toBe(17);
    for (const p of ring!.slice(0, -1)) expect(distance(BLR, p)).toBeCloseTo(500, 3);
  });
  it('splits a concave polygon into a MultiPolygon with a negative buffer, without throwing', () => {
    // Two 1.1 km blocks joined by a 220 m wide bridge; an inward buffer of 150 m removes
    // the bridge, leaving two separate polygons.
    const dumbbell = normaliseArea({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0.01, 0],
          [0.01, 0.004],
          [0.02, 0.004],
          [0.02, 0],
          [0.03, 0],
          [0.03, 0.01],
          [0.02, 0.01],
          [0.02, 0.006],
          [0.01, 0.006],
          [0.01, 0.01],
          [0, 0.01],
          [0, 0],
        ],
      ],
    });
    const result = bufferArea(dumbbell, -150, 16);
    expect(result.length).toBe(2);
    expect(toGeometry(result)?.type).toBe('MultiPolygon');
  });
  it('an outward buffer grows the area and keeps a single polygon', () => {
    const sq = square(77.59, 12.97, 77.6, 12.98);
    const grown = bufferArea(sq, 200, 16);
    expect(toGeometry(grown)?.type).toBe('Polygon');
    expect(areaAndPerimeter(grown).area).toBeGreaterThan(areaAndPerimeter(sq).area);
  });
});

describe('polygon_ops (tests 8–9)', () => {
  it('intersects two overlapping squares into the overlap', () => {
    const a = square(77.59, 12.97, 77.61, 12.99);
    const b = square(77.6, 12.98, 77.62, 13.0);
    const out = toGeometry(polygonOp('intersect', [a, b]));
    expect(out?.type).toBe('Polygon');
    const lons = (out as { coordinates: Position[][] }).coordinates[0]!.map((p) => p[0]);
    const lats = (out as { coordinates: Position[][] }).coordinates[0]!.map((p) => p[1]);
    expect(Math.min(...lons)).toBeCloseTo(77.6, 6);
    expect(Math.max(...lons)).toBeCloseTo(77.61, 6);
    expect(Math.min(...lats)).toBeCloseTo(12.98, 6);
    expect(Math.max(...lats)).toBeCloseTo(12.99, 6);
  });
  it('returns null for disjoint squares', () => {
    const out = polygonOp('intersect', [square(0, 0, 1, 1), square(2, 2, 3, 3)]);
    expect(toGeometry(out)).toBeNull();
  });
  it('union of disjoint squares is a MultiPolygon; difference removes the overlap', () => {
    expect(toGeometry(polygonOp('union', [square(0, 0, 1, 1), square(2, 2, 3, 3)]))?.type).toBe(
      'MultiPolygon',
    );
    const diff = polygonOp('difference', [square(0, 0, 2, 2), square(1, 1, 3, 3)]);
    near(areaAndPerimeter(diff).area / areaAndPerimeter(square(0, 0, 2, 2)).area, 0.75, 1e-3);
  });
});

describe('nearest (test 10), centroid (test 11), bbox (test 12)', () => {
  it('snaps a point to the Mumbai–Pune line', () => {
    const line: Position[] = [BOM, [73.8567, 18.5204]];
    const s = nearestOnLine([73.6, 19.5], line);
    expect(s.segmentIndex).toBe(0);
    expect(s.distance).toBeGreaterThan(0);
    expect(s.distanceAlongLine).toBeGreaterThan(0);
    expect(s.distanceAlongLine).toBeLessThan(lineLength(line));
    // The snapped point lies on the segment: its distance to the line's ends adds up.
    near(distance(line[0]!, s.position) + distance(s.position, line[1]!), lineLength(line), 1e-3);
  });
  it('ranks candidates by geodesic distance', () => {
    const r = nearestCandidates(BLR, [DEL, MAA, BOM], 2);
    expect(r.map((x) => x.index)).toEqual([1, 2]);
  });
  it('puts the label point inside a C shape whose centroid is outside', () => {
    const c = normaliseArea({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 9],
          [9, 9],
          [9, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    });
    const r = centroidAndLabel(c);
    expect(contains(c, r.labelPoint)).toBe('inside');
    expect(r.centroidInside).toBe(false);
  });
  it('detects an antimeridian-crossing point set and returns the narrow box', () => {
    const b = boundingBox([
      [179.5, 10],
      [-179.5, 11],
    ]);
    expect(b.crosses_antimeridian).toBe(true);
    expect(b.min_longitude).toBe(179.5);
    expect(b.max_longitude).toBe(-179.5);
    expect(b.min_latitude).toBe(10);
    expect(b.max_latitude).toBe(11);
    const plain = boundingBox([BLR, MAA], 1000);
    expect(plain.crosses_antimeridian).toBe(false);
    expect(plain.min_longitude).toBeLessThan(BLR[0]);
    expect(plain.max_latitude).toBeGreaterThan(MAA[1]);
  });
});

describe('validation (test 13) and simplification', () => {
  it('rejects latitude 95 and antimeridian-spanning polygons with clear errors', () => {
    expect(() => validatePosition([77, 95], 'point')).toThrow(/latitude 95/);
    expect(() =>
      normaliseArea({
        type: 'Polygon',
        coordinates: [
          [
            [179, 0],
            [-179, 0],
            [-179, 1],
            [179, 1],
          ],
        ],
      }),
    ).toThrow(GeometryError);
    expect(() => normaliseArea({ type: 'LineString', coordinates: [] })).toThrow(
      /Polygon or MultiPolygon/,
    );
  });
  it('accepts a Feature wrapper and auto-closes rings', () => {
    const poly = normaliseArea({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
      },
    });
    expect(poly[0]![0]!.length).toBe(5);
  });
  it('reduces a dense circle to the vertex budget', () => {
    const dense = bufferPoint(BLR, 1000, 400);
    const { polygons, simplified } = simplifyArea(dense, 60);
    expect(simplified).toBe(true);
    const n = polygons[0]![0]!.length;
    expect(n).toBeLessThanOrEqual(60);
    expect(n).toBeGreaterThan(8);
    near(areaAndPerimeter(polygons).area / areaAndPerimeter(dense).area, 1, 0.02);
  });
});
