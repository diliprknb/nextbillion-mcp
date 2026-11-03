/** Union, intersection and difference of polygons (flat degrees) via polyclip-ts. */
import * as polyclip from 'polyclip-ts';
import type { MultiPolygonCoords } from './types.js';

export type PolygonOperation = 'union' | 'intersect' | 'difference';

export function polygonOp(
  operation: PolygonOperation,
  inputs: MultiPolygonCoords[],
): MultiPolygonCoords {
  const [first, ...rest] = inputs as [polyclip.Geom, ...polyclip.Geom[]];
  const out =
    operation === 'union'
      ? polyclip.union(first, ...rest)
      : operation === 'intersect'
        ? polyclip.intersection(first, ...rest)
        : polyclip.difference(first, ...rest);
  return out as unknown as MultiPolygonCoords;
}
