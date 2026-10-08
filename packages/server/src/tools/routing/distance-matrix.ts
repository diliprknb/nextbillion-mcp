import * as z from 'zod/v4';
import {
  CoordinateSchema,
  EmissionClassSchema,
  ExcludeSchema,
  HazmatSchema,
  toLatLngList,
} from '../shared/geo.js';
import { READ_ONLY, textResult, ToolInputError, type NbTool } from '../types.js';

const Schema = z.strictObject({
  origins: z.array(CoordinateSchema).min(1).max(1000).describe('Start points (matrix rows)'),
  destinations: z.array(CoordinateSchema).min(1).max(1000).describe('End points (matrix columns)'),
  mode: z
    .enum(['car', 'truck', 'motorcycle', 'bike', 'walk'])
    .optional()
    .describe('Travel mode (default car). Modes other than car/truck require service=flexible'),
  service: z
    .enum(['fast', 'flexible'])
    .optional()
    .describe(
      'API variant: "fast" (default) supports up to 1000x1000 points; "flexible" adds ' +
        'departure_time, route_type, truck options and more modes but is limited to 50x50 points ' +
        'within a ~8000 km area',
    ),
  route_type: z
    .enum(['fastest', 'shortest'])
    .optional()
    .describe('Optimization objective (flexible only, default fastest)'),
  departure_time: z
    .number()
    .int()
    .optional()
    .describe(
      'Departure as a UNIX timestamp in seconds, for typical-traffic results (flexible only)',
    ),
  avoid: z
    .array(z.enum(['toll', 'highway', 'ferry', 'none']))
    .optional()
    .describe('Road features to avoid'),
  exclude: ExcludeSchema.optional(),
  hazmat_type: HazmatSchema.optional(),
  truck_axle_load: z
    .number()
    .positive()
    .optional()
    .describe('Load per axle in tonnes (truck mode, flexible service only)'),
  emission_class: EmissionClassSchema.optional(),
  cross_border: z
    .boolean()
    .optional()
    .describe(
      'Allow routes to cross international borders (region-dependent, flexible service only)',
    ),
  route_failed_prompt: z
    .boolean()
    .optional()
    .describe(
      'When true, unroutable origin/destination pairs return -1 instead of 0 so they can be ' +
        'told apart from zero-distance pairs',
    ),
  honor_restrictions: z
    .boolean()
    .optional()
    .describe(
      'When true, enforce restricted-area rules for origin/destination points instead of ' +
        'routing through with a warning (flexible service only)',
    ),
  truck_size_cm: z
    .strictObject({ height: z.number(), width: z.number(), length: z.number() })
    .optional()
    .describe('Truck dimensions in cm (flexible + mode=truck only)'),
  truck_weight_kg: z
    .number()
    .int()
    .max(100_000)
    .optional()
    .describe('Truck gross weight in kg (flexible + mode=truck only)'),
});

export const distanceMatrix: NbTool<typeof Schema> = {
  name: 'distance_matrix',
  title: 'Distance Matrix',
  description:
    'Compute travel distance (meters) and duration (seconds) for every origin-to-destination ' +
    'pair in one call; one row per origin with one element per destination, in input order. ' +
    'Use it instead of repeated directions calls when several pairs are needed. For how-to questions about this API, use search_documentation. Parameters: ' +
    'origins, destinations (arrays of {latitude, longitude}, required); optional mode, ' +
    'service ("fast" default: up to 1000x1000 points; "flexible": the options below, max ' +
    '50x50), route_type, departure_time, avoid (soft), exclude (strict), honor_restrictions, ' +
    'route_failed_prompt (unroutable pairs return -1 instead of 0), truck options: ' +
    'truck_size_cm {height, width, length}, truck_weight_kg, truck_axle_load, hazmat_type, ' +
    'emission_class, cross_border. Example: {"origins": [{"latitude": 1.29, "longitude": ' +
    '103.85}], "destinations": [{"latitude": 1.35, "longitude": 103.99}, {"latitude": 1.3, ' +
    '"longitude": 103.77}], "route_failed_prompt": true}',
  inputSchema: Schema,
  annotations: READ_ONLY,
  docs: ['routing/distance-matrix/synchronous', 'routing/distance-matrix/asynchronous'],
  async run(args, nb) {
    const service = args.service ?? 'fast';
    if (service === 'fast' && args.mode && args.mode !== 'car' && args.mode !== 'truck') {
      throw new ToolInputError(`mode=${args.mode} requires service=flexible.`);
    }
    if (service === 'flexible' && (args.origins.length > 50 || args.destinations.length > 50)) {
      throw new ToolInputError(
        'service=flexible is limited to 50 origins x 50 destinations; use service=fast for larger matrices.',
      );
    }
    const response = await nb.postJson<Record<string, unknown>>(
      '/distancematrix/json',
      service === 'flexible' ? { option: 'flexible' } : {},
      {
        origins: toLatLngList(args.origins),
        destinations: toLatLngList(args.destinations),
        mode: args.mode,
        route_type: args.route_type,
        departure_time: args.departure_time,
        avoid: args.avoid?.length ? args.avoid.join('|') : undefined,
        exclude: args.exclude?.length ? args.exclude.join('|') : undefined,
        hazmat_type: args.hazmat_type?.length ? args.hazmat_type.join('|') : undefined,
        truck_axle_load: args.truck_axle_load,
        emission_class: args.emission_class,
        cross_border: args.cross_border,
        route_failed_prompt: args.route_failed_prompt,
        honor_restrictions: args.honor_restrictions,
        truck_size: args.truck_size_cm
          ? `${args.truck_size_cm.height},${args.truck_size_cm.width},${args.truck_size_cm.length}`
          : undefined,
        truck_weight: args.truck_weight_kg,
      },
    );
    const rows = (response as { rows?: Array<{ elements?: unknown[] }> }).rows ?? [];
    return textResult(
      `Computed a ${args.origins.length}x${args.destinations.length} matrix ` +
        `(${rows.length} rows returned). Durations are seconds, distances are meters; ` +
        'full matrix is in structured content.',
      response,
    );
  },
};
