import * as z from 'zod/v4';
import { normaliseArea, toPosition, validateLine } from '../../geo/convert.js';
import { areaAndPerimeter, cardinal, inverse, lineLength } from '../../geo/measure.js';
import { textResult, type NbTool, type ToolResult } from '../types.js';
import {
  AreaGeometrySchema,
  AreaUnitSchema,
  DistanceUnitSchema,
  GEOMETRY_TOOL_ANNOTATIONS,
  LineSchema,
  PointSchema,
  STRAIGHT_LINE_NOTE,
  formatArea,
  formatDistance,
  geometryInput,
  round,
} from './shared.js';

const Schema = z.strictObject({
  mode: z
    .enum(['distance', 'length', 'area', 'bearing'])
    .describe(
      'distance: between two points; length: of a line; area: of a polygon; bearing: from one point to another',
    ),
  from: PointSchema.optional().describe('Start point (distance, bearing)'),
  to: PointSchema.optional().describe('End point (distance, bearing)'),
  line: LineSchema.optional().describe('The line (length)'),
  polygon: AreaGeometrySchema.optional().describe('The polygon (area)'),
  units: DistanceUnitSchema.optional(),
  area_units: AreaUnitSchema.optional(),
});

export const measure: NbTool<typeof Schema> = {
  name: 'measure',
  title: 'Measure Straight-Line Distance, Length, Area or Bearing',
  description:
    'Measure straight-line (geodesic, WGS84) distance between two points, the length of a line, ' +
    'the area and perimeter of a polygon, or the bearing from one point to another. ' +
    STRAIGHT_LINE_NOTE +
    ' Parameters: mode (distance | length | area | bearing); from and to ({latitude, longitude}) ' +
    'for distance and bearing; line (array of points) for length; polygon (GeoJSON Polygon or ' +
    'MultiPolygon, e.g. an isochrone contour) for area; units (meters, kilometers, miles, feet, ' +
    'nautical_miles; default meters); area_units (square_meters, square_kilometers, hectares, ' +
    'acres, square_miles, square_feet; default square_meters). ' +
    'Example: {"mode": "distance", "from": {"latitude": 12.9716, "longitude": 77.5946}, ' +
    '"to": {"latitude": 13.0827, "longitude": 80.2707}, "units": "kilometers"}',
  inputSchema: Schema,
  annotations: GEOMETRY_TOOL_ANNOTATIONS,
  async run(args): Promise<ToolResult> {
    const units = args.units ?? 'meters';
    const areaUnits = args.area_units ?? 'square_meters';
    return geometryInput(() => {
      switch (args.mode) {
        case 'distance':
        case 'bearing': {
          if (!args.from || !args.to) throw new Error(`${args.mode} needs both from and to`);
          const r = inverse(toPosition(args.from), toPosition(args.to));
          if (args.mode === 'distance') {
            const d = formatDistance(r.distance, units);
            return textResult(`Straight-line distance: ${d} ${units}.`, {
              mode: 'distance',
              distance: d,
              units,
              initial_bearing: round(r.initialBearing, 2),
            });
          }
          const initial = round(r.initialBearing, 2);
          return textResult(
            `Initial bearing ${initial}° (${cardinal(r.initialBearing)}), final bearing ${round(r.finalBearing, 2)}°.`,
            {
              mode: 'bearing',
              initial_bearing: initial,
              final_bearing: round(r.finalBearing, 2),
              cardinal: cardinal(r.initialBearing),
              distance: formatDistance(r.distance, units),
              units,
            },
          );
        }
        case 'length': {
          if (!args.line) throw new Error('length needs a line');
          const line = validateLine(args.line);
          const len = formatDistance(lineLength(line), units);
          return textResult(
            `Straight-line length: ${len} ${units} over ${line.length - 1} segment(s).`,
            {
              mode: 'length',
              length: len,
              units,
              segment_count: line.length - 1,
            },
          );
        }
        case 'area': {
          if (!args.polygon) throw new Error('area needs a polygon');
          const polygons = normaliseArea(args.polygon);
          const m = areaAndPerimeter(polygons);
          const area = formatArea(m.area, areaUnits);
          return textResult(
            `Area: ${area} ${areaUnits}; perimeter: ${formatDistance(m.perimeter, units)} ${units}.`,
            {
              mode: 'area',
              area,
              area_units: areaUnits,
              perimeter: formatDistance(m.perimeter, units),
              perimeter_units: units,
              polygon_count: polygons.length,
            },
          );
        }
      }
    });
  },
};
