/** Nearest point in a set, and nearest position on a line, with geodesic distances. */
import { distance } from './measure.js';
import { localProjection, centreOf } from './projection.js';
import type { Position } from './types.js';

export interface Ranked {
  index: number;
  position: Position;
  distance: number;
}

export function nearestCandidates(target: Position, candidates: Position[], k: number): Ranked[] {
  return candidates
    .map((position, index) => ({ index, position, distance: distance(target, position) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k);
}

export interface Snapped {
  position: Position;
  distance: number;
  segmentIndex: number;
  distanceAlongLine: number;
}

/**
 * Closest position on the polyline to `target`: the perpendicular foot on each segment
 * in a local metric projection, then the final distance re-measured geodesically.
 */
export function nearestOnLine(target: Position, line: Position[]): Snapped {
  const proj = localProjection(centreOf([target, ...line]));
  const t = proj.toXY(target);
  const xy = line.map((p) => proj.toXY(p));
  let best: Snapped | undefined;
  let bestPlanar = Infinity;
  let along = 0;
  for (let i = 0; i < xy.length - 1; i += 1) {
    const a = xy[i]!;
    const b = xy[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const u =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((t[0] - a[0]) * dx + (t[1] - a[1]) * dy) / len2));
    const foot: [number, number] = [a[0] + u * dx, a[1] + u * dy];
    const planar = Math.hypot(t[0] - foot[0], t[1] - foot[1]);
    if (planar < bestPlanar) {
      bestPlanar = planar;
      const position = proj.toPosition(foot);
      best = {
        position,
        distance: distance(target, position),
        segmentIndex: i,
        distanceAlongLine: along + distance(line[i]!, position),
      };
    }
    along += distance(line[i]!, line[i + 1]!);
  }
  return best!;
}
