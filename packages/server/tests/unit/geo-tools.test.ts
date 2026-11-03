import { describe, expect, it } from 'vitest';
import { bbox } from '../../src/tools/geometry/bbox.js';
import { buffer } from '../../src/tools/geometry/buffer.js';
import { centroid } from '../../src/tools/geometry/centroid.js';
import { measure } from '../../src/tools/geometry/measure.js';
import { nearest } from '../../src/tools/geometry/nearest.js';
import { pointsInPolygon } from '../../src/tools/geometry/points-in-polygon.js';
import { polygonOps } from '../../src/tools/geometry/polygon-ops.js';
import { ToolInputError } from '../../src/tools/types.js';
import { fakeNbClient } from '../helpers/fake-fetch.js';
import { contains } from '../../src/geo/containment.js';
import { normaliseArea } from '../../src/geo/convert.js';

const nb = fakeNbClient().nb;
const BLR = { latitude: 12.9716, longitude: 77.5946 };
const MAA = { latitude: 13.0827, longitude: 80.2707 };

/** What `isochrone` returns per contour: a Feature wrapping a Polygon (approach doc test 14). */
const isochroneFeature = {
  type: 'Feature',
  properties: { contour: 10, metric: 'time' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-117.19, 32.69],
        [-117.13, 32.69],
        [-117.13, 32.74],
        [-117.19, 32.74],
        [-117.19, 32.69],
      ],
    ],
  },
};

describe('geometry tools (wrappers)', () => {
  it('measure: distance, bearing, length and area with units', async () => {
    const d = await measure.run({ mode: 'distance', from: BLR, to: MAA, units: 'kilometers' }, nb);
    expect(d.structuredContent).toMatchObject({ mode: 'distance', units: 'kilometers' });
    expect(d.structuredContent!.distance as number).toBeCloseTo(290.54, 1);
    const b = await measure.run({ mode: 'bearing', from: BLR, to: MAA }, nb);
    expect(b.structuredContent).toMatchObject({ cardinal: 'E' });
    const l = await measure.run(
      { mode: 'length', line: [BLR, { latitude: 12.99, longitude: 77.62 }], units: 'kilometers' },
      nb,
    );
    expect(l.structuredContent!.length as number).toBeCloseTo(3.426, 2);
    const a = await measure.run(
      { mode: 'area', polygon: isochroneFeature, area_units: 'square_kilometers' },
      nb,
    );
    expect(a.structuredContent!.area as number).toBeGreaterThan(30);
    expect(a.content[0]!.type).toBe('text');
  });

  it('measure: reports missing inputs as readable input errors', async () => {
    await expect(measure.run({ mode: 'distance', from: BLR }, nb)).rejects.toThrow(/from and to/);
    await expect(measure.run({ mode: 'area', polygon: { type: 'Point' } }, nb)).rejects.toThrow(
      ToolInputError,
    );
  });

  it('points_in_polygon accepts an isochrone Feature unchanged (test 14)', async () => {
    const r = await pointsInPolygon.run(
      {
        polygon: isochroneFeature,
        points: [
          { latitude: 32.7157, longitude: -117.1611, id: 'downtown' },
          { latitude: 32.8, longitude: -117.0, id: 'far' },
          { latitude: 32.72, longitude: -117.15 },
        ],
      },
      nb,
    );
    expect(r.structuredContent).toMatchObject({
      inside: ['downtown', 2],
      outside: ['far'],
      inside_count: 2,
      outside_count: 1,
    });
  });

  it('polygon_ops returns null for an empty intersection and a shape otherwise', async () => {
    const sq = (w: number, s: number, e: number, n: number) => ({
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
    const empty = await polygonOps.run(
      { operation: 'intersect', polygons: [sq(0, 0, 1, 1), sq(2, 2, 3, 3)] },
      nb,
    );
    expect(empty.structuredContent).toMatchObject({ result: null, area: 0 });
    const union = await polygonOps.run(
      {
        operation: 'union',
        polygons: [sq(0, 0, 1, 1), sq(0.5, 0.5, 1.5, 1.5)],
        area_units: 'square_kilometers',
      },
      nb,
    );
    expect((union.structuredContent!.result as { type: string }).type).toBe('Polygon');
    expect(union.structuredContent!.area as number).toBeGreaterThan(20000);
  });

  it('buffer: one input only, negative only for polygons, corridor returns a Polygon', async () => {
    await expect(buffer.run({ point: BLR, line: [BLR, MAA], distance: 1 }, nb)).rejects.toThrow(
      /exactly one/,
    );
    await expect(buffer.run({ point: BLR, distance: -5 }, nb)).rejects.toThrow(/negative/);
    const r = await buffer.run(
      {
        line: [BLR, { latitude: 12.99, longitude: 77.62 }],
        distance: 1,
        units: 'kilometers',
        area_units: 'square_kilometers',
      },
      nb,
    );
    expect((r.structuredContent!.result as { type: string }).type).toBe('Polygon');
    // Corridor ≈ 2 km × 3.4 km plus the round caps (π·1²) ≈ 10 km².
    expect(r.structuredContent!.area as number).toBeGreaterThan(9);
    expect(r.structuredContent!.area as number).toBeLessThan(11);
    expect(r.structuredContent!.simplified).toBe(false);
  });

  it('buffer simplifies to max_vertices and says so', async () => {
    const r = await buffer.run({ point: BLR, distance: 1000, steps: 64, max_vertices: 20 }, nb);
    expect(r.structuredContent).toMatchObject({ simplified: true });
    expect(r.structuredContent!.vertex_count as number).toBeLessThanOrEqual(20);
  });

  it('nearest: candidates or line, not both', async () => {
    await expect(nearest.run({ target: BLR }, nb)).rejects.toThrow(/either candidates or line/);
    const c = await nearest.run(
      {
        target: BLR,
        candidates: [
          { ...MAA, id: 'Chennai' },
          { latitude: 28.6139, longitude: 77.209, id: 'Delhi' },
        ],
        k: 2,
        units: 'kilometers',
      },
      nb,
    );
    const results = c.structuredContent!.results as Array<{ id: string; distance: number }>;
    expect(results.map((x) => x.id)).toEqual(['Chennai', 'Delhi']);
    expect(results[0]!.distance).toBeCloseTo(290.54, 1);
    const l = await nearest.run(
      {
        target: { latitude: 19.5, longitude: 73.6 },
        line: [
          { latitude: 19.076, longitude: 72.8777 },
          { latitude: 18.5204, longitude: 73.8567 },
        ],
      },
      nb,
    );
    expect(l.structuredContent).toMatchObject({ segment_index: 0, units: 'meters' });
    expect(l.structuredContent!.distance as number).toBeGreaterThan(0);
  });

  it('bbox: exactly one input, padding and antimeridian flag', async () => {
    await expect(bbox.run({}, nb)).rejects.toThrow(/exactly one/);
    const r = await bbox.run({ points: [BLR, MAA], padding_meters: 1000 }, nb);
    expect(r.structuredContent).toMatchObject({ crosses_antimeridian: false });
    expect(r.structuredContent!.min_longitude as number).toBeLessThan(BLR.longitude);
    const x = await bbox.run(
      {
        points: [
          { latitude: 10, longitude: 179.5 },
          { latitude: 11, longitude: -179.5 },
        ],
      },
      nb,
    );
    expect(x.structuredContent).toMatchObject({
      crosses_antimeridian: true,
      min_longitude: 179.5,
      max_longitude: -179.5,
    });
  });

  it('centroid returns an inside label point for a C shape', async () => {
    const cShape = {
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
    };
    const r = await centroid.run({ polygon: cShape }, nb);
    expect(r.structuredContent).toMatchObject({ centroid_inside: false });
    const lp = r.structuredContent!.label_point as { latitude: number; longitude: number };
    expect(contains(normaliseArea(cShape), [lp.longitude, lp.latitude])).toBe('inside');
  });

  it('rejects shapes across the antimeridian and oversized inputs with input errors', async () => {
    await expect(
      centroid.run(
        {
          polygon: {
            type: 'Polygon',
            coordinates: [
              [
                [179, 0],
                [-179, 0],
                [-179, 1],
                [179, 1],
                [179, 0],
              ],
            ],
          },
        },
        nb,
      ),
    ).rejects.toThrow(ToolInputError);
  });
});
