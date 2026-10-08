import * as z from 'zod/v4';
import { CoordinateSchema } from '../shared/geo.js';
import { READ_ONLY, textResult, ToolInputError, type NbTool } from '../types.js';

const Schema = z.strictObject({
  postal_code: z
    .string()
    .optional()
    .describe('Postal/ZIP code to look up (requires `country`; do not combine with `coordinate`)'),
  country: z
    .string()
    .optional()
    .describe(
      'Country of the postal code — name, alpha-2, or alpha-3 ISO code. Required with `postal_code`',
    ),
  coordinate: CoordinateSchema.optional().describe(
    'Find the postal code containing this location (alternative to `postal_code`)',
  ),
  geojson_boundary: z
    .boolean()
    .optional()
    .describe(
      'Return the boundary polygon in GeoJSON format instead of the default point-list format',
    ),
});

const SUPPORTED_COUNTRIES =
  'USA, India, UK, Netherlands, Austria, Germany, Indonesia, France, Singapore, Philippines, ' +
  'Canada, Australia, New Zealand, Italy, Brazil, Mexico, Spain';

export const postcodeLookup: NbTool<typeof Schema> = {
  name: 'postcode_lookup',
  title: 'Postcode Lookup',
  description:
    'Get the centroid and boundary polygon of a postal/ZIP code, or find the postal code that ' +
    'contains a coordinate; one lookup per call. Supported countries: USA, India, UK, ' +
    'Netherlands, Austria, Germany, Indonesia, France, Singapore, Philippines, Canada, ' +
    'Australia, New Zealand, Italy, Brazil, Mexico, Spain. Parameters: either postal_code ' +
    'plus country (name, alpha-2 or alpha-3 code), or coordinate {latitude, longitude}; ' +
    'optional geojson_boundary (true for a GeoJSON boundary). Example: {"postal_code": ' +
    '"90011", "country": "USA"}',
  inputSchema: Schema,
  annotations: READ_ONLY,
  docs: ['places/geocoding/geocode-postcode/geocode-postcode'],
  async run(args, nb) {
    if (args.postal_code && args.coordinate) {
      throw new ToolInputError('Provide either `postal_code` or `coordinate`, not both.');
    }
    if (!args.postal_code && !args.coordinate) {
      throw new ToolInputError('Provide `postal_code` (with `country`) or `coordinate`.');
    }
    if (args.postal_code && !args.country) {
      throw new ToolInputError('`country` is required when `postal_code` is provided.');
    }
    const response = await nb.postJson<Record<string, unknown>>(
      '/postalcode',
      {},
      {
        postalcode: args.postal_code,
        country: args.country,
        at: args.coordinate
          ? { lat: args.coordinate.latitude, lng: args.coordinate.longitude }
          : undefined,
        format: args.geojson_boundary ? 'geojson' : undefined,
      },
    );
    const places = (response as { places?: Array<Record<string, unknown>> }).places;
    const place = Array.isArray(places) ? places[0] : undefined;
    const geopoint = place?.geopoint as Record<string, unknown> | undefined;
    const summary = place
      ? `Postal code ${place.postalCode} (${place.address ?? place.country}), centroid ` +
        `(${geopoint?.lat}, ${geopoint?.lng}), boundary included in structured content.`
      : 'No postal code found.';
    return textResult(summary, response);
  },
};
