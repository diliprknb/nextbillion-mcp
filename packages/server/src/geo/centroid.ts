/** Area-weighted centroid and a guaranteed-inside label point (pole of inaccessibility). */
import polylabel from 'polylabel';
import { contains } from './containment.js';
import { localProjection, centreOf } from './projection.js';
import type { MultiPolygonCoords, Position } from './types.js';

export interface CentroidResult {
  centroid: Position;
  labelPoint: Position;
  centroidInside: boolean;
}

export function centroidAndLabel(polygons: MultiPolygonCoords): CentroidResult {
  const all = polygons.flatMap((poly) => poly.flat());
  const proj = localProjection(centreOf(all));
  // Planar centroid in the local metric projection, holes subtracted.
  let a = 0;
  let cx = 0;
  let cy = 0;
  let largest: { area: number; poly: MultiPolygonCoords[number] } | undefined;
  for (const poly of polygons) {
    let polyArea = 0;
    poly.forEach((ring, ri) => {
      const xy = ring.map((p) => proj.toXY(p));
      let ra = 0;
      let rx = 0;
      let ry = 0;
      for (let i = 0; i < xy.length - 1; i += 1) {
        const cross = xy[i]![0] * xy[i + 1]![1] - xy[i + 1]![0] * xy[i]![1];
        ra += cross;
        rx += (xy[i]![0] + xy[i + 1]![0]) * cross;
        ry += (xy[i]![1] + xy[i + 1]![1]) * cross;
      }
      const sign = ri === 0 ? 1 : -1;
      const absArea = Math.abs(ra) / 2;
      const ringCx = ra === 0 ? 0 : rx / (3 * ra);
      const ringCy = ra === 0 ? 0 : ry / (3 * ra);
      a += sign * absArea;
      cx += sign * absArea * ringCx;
      cy += sign * absArea * ringCy;
      if (ri === 0) polyArea = absArea;
    });
    if (!largest || polyArea > largest.area) largest = { area: polyArea, poly };
  }
  const centroid: Position = a === 0 ? all[0]! : proj.toPosition([cx / a, cy / a]);
  // Label point: polylabel on the largest polygon, in the metric projection (precision 1 m).
  const target = largest!.poly.map((ring) => ring.map((p) => proj.toXY(p)));
  const label = polylabel(target, 1);
  const labelPoint = proj.toPosition([label[0], label[1]]);
  return { centroid, labelPoint, centroidInside: contains(polygons, centroid) !== 'outside' };
}
