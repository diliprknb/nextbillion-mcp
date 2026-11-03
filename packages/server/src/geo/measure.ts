/**
 * Straight-line (geodesic) measurement on the WGS84 ellipsoid via geographiclib.
 * These are "as the crow flies" numbers, never road distances.
 */
import { Geodesic } from 'geographiclib-geodesic';
import type { MultiPolygonCoords, Position } from './types.js';

const geod = Geodesic.WGS84;

export type DistanceUnit = 'meters' | 'kilometers' | 'miles' | 'feet' | 'nautical_miles';
export type AreaUnit =
  'square_meters' | 'square_kilometers' | 'hectares' | 'acres' | 'square_miles' | 'square_feet';

const METERS_PER: Record<DistanceUnit, number> = {
  meters: 1,
  kilometers: 1000,
  miles: 1609.344,
  feet: 0.3048,
  nautical_miles: 1852,
};
const SQUARE_METERS_PER: Record<AreaUnit, number> = {
  square_meters: 1,
  square_kilometers: 1e6,
  hectares: 1e4,
  acres: 4046.8564224,
  square_miles: 2589988.110336,
  square_feet: 0.09290304,
};

export function toUnit(meters: number, unit: DistanceUnit): number {
  return meters / METERS_PER[unit];
}
export function fromUnit(value: number, unit: DistanceUnit): number {
  return value * METERS_PER[unit];
}
export function toAreaUnit(squareMeters: number, unit: AreaUnit): number {
  return squareMeters / SQUARE_METERS_PER[unit];
}

export interface Inverse {
  distance: number;
  initialBearing: number;
  finalBearing: number;
}

/** Geodesic distance (m) and azimuths (0–360°) from a to b. */
export function inverse(a: Position, b: Position): Inverse {
  const r = geod.Inverse(a[1], a[0], b[1], b[0]);
  return {
    distance: r.s12!,
    initialBearing: normaliseBearing(r.azi1!),
    finalBearing: normaliseBearing(r.azi2!),
  };
}

export function distance(a: Position, b: Position): number {
  return inverse(a, b).distance;
}

/** The point `meters` away from `from` along `bearing`. */
export function destination(from: Position, bearing: number, meters: number): Position {
  const r = geod.Direct(from[1], from[0], bearing, meters);
  return [r.lon2!, r.lat2!];
}

export function lineLength(line: Position[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) total += distance(line[i - 1]!, line[i]!);
  return total;
}

/** Geodesic area (m²) and perimeter (m) of a ring, regardless of winding. */
export function ringAreaAndPerimeter(ring: Position[]): { area: number; perimeter: number } {
  const poly = geod.Polygon(false);
  for (let i = 0; i < ring.length - 1; i += 1) poly.AddPoint(ring[i]![1], ring[i]![0]);
  const r = poly.Compute(false, true);
  return { area: Math.abs(r.area!), perimeter: r.perimeter! };
}

/** Area (m²) with holes subtracted, and the perimeter of all rings, of a MultiPolygon. */
export function areaAndPerimeter(polygons: MultiPolygonCoords): {
  area: number;
  perimeter: number;
} {
  let area = 0;
  let perimeter = 0;
  for (const poly of polygons) {
    poly.forEach((ring, i) => {
      const r = ringAreaAndPerimeter(ring);
      area += i === 0 ? r.area : -r.area;
      perimeter += r.perimeter;
    });
  }
  return { area: Math.max(0, area), perimeter };
}

export function normaliseBearing(deg: number): number {
  const b = deg % 360;
  return b < 0 ? b + 360 : b;
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export function cardinal(bearing: number): (typeof CARDINALS)[number] {
  return CARDINALS[Math.round(normaliseBearing(bearing) / 45) % 8]!;
}
