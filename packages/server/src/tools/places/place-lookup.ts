import * as z from 'zod/v4';
import { summarizePlaces, ViewSchema } from '../shared/geo.js';
import { READ_ONLY, textResult, type NbTool } from '../types.js';

const Schema = z.strictObject({
  id: z.string().min(1).describe('Unique place id, as returned by the other place/geocoding tools'),
  view: ViewSchema.optional(),
});

export const placeLookup: NbTool<typeof Schema> = {
  name: 'place_lookup',
  title: 'Place Lookup',
  description:
    'Fetch the full details of a place (address, position, access points, categories, ' +
    'contacts) by its unique id, as returned by place_search, geocode_forward, autosuggest, ' +
    'autocomplete or search_along_route. Parameters: id (required); optional view. Example: ' +
    '{"id": "2EmBgAmFpR9dg0D89EBzNA"}',
  inputSchema: Schema,
  annotations: READ_ONLY,
  docs: ['places/place-lookup/place-lookup'],
  async run(args, nb) {
    const response = await nb.getJson<Record<string, unknown>>('/lookup', {
      id: args.id,
      view: args.view,
    });
    return textResult(summarizePlaces(response, 'place'), response);
  },
};
