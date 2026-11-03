/**
 * Geodesic buffers without JSTS: circles and capsules built from geographiclib
 * `Direct` points, merged with polyclip. Outward polygon buffers are the union of the
 * polygon with the buffer of its rings; inward (negative) buffers are the difference.
 * MultiPolygon results fall out naturally, so a shape that splits does not throw.
 */
import { destination, distance, inverse } from './measure.js';
import { polygonOp } from './polygon-ops.js';
import { simplifyLine } from './simplify.js';
import type { MultiPolygonCoords, Position, Ring } from './types.js';

/** A geodesic circle (closed ring) around `centre`. */
export function circle(centre: Position, radiusMeters: number, steps: number): Ring {
  const ring: Ring = [];
  for (let i = 0; i < steps; i += 1) {
    ring.push(destination(centre, (360 * i) / steps, radiusMeters));
  }
  ring.push(ring[0]!);
  return ring;
}

/** Buffer of one segment: a capsule = rectangle offset on both sides + two half circles. */
function segmentCapsule(a: Position, b: Position, radius: number, steps: number): Ring {
  const half = Math.max(4, Math.round(steps / 2));
  const ab = bearing(a, b);
  const ba = bearing(b, a);
  const ring: Ring = [];
  // Right side of a→b, then the cap around b, left side back, then the cap around a.
  ring.push(destination(a, ab + 90, radius));
  ring.push(destination(b, ab + 90, radius));
  for (let i = 1; i < half; i += 1) ring.push(destination(b, ab + 90 - (180 * i) / half, radius));
  ring.push(destination(b, ab - 90, radius));
  ring.push(destination(a, ba + 90, radius));
  for (let i = 1; i < half; i += 1) ring.push(destination(a, ba + 90 - (180 * i) / half, radius));
  ring.push(ring[0]!);
  return ring;
}

function bearing(a: Position, b: Position): number {
  return inverse(a, b).initialBearing;
}

export function bufferPoint(p: Position, radius: number, steps: number): MultiPolygonCoords {
  return [[circle(p, radius, steps)]];
}

/**
 * Corridor around a line. Vertices closer to the line than radius/20 cannot change the
 * corridor's outline by more than that, so the line is simplified first (a 2,000-point
 * route typically collapses to a few hundred segments); the capsules are then merged
 * pairwise (balanced tree) rather than in one n-way union, which keeps polyclip's
 * sweep fast for long lines.
 */
export function bufferLine(line: Position[], radius: number, steps: number): MultiPolygonCoords {
  const simplified = simplifyLine(line, radius / 20);
  const pieces: MultiPolygonCoords[] = [];
  for (let i = 0; i < simplified.length - 1; i += 1) {
    const a = simplified[i]!;
    const b = simplified[i + 1]!;
    if (distance(a, b) < 1e-6) continue;
    pieces.push([[segmentCapsule(a, b, radius, steps)]]);
  }
  if (pieces.length === 0) return bufferPoint(line[0]!, radius, steps);
  return unionAll(pieces);
}

/** Balanced pairwise union: O(n log n) polyclip work instead of one n-way sweep. */
export function unionAll(pieces: MultiPolygonCoords[]): MultiPolygonCoords {
  let level = pieces;
  while (level.length > 1) {
    const next: MultiPolygonCoords[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? polygonOp('union', [level[i]!, level[i + 1]!]) : level[i]!);
    }
    level = next;
  }
  return level[0]!;
}

export function bufferArea(
  polygons: MultiPolygonCoords,
  distanceMeters: number,
  steps: number,
): MultiPolygonCoords {
  const radius = Math.abs(distanceMeters);
  if (radius < 1e-6) return polygons;
  const ringBuffers: MultiPolygonCoords[] = [];
  for (const poly of polygons)
    for (const ring of poly) ringBuffers.push(bufferLine(ring, radius, steps));
  const edgeZone = unionAll(ringBuffers);
  return distanceMeters > 0
    ? polygonOp('union', [polygons, edgeZone])
    : polygonOp('difference', [polygons, edgeZone]);
}
