import * as z from 'zod/v4';
import { normaliseArea } from '../../geo/convert.js';
import { polygonOp } from '../../geo/polygon-ops.js';
import { ToolInputError, textResult, type NbTool, type ToolResult } from '../types.js';
import {
  AreaGeometrySchema,
  AreaUnitSchema,
  GEOMETRY_TOOL_ANNOTATIONS,
  MAX_TOTAL_VERTICES,
  MaxVerticesSchema,
  geometryInput,
  shapeOutput,
  vertexCount,
} from './shared.js';

const Schema = z.strictObject({
  operation: z
    .enum(['union', 'intersect', 'difference'])
    .describe('difference = first polygon minus all others'),
  polygons: z
    .array(AreaGeometrySchema)
    .min(2)
    .max(20)
    .describe('Two or more polygons (GeoJSON Polygon/MultiPolygon or isochrone Features)'),
  area_units: AreaUnitSchema.optional(),
  max_vertices: MaxVerticesSchema,
});

export const polygonOps: NbTool<typeof Schema> = {
  name: 'polygon_ops',
  title: 'Polygon Union, Intersection or Difference',
  description:
    'Combine polygons: union (merge), intersect (overlap) or difference (first minus the others), ' +
    'for example the overlap of two isochrones or the part of a zone not covered by a depot area. ' +
    'Returns the resulting GeoJSON geometry (Polygon or MultiPolygon, or null when empty) with its ' +
    'geodesic area. Computed locally, no sign-in needed. Parameters: operation (union | intersect | ' +
    'difference); polygons (array of 2–20 GeoJSON Polygon/MultiPolygon geometries, isochrone Features accepted); ' +
    'area_units (default square_meters); max_vertices (default 500, result simplified to fit). ' +
    'Example: {"operation": "intersect", "polygons": [{"type": "Polygon", "coordinates": [[[77.59, 12.97], ' +
    '[77.61, 12.97], [77.61, 12.99], [77.59, 12.99], [77.59, 12.97]]]}, {"type": "Polygon", "coordinates": ' +
    '[[[77.6, 12.98], [77.62, 12.98], [77.62, 13.0], [77.6, 13.0], [77.6, 12.98]]]}], "area_units": "hectares"}',
  inputSchema: Schema,
  annotations: GEOMETRY_TOOL_ANNOTATIONS,
  async run(args): Promise<ToolResult> {
    return geometryInput(() => {
      const inputs = args.polygons.map((p, i) => normaliseArea(p, `polygons[${i}]`));
      const total = inputs.reduce((n, p) => n + vertexCount(p), 0);
      if (total > MAX_TOTAL_VERTICES) {
        throw new ToolInputError(
          `the polygons have ${total} vertices in total; at most ${MAX_TOTAL_VERTICES} per call (simplify them first)`,
        );
      }
      const out = shapeOutput(
        polygonOp(args.operation, inputs),
        args.area_units ?? 'square_meters',
        args.max_vertices,
      );
      const summary =
        out.result === null
          ? `The ${args.operation} is empty.`
          : `${args.operation}: ${out.result.type} with area ${out.area} ${out.area_units}${out.simplified ? ' (simplified)' : ''}.`;
      return textResult(summary, { operation: args.operation, ...out });
    });
  },
};
