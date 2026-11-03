import * as z from 'zod/v4';
import { toPosition, validateLine, validatePoints } from '../../geo/convert.js';
import { nearestCandidates, nearestOnLine } from '../../geo/nearest.js';
import { ToolInputError, textResult, type NbTool, type ToolResult } from '../types.js';
import {
  DistanceUnitSchema,
  GEOMETRY_TOOL_ANNOTATIONS,
  LabelledPointSchema,
  LineSchema,
  MAX_POINTS,
  PointSchema,
  formatDistance,
  geometryInput,
  round,
  toLatLng,
} from './shared.js';

const Schema = z.strictObject({
  target: PointSchema.describe('The reference point'),
  candidates: z
    .array(LabelledPointSchema)
    .min(1)
    .max(MAX_POINTS)
    .optional()
    .describe('Points to rank by straight-line distance from target'),
  k: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('How many nearest candidates to return (default 1)'),
  line: LineSchema.optional().describe('A line to snap the target onto'),
  units: DistanceUnitSchema.optional(),
});

export const nearest: NbTool<typeof Schema> = {
  name: 'nearest',
  title: 'Nearest Point or Position on a Line',
  description:
    'Find the candidate points nearest to a target as the crow flies (e.g. the closest depots to a ' +
    'customer), or snap the target onto a line and report the closest position on it. Straight-line ' +
    '(geodesic) distances, computed locally, no sign-in needed; distance_matrix gives travel time and ' +
    'road distance instead. Parameters: target ({latitude, longitude}); either candidates (array of ' +
    '{latitude, longitude, id?}) with k (default 1), or line (array of points); units (default meters). ' +
    'Returns ranked {id, point, distance} for candidates, or snapped_point, distance, segment_index and ' +
    'distance_along_line for a line. Example: {"target": {"latitude": 12.9716, "longitude": 77.5946}, ' +
    '"candidates": [{"latitude": 13.0827, "longitude": 80.2707, "id": "Chennai"}, {"latitude": 19.076, ' +
    '"longitude": 72.8777, "id": "Mumbai"}], "k": 1, "units": "kilometers"}',
  inputSchema: Schema,
  annotations: GEOMETRY_TOOL_ANNOTATIONS,
  async run(args): Promise<ToolResult> {
    if ((args.candidates === undefined) === (args.line === undefined)) {
      throw new ToolInputError('give either candidates or line, not both');
    }
    const units = args.units ?? 'meters';
    return geometryInput(() => {
      const target = toPosition(args.target);
      if (args.candidates) {
        const ranked = nearestCandidates(
          target,
          validatePoints(args.candidates, 'candidates'),
          args.k ?? 1,
        );
        const results = ranked.map((r) => ({
          id: args.candidates![r.index]!.id ?? r.index,
          point: toLatLng(r.position),
          distance: formatDistance(r.distance, units),
          units,
        }));
        const first = results[0]!;
        return textResult(
          `Nearest: ${String(first.id)} at ${first.distance} ${units} (straight line).`,
          {
            results,
          },
        );
      }
      const s = nearestOnLine(target, validateLine(args.line!));
      return textResult(
        `Closest position on the line is ${formatDistance(s.distance, units)} ${units} away (segment ${s.segmentIndex}).`,
        {
          snapped_point: toLatLng(s.position),
          distance: formatDistance(s.distance, units),
          segment_index: s.segmentIndex,
          distance_along_line: formatDistance(s.distanceAlongLine, units),
          units,
          bearing_unused: undefined,
        },
      );
    });
  },
};
