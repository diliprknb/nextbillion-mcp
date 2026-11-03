/**
 * Conversions and validation between the tools' `{latitude, longitude}` convention and
 * GeoJSON `[longitude, latitude]`, plus the polygon checks every tool shares.
 */
import {
  GeometryError,
  type AreaGeometry,
  type LatLng,
  type MultiPolygonCoords,
  type PolygonCoords,
  type Position,
  type Ring,
} from './types.js';

/**
 * Input budgets. They are safety caps, not targets: everything arrives through the
 * model's context, where 1,000 points is already ~40 KB of JSON and an isochrone contour
 * is a few hundred vertices. Worst cases at these caps stay well under 100 ms.
 */
export const MAX_VERTICES = 5_000;
export const MAX_POINTS = 1_000;
/** Combined vertex budget when several shapes enter one operation (polygon_ops). */
export const MAX_TOTAL_VERTICES = 20_000;

export function toPosition(p: LatLng): Position {
  return [p.longitude, p.latitude];
}

export function toLatLng(p: Position): LatLng {
  return { latitude: round(p[1]), longitude: round(p[0]) };
}

/** Six decimals ≈ 0.1 m: enough for any map use, and it keeps JSON small. */
export function round(value: number, decimals = 6): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function validatePosition(p: Position, where: string): void {
  const [lon, lat] = p;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new GeometryError(`${where}: coordinates must be finite numbers`);
  }
  if (lat < -90 || lat > 90)
    throw new GeometryError(`${where}: latitude ${lat} is outside -90..90`);
  if (lon < -180 || lon > 180) {
    throw new GeometryError(`${where}: longitude ${lon} is outside -180..180`);
  }
}

/** Closes the ring if needed and checks it has at least three distinct vertices. */
export function normaliseRing(ring: Ring, where: string): Ring {
  if (!Array.isArray(ring) || ring.length < 3) {
    throw new GeometryError(`${where}: a ring needs at least 3 vertices`);
  }
  for (const [i, p] of ring.entries()) {
    if (!Array.isArray(p) || p.length < 2) {
      throw new GeometryError(`${where}[${i}]: expected [longitude, latitude]`);
    }
    validatePosition([p[0]!, p[1]!], `${where}[${i}]`);
  }
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  const closed = first[0] === last[0] && first[1] === last[1];
  const out = closed
    ? ring.map((p) => [p[0]!, p[1]!] as Position)
    : [...ring.map((p) => [p[0]!, p[1]!] as Position), [first[0]!, first[1]!] as Position];
  if (out.length < 4)
    throw new GeometryError(`${where}: a ring needs at least 3 distinct vertices`);
  return out;
}

/**
 * Accepts a GeoJSON Polygon or MultiPolygon (or a Feature wrapping one, as `isochrone`
 * returns), validates it, closes rings and enforces the vertex budget. Always returns a
 * MultiPolygon coordinate array so callers handle one shape.
 */
export function normaliseArea(input: unknown, where = 'polygon'): MultiPolygonCoords {
  let geometry = input as { type?: string; geometry?: unknown; coordinates?: unknown };
  if (
    geometry &&
    typeof geometry === 'object' &&
    geometry.type === 'Feature' &&
    geometry.geometry
  ) {
    geometry = geometry.geometry as typeof geometry;
  }
  if (!geometry || typeof geometry !== 'object') {
    throw new GeometryError(`${where}: expected a GeoJSON Polygon or MultiPolygon`);
  }
  let polygons: unknown[];
  if (geometry.type === 'Polygon') polygons = [geometry.coordinates];
  else if (geometry.type === 'MultiPolygon') polygons = geometry.coordinates as unknown[];
  else {
    throw new GeometryError(
      `${where}: expected a GeoJSON Polygon or MultiPolygon, got ${String(geometry.type ?? typeof geometry)}`,
    );
  }
  if (!Array.isArray(polygons) || polygons.length === 0) {
    throw new GeometryError(`${where}: coordinates must contain at least one polygon`);
  }
  let vertices = 0;
  const out: MultiPolygonCoords = polygons.map((poly, pi) => {
    if (!Array.isArray(poly) || poly.length === 0) {
      throw new GeometryError(`${where}: polygon ${pi} has no rings`);
    }
    return (poly as Ring[]).map((ring, ri) => {
      const r = normaliseRing(ring, `${where} polygon ${pi} ring ${ri}`);
      vertices += r.length;
      if (vertices > MAX_VERTICES) {
        throw new GeometryError(
          `${where}: more than ${MAX_VERTICES} vertices; simplify the shape first`,
        );
      }
      return r;
    });
  });
  if (spansAntimeridian(out)) {
    throw new GeometryError(
      `${where}: the shape spans the antimeridian (longitude ±180), which this version does not support`,
    );
  }
  return out;
}

/** A ring that jumps more than 180° in longitude between two vertices crosses ±180. */
export function spansAntimeridian(polygons: MultiPolygonCoords): boolean {
  for (const poly of polygons) {
    for (const ring of poly) {
      for (let i = 1; i < ring.length; i += 1) {
        if (Math.abs(ring[i]![0] - ring[i - 1]![0]) > 180) return true;
      }
    }
  }
  return false;
}

/** The smallest GeoJSON geometry for a (possibly empty) MultiPolygon. */
export function toGeometry(polygons: MultiPolygonCoords): AreaGeometry | null {
  const kept = polygons.filter((poly) => poly.length > 0 && poly[0]!.length >= 4);
  if (kept.length === 0) return null;
  const rounded = kept.map((poly) =>
    poly.map((ring) => ring.map((p) => [round(p[0]), round(p[1])] as Position)),
  );
  if (rounded.length === 1) return { type: 'Polygon', coordinates: rounded[0] as PolygonCoords };
  return { type: 'MultiPolygon', coordinates: rounded };
}

export function validateLine(points: LatLng[], where = 'line'): Position[] {
  if (points.length < 2) throw new GeometryError(`${where}: a line needs at least 2 points`);
  if (points.length > MAX_VERTICES) {
    throw new GeometryError(`${where}: more than ${MAX_VERTICES} points; simplify the line first`);
  }
  return points.map((p, i) => {
    const pos = toPosition(p);
    validatePosition(pos, `${where}[${i}]`);
    return pos;
  });
}

export function validatePoints(points: LatLng[], where = 'points'): Position[] {
  if (points.length === 0) throw new GeometryError(`${where}: at least one point is required`);
  if (points.length > MAX_POINTS) {
    throw new GeometryError(`${where}: more than ${MAX_POINTS} points per call`);
  }
  return points.map((p, i) => {
    const pos = toPosition(p);
    validatePosition(pos, `${where}[${i}]`);
    return pos;
  });
}
