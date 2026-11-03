/** Douglas–Peucker in metres (local projection), applied ring by ring. */
import { localProjection, centreOf } from './projection.js';
import type { MultiPolygonCoords, Position } from './types.js';

function dp(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length <= 2) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const len = Math.hypot(dx, dy);
  let maxDist = -1;
  let maxIndex = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i]!;
    const d =
      len === 0
        ? Math.hypot(p[0] - first[0], p[1] - first[1])
        : Math.abs(dy * p[0] - dx * p[1] + last[0] * first[1] - last[1] * first[0]) / len;
    if (d > maxDist) {
      maxDist = d;
      maxIndex = i;
    }
  }
  if (maxDist <= tolerance) return [first, last];
  const left = dp(points.slice(0, maxIndex + 1), tolerance);
  const right = dp(points.slice(maxIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

export function simplifyLine(line: Position[], toleranceMeters: number): Position[] {
  if (line.length <= 2 || toleranceMeters <= 0) return line;
  const proj = localProjection(centreOf(line));
  return dp(
    line.map((p) => proj.toXY(p)),
    toleranceMeters,
  ).map((xy) => proj.toPosition(xy));
}

/**
 * Simplifies every ring so that the whole shape has at most `maxVertices` vertices,
 * doubling the tolerance until it fits. Rings that would collapse below 4 vertices are
 * dropped. Returns the shape and whether anything changed.
 */
export function simplifyArea(
  polygons: MultiPolygonCoords,
  maxVertices: number,
): { polygons: MultiPolygonCoords; simplified: boolean; tolerance_meters: number } {
  const count = (p: MultiPolygonCoords) =>
    p.reduce((n, poly) => n + poly.reduce((m, r) => m + r.length, 0), 0);
  if (count(polygons) <= maxVertices) return { polygons, simplified: false, tolerance_meters: 0 };
  let tolerance = 1;
  let out = polygons;
  for (let i = 0; i < 24; i += 1) {
    out = polygons
      .map((poly) =>
        poly
          .map((ring) => {
            const open = ring.slice(0, -1);
            const simplified = simplifyRing(open, tolerance);
            return simplified.length >= 3 ? [...simplified, simplified[0]!] : [];
          })
          .filter((ring) => ring.length >= 4),
      )
      .filter((poly) => poly.length > 0);
    if (count(out) <= maxVertices) break;
    tolerance *= 2;
  }
  return { polygons: out, simplified: true, tolerance_meters: tolerance };
}

function simplifyRing(open: Position[], tolerance: number): Position[] {
  // Close the ring through its first vertex so Douglas–Peucker treats it as a loop:
  // simplify as a line that starts and ends at the same point, then drop the duplicate.
  const proj = localProjection(centreOf(open));
  const xy = [...open, open[0]!].map((p) => proj.toXY(p));
  const simplified = dp(xy, tolerance);
  return simplified.slice(0, -1).map((p) => proj.toPosition(p));
}
