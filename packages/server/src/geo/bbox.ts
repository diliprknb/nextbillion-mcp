/** Bounding boxes with antimeridian awareness. */
import { destination } from './measure.js';
import type { Position } from './types.js';

export interface BBox {
  min_latitude: number;
  min_longitude: number;
  max_latitude: number;
  max_longitude: number;
  crosses_antimeridian: boolean;
}

/**
 * The smallest box around the positions. When the points straddle ±180 and the box
 * through the antimeridian is narrower than the one through Greenwich, that box is
 * returned (west > east) and `crosses_antimeridian` is true.
 */
export function boundingBox(positions: Position[], paddingMeters = 0): BBox {
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of positions) {
    if (p[1] < minLat) minLat = p[1];
    if (p[1] > maxLat) maxLat = p[1];
  }
  const lons = positions.map((p) => p[0]).sort((a, b) => a - b);
  // Largest gap between consecutive longitudes (including the wrap-around gap); the box
  // is everything except that gap.
  let gapStart = lons[lons.length - 1]!;
  let gapEnd = lons[0]! + 360;
  let gap = gapEnd - gapStart;
  for (let i = 1; i < lons.length; i += 1) {
    const g = lons[i]! - lons[i - 1]!;
    if (g > gap) {
      gap = g;
      gapStart = lons[i - 1]!;
      gapEnd = lons[i]!;
    }
  }
  let west = gapEnd > 180 ? gapEnd - 360 : gapEnd;
  let east = gapStart;
  const crosses = west > east;
  if (paddingMeters > 0) {
    const midLat = (minLat + maxLat) / 2;
    minLat = Math.max(-90, destination([west, minLat], 180, paddingMeters)[1]);
    maxLat = Math.min(90, destination([west, maxLat], 0, paddingMeters)[1]);
    west = destination([west, midLat], 270, paddingMeters)[0];
    east = destination([east, midLat], 90, paddingMeters)[0];
  }
  return {
    min_latitude: minLat,
    min_longitude: west,
    max_latitude: maxLat,
    max_longitude: east,
    crosses_antimeridian: crosses,
  };
}
