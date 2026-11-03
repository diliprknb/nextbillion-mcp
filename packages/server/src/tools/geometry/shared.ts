/**
 * Shared input schemas, annotations and result helpers for the local geometry tools.
 * These tools run entirely inside the server (no NextBillion API call, no sign-in) and
 * measure straight lines on the WGS84 ellipsoid, never roads.
 */
import * as z from 'zod/v4';
import {
  MAX_POINTS,
  MAX_TOTAL_VERTICES,
  MAX_VERTICES,
  round,
  toGeometry,
  toLatLng,
} from '../../geo/convert.js';
import {
  areaAndPerimeter,
  toAreaUnit,
  toUnit,
  type AreaUnit,
  type DistanceUnit,
} from '../../geo/measure.js';
import { simplifyArea } from '../../geo/simplify.js';
import { GeometryError, type AreaGeometry, type MultiPolygonCoords } from '../../geo/types.js';
import { CoordinateSchema } from '../shared/geo.js';
import { ToolInputError, type ToolAnnotations } from '../types.js';

export const GEOMETRY_TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const STRAIGHT_LINE_NOTE =
  'Straight-line (geodesic) geometry computed locally, not road distance or travel time: ' +
  'for those, directions or distance_matrix apply. No sign-in needed.';

export const PointSchema = CoordinateSchema.describe('A point as {latitude, longitude}');
export const LabelledPointSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  id: z.string().max(100).optional().describe('Optional label echoed back in the result'),
});
export const LineSchema = z
  .array(CoordinateSchema)
  .min(2)
  .max(MAX_VERTICES)
  .describe('A line as an array of {latitude, longitude} points (at least 2)');

/** GeoJSON Polygon/MultiPolygon (or a Feature wrapping one), validated by normaliseArea. */
export const AreaGeometrySchema = z
  .looseObject({ type: z.string() })
  .describe(
    'A GeoJSON Polygon or MultiPolygon geometry (coordinates in [longitude, latitude] order), ' +
      'or a Feature wrapping one — an isochrone contour can be passed as is',
  );

export const DistanceUnitSchema = z
  .enum(['meters', 'kilometers', 'miles', 'feet', 'nautical_miles'])
  .describe('Distance unit (default meters)');
export const AreaUnitSchema = z
  .enum(['square_meters', 'square_kilometers', 'hectares', 'acres', 'square_miles', 'square_feet'])
  .describe('Area unit (default square_meters)');

export const MaxVerticesSchema = z
  .number()
  .int()
  .min(16)
  .max(MAX_VERTICES)
  .optional()
  .describe(
    'Simplify the returned shape to at most this many vertices (default 500); the result says when it was simplified',
  );

export const DEFAULT_MAX_VERTICES = 500;
export { MAX_POINTS, MAX_TOTAL_VERTICES, MAX_VERTICES };

export function vertexCount(polygons: MultiPolygonCoords): number {
  return polygons.reduce((n, poly) => n + poly.reduce((m, r) => m + r.length, 0), 0);
}

/** Re-throws geometry validation problems as tool input errors (readable, isError results). */
export function geometryInput<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof GeometryError) throw new ToolInputError(error.message);
    throw error;
  }
}

export function formatDistance(meters: number, unit: DistanceUnit): number {
  return round(toUnit(meters, unit), unit === 'meters' || unit === 'feet' ? 2 : 4);
}
export function formatArea(squareMeters: number, unit: AreaUnit): number {
  return round(
    toAreaUnit(squareMeters, unit),
    unit === 'square_meters' || unit === 'square_feet' ? 1 : 4,
  );
}

export interface ShapeOutput {
  result: AreaGeometry | null;
  area: number;
  area_units: AreaUnit;
  perimeter: number;
  perimeter_units: 'meters';
  vertex_count: number;
  simplified: boolean;
  simplification_tolerance_meters?: number;
}

/** The common output of tools that return a shape: geometry, geodesic area, vertex budget. */
export function shapeOutput(
  polygons: MultiPolygonCoords,
  areaUnits: AreaUnit,
  maxVertices = DEFAULT_MAX_VERTICES,
): ShapeOutput {
  const { polygons: kept, simplified, tolerance_meters } = simplifyArea(polygons, maxVertices);
  const geometry = toGeometry(kept);
  const measured = areaAndPerimeter(kept);
  const vertexCount = kept.reduce((n, poly) => n + poly.reduce((m, r) => m + r.length, 0), 0);
  return {
    result: geometry,
    area: formatArea(measured.area, areaUnits),
    area_units: areaUnits,
    perimeter: round(measured.perimeter, 1),
    perimeter_units: 'meters',
    vertex_count: vertexCount,
    simplified,
    ...(simplified ? { simplification_tolerance_meters: tolerance_meters } : {}),
  };
}

export { round, toLatLng };
