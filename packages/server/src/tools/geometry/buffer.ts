import * as z from 'zod/v4';
import { bufferArea, bufferLine, bufferPoint } from '../../geo/buffer.js';
import { normaliseArea, toPosition, validateLine } from '../../geo/convert.js';
import { fromUnit } from '../../geo/measure.js';
import { ToolInputError, textResult, type NbTool, type ToolResult } from '../types.js';
import {
  AreaGeometrySchema,
  AreaUnitSchema,
  DistanceUnitSchema,
  GEOMETRY_TOOL_ANNOTATIONS,
  LineSchema,
  MaxVerticesSchema,
  PointSchema,
  geometryInput,
  shapeOutput,
} from './shared.js';

const Schema = z.strictObject({
  point: PointSchema.optional().describe('Buffer around a point (a geodesic circle)'),
  line: LineSchema.optional().describe('Buffer around a line (a corridor)'),
  polygon: AreaGeometrySchema.optional().describe('Buffer around or inside a polygon'),
  distance: z.number().describe('Buffer distance; negative shrinks a polygon inward'),
  units: DistanceUnitSchema.optional(),
  steps: z
    .number()
    .int()
    .min(4)
    .max(64)
    .optional()
    .describe('Vertices per quarter... per full circle (default 16)'),
  area_units: AreaUnitSchema.optional(),
  max_vertices: MaxVerticesSchema,
});

export const buffer: NbTool<typeof Schema> = {
  name: 'buffer',
  title: 'Buffer Zone Around a Point, Line or Polygon',
  description:
    'Build the zone within a given straight-line distance of a point (a circle), a line (a corridor, ' +
    'e.g. 1 km along a route) or a polygon (grown outward, or shrunk inward with a negative distance). ' +
    'Geodesic on WGS84, computed locally, no sign-in needed. Returns a GeoJSON Polygon or ' +
    'MultiPolygon (a shrunk shape may split) with its area; an empty result is returned, not an error. ' +
    'Parameters: exactly one of point ({latitude, longitude}), line (array of points) or polygon ' +
    '(GeoJSON Polygon/MultiPolygon, isochrone Feature accepted); distance (number, negative only for ' +
    'polygon); units (default meters); steps (points per circle, default 16); area_units; max_vertices ' +
    '(default 500). Example: {"line": [{"latitude": 12.9716, "longitude": 77.5946}, {"latitude": 12.99, ' +
    '"longitude": 77.62}], "distance": 1, "units": "kilometers"}',
  inputSchema: Schema,
  annotations: GEOMETRY_TOOL_ANNOTATIONS,
  async run(args): Promise<ToolResult> {
    const given = [args.point, args.line, args.polygon].filter((v) => v !== undefined).length;
    if (given !== 1) throw new ToolInputError('give exactly one of point, line or polygon');
    const units = args.units ?? 'meters';
    const meters = fromUnit(args.distance, units);
    const steps = args.steps ?? 16;
    if (!Number.isFinite(meters)) throw new ToolInputError('distance must be a number');
    if (Math.abs(meters) > 5_000_000) throw new ToolInputError('distance must be at most 5,000 km');
    if (meters < 0 && !args.polygon)
      throw new ToolInputError('a negative distance only applies to a polygon');
    if (meters === 0 && !args.polygon)
      throw new ToolInputError('distance must be greater than zero');
    return geometryInput(() => {
      let polygons;
      let what: string;
      if (args.point) {
        polygons = bufferPoint(toPosition(args.point), meters, steps);
        what = 'point';
      } else if (args.line) {
        polygons = bufferLine(validateLine(args.line), meters, steps);
        what = 'line';
      } else {
        polygons = bufferArea(normaliseArea(args.polygon), meters, steps);
        what = 'polygon';
      }
      const out = shapeOutput(polygons, args.area_units ?? 'square_meters', args.max_vertices);
      const summary =
        out.result === null
          ? `Buffering the ${what} by ${args.distance} ${units} leaves nothing.`
          : `${args.distance} ${units} buffer of the ${what}: ${out.result.type}, area ${out.area} ${out.area_units}${out.simplified ? ' (simplified)' : ''}.`;
      return textResult(summary, { distance: args.distance, units, ...out });
    });
  },
};
