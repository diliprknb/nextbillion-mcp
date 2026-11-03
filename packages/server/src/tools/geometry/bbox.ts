import * as z from 'zod/v4';
import { boundingBox } from '../../geo/bbox.js';
import { normaliseArea, validateLine, validatePoints } from '../../geo/convert.js';
import { ToolInputError, textResult, type NbTool, type ToolResult } from '../types.js';
import {
  AreaGeometrySchema,
  GEOMETRY_TOOL_ANNOTATIONS,
  LabelledPointSchema,
  LineSchema,
  MAX_POINTS,
  geometryInput,
  round,
} from './shared.js';

const Schema = z.strictObject({
  points: z.array(LabelledPointSchema).min(1).max(MAX_POINTS).optional(),
  line: LineSchema.optional(),
  polygon: AreaGeometrySchema.optional(),
  padding_meters: z
    .number()
    .min(0)
    .max(1_000_000)
    .optional()
    .describe('Grow the box by this many metres on every side'),
});

export const bbox: NbTool<typeof Schema> = {
  name: 'bbox',
  title: 'Bounding Box',
  description:
    'The smallest latitude/longitude box around a set of points, a line or a polygon, optionally ' +
    'padded in metres — for example a viewport for static_map_image or a spatial filter. Handles ' +
    'shapes that straddle the antimeridian (reports crosses_antimeridian and the narrower box). ' +
    'Computed locally, no sign-in needed. Parameters: exactly one of points (array of {latitude, ' +
    'longitude}), line (array of points) or polygon (GeoJSON Polygon/MultiPolygon, isochrone Feature ' +
    'accepted); padding_meters (default 0). Returns min_latitude, min_longitude, max_latitude, ' +
    'max_longitude, crosses_antimeridian. Example: {"points": [{"latitude": 12.9716, "longitude": ' +
    '77.5946}, {"latitude": 13.0827, "longitude": 80.2707}], "padding_meters": 500}',
  inputSchema: Schema,
  annotations: GEOMETRY_TOOL_ANNOTATIONS,
  async run(args): Promise<ToolResult> {
    const given = [args.points, args.line, args.polygon].filter((v) => v !== undefined).length;
    if (given !== 1) throw new ToolInputError('give exactly one of points, line or polygon');
    return geometryInput(() => {
      const positions = args.points
        ? validatePoints(args.points)
        : args.line
          ? validateLine(args.line)
          : normaliseArea(args.polygon).flatMap((poly) => poly.flat());
      const b = boundingBox(positions, args.padding_meters ?? 0);
      const out = {
        min_latitude: round(b.min_latitude),
        min_longitude: round(b.min_longitude),
        max_latitude: round(b.max_latitude),
        max_longitude: round(b.max_longitude),
        crosses_antimeridian: b.crosses_antimeridian,
      };
      return textResult(
        `Bounding box: south ${out.min_latitude}, west ${out.min_longitude}, north ${out.max_latitude}, east ${out.max_longitude}${b.crosses_antimeridian ? ' (crosses the antimeridian)' : ''}.`,
        out,
      );
    });
  },
};
