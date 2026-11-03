import * as z from 'zod/v4';
import { contains } from '../../geo/containment.js';
import { normaliseArea, validatePoints } from '../../geo/convert.js';
import { textResult, type NbTool, type ToolResult } from '../types.js';
import {
  AreaGeometrySchema,
  GEOMETRY_TOOL_ANNOTATIONS,
  LabelledPointSchema,
  MAX_POINTS,
  geometryInput,
} from './shared.js';

const Schema = z.strictObject({
  polygon: AreaGeometrySchema,
  points: z
    .array(LabelledPointSchema)
    .min(1)
    .max(MAX_POINTS)
    .describe('Points to test, each optionally with an id'),
  include_boundary: z
    .boolean()
    .optional()
    .describe('Count points exactly on the edge as inside (default true)'),
});

export const pointsInPolygon: NbTool<typeof Schema> = {
  name: 'points_in_polygon',
  title: 'Points in Polygon',
  description:
    'Geofencing: tell which of up to 1,000 points lie inside a polygon, for example which ' +
    'delivery addresses fall within an isochrone contour or a service area. Holes are respected; ' +
    'the test is done in map (flat degree) space, matching how polygons are drawn. Computed ' +
    'locally, no sign-in needed. Parameters: polygon (GeoJSON Polygon or MultiPolygon, or an ' +
    'isochrone Feature); points (array of {latitude, longitude, id?}); include_boundary (default true). ' +
    'Returns inside and outside lists (ids, or indexes when no id is given) with counts. ' +
    'Example: {"polygon": {"type": "Polygon", "coordinates": [[[77.59, 12.97], [77.61, 12.97], ' +
    '[77.61, 12.99], [77.59, 12.99], [77.59, 12.97]]]}, "points": [{"latitude": 12.98, "longitude": 77.6, "id": "A"}]}',
  inputSchema: Schema,
  annotations: GEOMETRY_TOOL_ANNOTATIONS,
  async run(args): Promise<ToolResult> {
    return geometryInput(() => {
      const polygons = normaliseArea(args.polygon);
      const positions = validatePoints(args.points);
      const includeBoundary = args.include_boundary ?? true;
      const inside: Array<string | number> = [];
      const outside: Array<string | number> = [];
      const boundary: Array<string | number> = [];
      positions.forEach((pos, i) => {
        const label = args.points[i]!.id ?? i;
        const c = contains(polygons, pos);
        if (c === 'inside' || (c === 'boundary' && includeBoundary)) inside.push(label);
        else outside.push(label);
        if (c === 'boundary') boundary.push(label);
      });
      return textResult(
        `${inside.length} of ${positions.length} point(s) inside, ${outside.length} outside.`,
        {
          inside,
          outside,
          inside_count: inside.length,
          outside_count: outside.length,
          ...(boundary.length ? { on_boundary: boundary } : {}),
        },
      );
    });
  },
};
