/**
 * Query-side synonym expansion: everyday phrasing → the docs' own terms (spec §7).
 * Matched case-insensitively against the raw query; the expansion is appended, never
 * substituted, so the original words still score. Maintained by hand.
 */
export const SYNONYMS: ReadonlyArray<readonly [pattern: RegExp, expansion: string]> = [
  [
    /\breachable area\b|\breachability\b|\btravel time (?:area|polygon|map)\b/,
    'isochrone contours',
  ],
  [/\bheavy vehicle\b|\blorry\b|\bhgv\b|\bsemi[- ]trailer\b/, 'truck'],
  [/\bzip(?: code)?\b|\bpostal code\b|\bpin code\b/, 'postcode'],
  [/\bcoordinates? to (?:an )?address\b|\blat ?lng to address\b/, 'reverse geocode'],
  [/\baddress to coordinates?\b|\baddress lookup\b/, 'forward geocode'],
  [/\bmap[- ]matching\b/, 'snap to road route reconstruction'],
  [/\bturn[- ]by[- ]turn\b/, 'navigation directions'],
  [
    /\bvrp\b|\bvehicle routing problem\b|\bfleet (?:routing|optimi[sz]ation)\b/,
    'route optimization',
  ],
  [/\bpoi\b|\bpoints? of interest\b/, 'places search'],
  [/\beta\b/, 'duration'],
  [/\btype[- ]ahead\b|\bkeystroke\b|\bsearch bar\b/, 'autocomplete autosuggest'],
  [/\bdark mode\b|\blight mode\b/, 'theme'],
  [/\bbounding box\b|\bbbox\b/, 'bounds'],
  [/\bimage\b.*\bmap\b|\bmap image\b|\bmap picture\b/, 'static image'],
  [/\bwebhook\b|\balerts?\b|\bnotifications?\b/, 'monitor events'],
  [/\bgps (?:trace|points|noise|noisy)\b/, 'snap to road'],
  [/\bdepots?\b|\bwarehouses?\b/, 'depots'],
  [/\bdriver (?:breaks?|rest)\b|\bduty time\b/, 'hours of service'],
  [/\bprecipitation\b|\brain\b/, 'weather'],
  [/\btile(?:s)?\b/, 'tiles raster vector'],
  [/\bplace id\b|\bplace_id\b/, 'place lookup'],
  [/\bpins?\b|\bown images?\b|\bcustom icons?\b/, 'markers icon'],
  [/\bupgrad(?:e|ing)\b|\bsecond version\b|\bnew version\b/, 'migrate v2'],
  [
    /\b(?:start|begin|beginning|end|finish|completion) (?:of )?(?:a |the )?(?:delivery |tracking )?(?:run|journey|trip)\b/,
    'trip start end',
  ],
  [
    /\b(?:already )?dispatched\b|\bre-?optimi[sz](?:e|ing|ation)\b|\badditional jobs\b|\bnew orders\b/,
    're-optimizing route plan',
  ],
  [/\bmulti-?vehicle\b|\bmany vehicles\b|\bfleet\b/, 'route optimization'],
  [/\biphone\b|\bipad\b|\bswift\b/, 'iOS'],
  [/\bjavascript\b|\bbrowser\b|\bweb page\b/, 'web maps'],
];

export function expandQuery(query: string): string {
  const lower = query.toLowerCase();
  const extra: string[] = [];
  for (const [pattern, expansion] of SYNONYMS) {
    if (pattern.test(lower)) extra.push(expansion);
  }
  return extra.length === 0 ? query : `${query} ${extra.join(' ')}`;
}
