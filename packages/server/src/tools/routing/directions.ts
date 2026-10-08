import * as z from 'zod/v4';
import {
  CoordinateSchema,
  EmissionClassSchema,
  ExcludeSchema,
  HazmatSchema,
  toLatLng,
  toLatLngList,
} from '../shared/geo.js';
import { READ_ONLY, textResult, ToolInputError, type NbTool } from '../types.js';

const AVOID_VALUES = [
  'toll',
  'highway',
  'ferry',
  'sharp_turn',
  'uturn',
  'service_road',
  'left_turn',
  'right_turn',
  'tunnel',
  'none',
] as const;

const Schema = z.strictObject({
  origin: CoordinateSchema.describe('Route start (must be a routable land location)'),
  destination: CoordinateSchema.describe('Route end (must be a routable land location)'),
  waypoints: z
    .array(CoordinateSchema)
    .max(200)
    .optional()
    .describe('Intermediate stops visited in order (max 200)'),
  mode: z
    .enum(['car', 'truck', 'motorcycle', 'bike', 'walk'])
    .optional()
    .describe('Travel mode (default car). Modes other than car/truck require service=flexible'),
  service: z
    .enum(['flexible', 'fast'])
    .optional()
    .describe(
      'API variant: "flexible" (default) supports all modes, departure_time, route_type, full ' +
        'avoid list and truck options; "fast" is lower latency but limited to car/truck and ' +
        'avoid toll/ferry/highway only',
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
      'Departure as a UNIX timestamp in seconds, for typical-traffic routing (flexible only)',
    ),
  avoid: z
    .array(z.enum(AVOID_VALUES))
    .optional()
    .describe(
      'Road features to avoid when alternatives exist. Fast service supports only toll/ferry/highway',
    ),
  exclude: ExcludeSchema.optional(),
  road_info: z
    .array(
      z.enum([
        'max_speed',
        'toll_distance',
        'toll_cost',
        'toll_info',
        'truck_route',
        'stop_sign',
        'traffic_light',
      ]),
    )
    .min(1)
    .optional()
    .describe(
      'Extra per-segment information to return: max_speed, toll_distance, toll_cost, toll_info, ' +
        'truck_route, stop_sign, traffic_light (flexible service only)',
    ),
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
      'Allow the route to cross international borders (region-dependent, flexible service only)',
    ),
  honor_restrictions: z
    .boolean()
    .optional()
    .describe(
      'When true, enforce restricted-area rules: no route is generated if origin, destination, ' +
        'or a waypoint is inside a restricted area. Default false: route anyway with a warning ' +
        '(flexible service only)',
    ),
  alternatives: z
    .boolean()
    .optional()
    .describe('Return up to 3 alternative routes (only without waypoints)'),
  steps: z.boolean().optional().describe('Include turn-by-turn steps (fast service only)'),
  geometry: z
    .enum(['polyline', 'polyline6'])
    .optional()
    .describe(
      'Route geometry encoding (default polyline, precision 5 — directly usable with static_route_map)',
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

export const directions: NbTool<typeof Schema> = {
  name: 'directions',
  title: 'Directions',
  description:
    'Calculate a route between an origin and a destination with optional waypoints; returns ' +
    'distance (meters), duration (seconds) and an encoded polyline per route - pass the ' +
    'polyline to static_route_map to draw it. Use distance_matrix for many pairs. ' +
    'pairs. For how-to questions about this API, use search_documentation. Parameters: origin, destination {latitude, longitude} (required); optional ' +
    'waypoints (array, max 200), mode (car | truck | motorcycle | bike | walk), service ' +
    '("flexible" default: all modes and options; "fast": car/truck only, lower latency), ' +
    'route_type, departure_time (UNIX seconds), avoid (soft filter), exclude (strict filter), ' +
    'road_info (max_speed, toll_*, truck_route, stop_sign, traffic_light), honor_restrictions, alternatives, steps (fast only), geometry (polyline ' +
    '| polyline6), truck options: truck_size_cm {height, width, length}, truck_weight_kg, ' +
    'truck_axle_load (tonnes), hazmat_type, emission_class (euro0-euro9), cross_border. ' +
    'Example: {"origin": {"latitude": 37.7749, "longitude": -122.4194}, "destination": ' +
    '{"latitude": 34.0522, "longitude": -118.2437}, "mode": "truck", "truck_weight_kg": ' +
    '18000, "hazmat_type": ["flammable_liquid"]}',
  inputSchema: Schema,
  annotations: READ_ONLY,
  docs: ['routing/directions-api/directions-api'],
  async run(args, nb) {
    const service = args.service ?? 'flexible';
    if (service === 'fast' && args.mode && args.mode !== 'car' && args.mode !== 'truck') {
      throw new ToolInputError(`mode=${args.mode} requires service=flexible.`);
    }
    // POST accepts up to 200 waypoints and avoids URL-length limits; params match GET.
    const response = await nb.postJson<Record<string, unknown>>(
      '/directions/json',
      service === 'flexible' ? { option: 'flexible' } : {},
      {
        origin: toLatLng(args.origin),
        destination: toLatLng(args.destination),
        waypoints: args.waypoints?.length ? toLatLngList(args.waypoints) : undefined,
        mode: args.mode,
        route_type: args.route_type,
        departure_time: args.departure_time,
        avoid: args.avoid?.length ? args.avoid.join('|') : undefined,
        exclude: args.exclude?.length ? args.exclude.join('|') : undefined,
        road_info: args.road_info?.length ? args.road_info.join('|') : undefined,
        hazmat_type: args.hazmat_type?.length ? args.hazmat_type.join('|') : undefined,
        truck_axle_load: args.truck_axle_load,
        emission_class: args.emission_class,
        cross_border: args.cross_border,
        honor_restrictions: args.honor_restrictions,
        alternatives: args.alternatives,
        altcount: args.alternatives ? 3 : undefined,
        steps: service === 'fast' ? args.steps : undefined,
        geometry: args.geometry ?? 'polyline',
        truck_size: args.truck_size_cm
          ? `${args.truck_size_cm.height},${args.truck_size_cm.width},${args.truck_size_cm.length}`
          : undefined,
        truck_weight: args.truck_weight_kg,
      },
    );
    const routes = (response as { routes?: Array<Record<string, unknown>> }).routes ?? [];
    const lines = routes.map((route, index) => {
      const km = typeof route.distance === 'number' ? (route.distance / 1000).toFixed(1) : '?';
      const minutes = typeof route.duration === 'number' ? Math.round(route.duration / 60) : '?';
      return `Route ${index + 1}: ${km} km, ~${minutes} min`;
    });
    return textResult(
      lines.length > 0
        ? `${lines.join('\n')}\nGeometry (encoded polyline) is in structured content.`
        : 'No route found.',
      response,
    );
  },
};
