/**
 * Point-in-polygon in flat degrees (ray casting), holes respected — the same model map
 * tiles use to draw polygons, so results match what a user sees on a map.
 */
import type { MultiPolygonCoords, Position, Ring } from './types.js';

export type Containment = 'inside' | 'boundary' | 'outside';

const EPS = 1e-12;

function onSegment(p: Position, a: Position, b: Position): boolean {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > EPS) return false;
  return (
    p[0] >= Math.min(a[0], b[0]) - EPS &&
    p[0] <= Math.max(a[0], b[0]) + EPS &&
    p[1] >= Math.min(a[1], b[1]) - EPS &&
    p[1] <= Math.max(a[1], b[1]) + EPS
  );
}

/** Ray casting on one ring; `boundary` when the point lies on an edge. */
export function ringContains(ring: Ring, p: Position): Containment {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (onSegment(p, a, b)) return 'boundary';
    const intersects =
      a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

/** Containment in a MultiPolygon: inside the outer ring and in no hole. */
export function contains(polygons: MultiPolygonCoords, p: Position): Containment {
  for (const poly of polygons) {
    const outer = ringContains(poly[0]!, p);
    if (outer === 'outside') continue;
    if (outer === 'boundary') return 'boundary';
    let inHole = false;
    for (let i = 1; i < poly.length; i += 1) {
      const h = ringContains(poly[i]!, p);
      if (h === 'boundary') return 'boundary';
      if (h === 'inside') {
        inHole = true;
        break;
      }
    }
    if (!inHole) return 'inside';
  }
  return 'outside';
}
