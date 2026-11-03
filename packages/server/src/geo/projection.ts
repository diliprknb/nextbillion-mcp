/**
 * A local equirectangular projection (metres, centred on the shape) for the planar
 * steps — nearest point on a segment, Douglas–Peucker, centroid. Good to well under a
 * metre over tens of kilometres at mid latitudes; distances reported to callers are
 * re-measured geodesically afterwards.
 */
import type { Position } from './types.js';

const EARTH_RADIUS = 6_371_008.8;

export interface LocalProjection {
  toXY(p: Position): [number, number];
  toPosition(xy: [number, number]): Position;
}

export function localProjection(reference: Position): LocalProjection {
  const lat0 = (reference[1] * Math.PI) / 180;
  const lon0 = reference[0];
  const kx = (EARTH_RADIUS * Math.PI * Math.cos(lat0)) / 180;
  const ky = (EARTH_RADIUS * Math.PI) / 180;
  return {
    toXY: (p) => [(p[0] - lon0) * kx, (p[1] - reference[1]) * ky],
    toPosition: (xy) => [xy[0] / kx + lon0, xy[1] / ky + reference[1]],
  };
}

export function centreOf(positions: Position[]): Position {
  let lon = 0;
  let lat = 0;
  for (const p of positions) {
    lon += p[0];
    lat += p[1];
  }
  return [lon / positions.length, lat / positions.length];
}
