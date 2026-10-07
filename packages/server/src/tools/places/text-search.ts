import * as z from 'zod/v4';
import {
  placesFilterQuery,
  PlacesFilterShape,
  PlaceTypesSchema,
  summarizePlaces,
} from '../shared/geo.js';
import { READ_ONLY, textResult, type NbTool } from '../types.js';

const TextSearchSchema = z.strictObject({
  query: z.string().min(1).describe('Free-text search query'),
  ...PlacesFilterShape,
});

/**
 * place_search, autosuggest and autocomplete share the exact same request surface
 * (`q` + geographic filters) against different endpoints; only the ranking/matching
 * behavior differs. geocode_forward is defined separately below because it
 * additionally supports the `types` filter (which these endpoints do not).
 */
function textSearchTool(options: {
  name: string;
  title: string;
  description: string;
  path: string;
  noun: string;
  docs: readonly string[];
}): NbTool<typeof TextSearchSchema> {
  return {
    name: options.name,
    title: options.title,
    description: options.description,
    inputSchema: TextSearchSchema,
    annotations: READ_ONLY,
    docs: options.docs,
    async run(args, nb) {
      const response = await nb.getJson<Record<string, unknown>>(options.path, {
        q: args.query,
        ...placesFilterQuery(args),
      });
      return textResult(summarizePlaces(response, options.noun), response);
    },
  };
}

const ForwardGeocodeSchema = z.strictObject({
  query: z.string().min(1).describe('Free-text search query'),
  ...PlacesFilterShape,
  types: PlaceTypesSchema.optional(),
});

export const geocodeForward: NbTool<typeof ForwardGeocodeSchema> = {
  name: 'geocode_forward',
  title: 'Forward Geocode',
  description:
    'Convert a free-text address, place name, locality or administrative area into ' +
    'coordinates and a full postal address; tolerates incomplete or partly wrong input. Use ' +
    'geocode_batch for many addresses, place_search for POIs/businesses, geocode_structured ' +
    'when the address components are already separated. Parameters: query (required); ' +
    'optional near {latitude, longitude} or country_codes (strongly recommended - landmark ' +
    'names rank poorly without a location bias), radius_m (with near), bounding_box {west, ' +
    'south, east, north}, limit, language, view, types (houseNumber | addressBlock | street | ' +
    'intersection | place | area). Example: {"query": "1600 Pennsylvania Avenue NW, ' +
    'Washington DC", "country_codes": ["USA"], "limit": 1}',
  inputSchema: ForwardGeocodeSchema,
  annotations: READ_ONLY,
  docs: ['places/geocoding/forward-geocode/forward-geocode'],
  async run(args, nb) {
    const response = await nb.getJson<Record<string, unknown>>('/geocode', {
      q: args.query,
      ...placesFilterQuery(args),
      types: args.types?.join(','),
    });
    return textResult(summarizePlaces(response, 'match'), response);
  },
};

export const placeSearch = textSearchTool({
  name: 'place_search',
  docs: [
    'places/search/search-places-api/discover-api',
    'places/search/search-places-api/search-places-apis',
  ],
  title: 'Search Places',
  description:
    'Search for places, points of interest and businesses with a free-text query (e.g. "gas ' +
    'station", "coffee"), ranked by relevance around a location. Use geocode_forward for ' +
    'plain address-to-coordinates conversion. For how-to questions about this API, use search_documentation. Parameters: query (required); optional near ' +
    '{latitude, longitude} (recommended), radius_m (with near), country_codes, bounding_box ' +
    '{west, south, east, north}, limit, language, view. Example: {"query": "coffee", "near": ' +
    '{"latitude": 37.7749, "longitude": -122.4194}, "radius_m": 1000, "limit": 5}',
  path: '/discover',
  noun: 'place',
});

export const autosuggest = textSearchTool({
  name: 'autosuggest',
  docs: ['places/autosuggestions/autosuggest-api'],
  title: 'Autosuggest',
  description:
    'Suggest address and place candidates from an incomplete or misspelled query ' +
    '(typo-tolerant, e.g. "aqaurium" still matches aquariums). Use for search-as-you-type; ' +
    'use autocomplete for strict prefix completion of valid addresses. Parameters: query ' +
    '(required); optional near {latitude, longitude}, radius_m (with near), country_codes, ' +
    'bounding_box {west, south, east, north}, limit, language, view. Example: {"query": ' +
    '"aqauriums", "near": {"latitude": 42.3501, "longitude": -71.0689}, "limit": 5}',
  path: '/autosuggest',
  noun: 'suggestion',
});

export const autocomplete = textSearchTool({
  name: 'autocomplete',
  docs: ['places/autosuggestions/autocomplete-api'],
  title: 'Autocomplete',
  description:
    'Complete a partial address or administrative-area prefix into full valid addresses (e.g. ' +
    '"stat" -> "State Capitol, ..."). Use for prefix completion as the user types; use ' +
    'autosuggest for typo-tolerant fuzzy suggestions and geocode_forward for a full address. ' +
    'Parameters: query (required); optional near {latitude, longitude}, radius_m (with near), ' +
    'country_codes, bounding_box {west, south, east, north}, limit, language, view. Example: ' +
    '{"query": "stat", "near": {"latitude": 35.4769, "longitude": -97.4872}, "limit": 5}',
  path: '/autocomplete',
  noun: 'completion',
});
