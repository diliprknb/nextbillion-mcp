import * as z from 'zod/v4';
import { ToolInputError } from '../types.js';

/**
 * Tool inputs always take coordinates as explicit {latitude, longitude} objects.
 * The NextBillion APIs mix `lat,lng` strings, `lng,lat` markers and GeoJSON
 * `[lng,lat]`; keeping one input shape and serializing internally protects the
 * model from the ordering traps.
 */
export const CoordinateSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type Coordinate = z.output<typeof CoordinateSchema>;

/** Serialize to the `lat,lng` string used by all routing/places request parameters. */
export function toLatLng(coordinate: Coordinate): string {
  return `${coordinate.latitude},${coordinate.longitude}`;
}

export function toLatLngList(coordinates: Coordinate[]): string {
  return coordinates.map(toLatLng).join('|');
}

export const BoundingBoxSchema = z.strictObject({
  west: z.number().min(-180).max(180).describe('Western longitude'),
  south: z.number().min(-90).max(90).describe('Southern latitude'),
  east: z.number().min(-180).max(180).describe('Eastern longitude'),
  north: z.number().min(-90).max(90).describe('Northern latitude'),
});
export type BoundingBox = z.output<typeof BoundingBoxSchema>;

export const CountryCodesSchema = z
  .array(z.string().regex(/^[A-Za-z]{3}$/, 'ISO 3166-1 alpha-3 code, e.g. USA'))
  .min(1)
  .describe('Restrict results to these countries (ISO 3166-1 alpha-3 codes, e.g. ["USA","MEX"])');

export const PlaceTypesSchema = z
  .array(z.enum(['houseNumber', 'addressBlock', 'street', 'intersection', 'place', 'area']))
  .min(1)
  .describe(
    'Restrict results to these types: houseNumber (exact door point), addressBlock ' +
      '(address-range/segment match incl. interpolated numbers), street, intersection ' +
      '(only returned when requested), place (POI), area (city/district/postal/admin area)',
  );

export const ViewSchema = z
  .enum(['Unified', 'AR', 'IL', 'IN', 'MA', 'PK', 'RU', 'TR', 'CN', 'TW'])
  .describe(
    'Geopolitical view for disputed territories. Default: Unified (or the requester region)',
  );

/** Common optional geographic filters shared by the Places search tools. */
export const PlacesFilterShape = {
  near: CoordinateSchema.optional().describe(
    'Center of the search context; results are ranked around this point',
  ),
  radius_m: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('With `near`: hard-limit results to this radius in meters'),
  country_codes: CountryCodesSchema.optional(),
  bounding_box: BoundingBoxSchema.optional().describe('Hard-limit results to this bounding box'),
  limit: z.number().int().min(1).max(100).optional().describe('Maximum results (default 10)'),
  language: z.string().optional().describe('Result language as a BCP 47 tag, e.g. "en-US"'),
  view: ViewSchema.optional(),
};

export interface PlacesFilterArgs {
  near?: Coordinate;
  radius_m?: number;
  country_codes?: string[];
  bounding_box?: BoundingBox;
  limit?: number;
  language?: string;
  view?: string;
}

/**
 * Build the `at` / `in` / `limit` / `lang` / `view` query parameters from the shared
 * filter arguments. The API allows only one `in=` filter form, so the combinations
 * are validated here with actionable messages.
 */
export function placesFilterQuery(
  args: PlacesFilterArgs,
): Record<string, string | number | undefined> {
  const inFilters: string[] = [];
  if (args.country_codes) {
    inFilters.push(`countryCode:${args.country_codes.map((c) => c.toUpperCase()).join(',')}`);
  }
  if (args.bounding_box) {
    const b = args.bounding_box;
    inFilters.push(`bbox:${b.west},${b.south},${b.east},${b.north}`);
  }
  if (args.radius_m !== undefined) {
    if (!args.near) {
      throw new ToolInputError('`radius_m` requires `near` to define the circle center.');
    }
    inFilters.push(`circle:${toLatLng(args.near)};r=${args.radius_m}`);
  }
  if (inFilters.length > 1) {
    throw new ToolInputError(
      'Use only one geographic filter: `country_codes`, `bounding_box`, or `near`+`radius_m`.',
    );
  }
  return {
    at: args.near && args.radius_m === undefined ? toLatLng(args.near) : undefined,
    in: inFilters[0],
    limit: args.limit,
    lang: args.language,
    view: args.view,
  };
}

/** Compact text summary of a Places `{items: [...]}` response for the model. */
export function summarizePlaces(response: unknown, noun = 'result'): string {
  const items = (response as { items?: Array<Record<string, unknown>> })?.items;
  if (!Array.isArray(items) || items.length === 0) return `No ${noun}s found.`;
  const lines = items.slice(0, 5).map((item, index) => {
    const address = item.address as Record<string, unknown> | undefined;
    const position = item.position as Record<string, unknown> | undefined;
    const label = (address?.label as string) ?? (item.title as string) ?? 'unknown';
    const coords = position ? ` (${position.lat}, ${position.lng})` : '';
    return `${index + 1}. ${label}${coords}`;
  });
  const more = items.length > 5 ? `\n…and ${items.length - 5} more.` : '';
  return `${items.length} ${noun}${items.length === 1 ? '' : 's'} found:\n${lines.join('\n')}${more}`;
}

/** Hazardous-material classes accepted by the routing APIs (truck mode). */
export const HazmatSchema = z
  .array(
    z.enum([
      'explosives',
      'gas',
      'flammable_liquid',
      'flammable_gas',
      'organic',
      'toxic',
      'radioactive',
      'corrosive',
      'other',
    ]),
  )
  .min(1)
  .describe('Hazardous cargo classes carried (truck mode, flexible service only)');

export const EmissionClassSchema = z
  .enum(['euro0', 'euro1', 'euro2', 'euro3', 'euro4', 'euro5', 'euro6', 'euro7', 'euro8', 'euro9'])
  .describe('Engine emission class (EU regions, truck mode, flexible service only)');

/** Hard filter shared by directions and distance_matrix (flexible service). */
export const ExcludeSchema = z
  .array(
    z.enum([
      'toll',
      'ferry',
      'highway',
      'service_road',
      'uturn',
      'sharp_turn',
      'left_turn',
      'right_turn',
    ]),
  )
  .min(1)
  .describe(
    'Strict filter: only routes that completely avoid these features are returned (error if none exists). ' +
      'Use `avoid` for a soft preference instead. Flexible service only',
  );

/** Freight-network preference shared by directions and distance_matrix (flexible, truck). */
export const PreferSchema = z
  .enum(['truck_route'])
  .describe(
    'Prioritise designated freight network roads (flexible service, mode truck). ' +
      'truck_type takes effect only together with this',
  );

/** Truck classes used to pick roads on the designated freight network. */
export const TruckTypeSchema = z
  .array(z.enum(['rigid_truck', 'semi_trailer', 'b_double', 'road_train', 'generic_truck']))
  .min(1)
  .describe(
    'Truck class(es) the route must be legal for on the designated freight network ' +
      '(rigid_truck, semi_trailer, b_double, road_train, generic_truck). Effective together with ' +
      'prefer: "truck_route" (flexible service, mode truck)',
  );

/**
 * The API silently ignores `truck_type` and `require` unless `prefer=truck_route` is also set,
 * and ignores all three outside flexible truck routing. Reject those combinations so a request
 * for a B-double-legal route never degrades to a generic truck route without notice.
 */
export function checkTruckRouteOptions(
  args: {
    prefer?: 'truck_route';
    require?: 'truck_route';
    truck_type?: readonly string[];
    mode?: string;
  },
  service: 'flexible' | 'fast',
): void {
  if (args.truck_type?.length && !args.prefer) {
    throw new ToolInputError(
      'truck_type has no effect unless prefer is "truck_route"; add prefer: "truck_route".',
    );
  }
  if (args.require && !args.prefer) {
    throw new ToolInputError(
      'require: "truck_route" has no effect unless prefer is also "truck_route".',
    );
  }
  if (args.prefer && (args.mode !== 'truck' || service !== 'flexible')) {
    throw new ToolInputError(
      'prefer: "truck_route" applies to mode: "truck" with service: "flexible" only.',
    );
  }
}
