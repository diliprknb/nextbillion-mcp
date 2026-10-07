/**
 * Request-parameter extraction from reference pages (spec §6). Handles the table layouts
 * `| Name | Required | Format and Usage | Description |` (query parameters; the third
 * cell holds `<br>`-separated `Type:` / `Default:` / `Allowed values:` / `Example:`),
 * `| Field | Type | Description |` (request bodies) and `| Parameter | Type / Location |
 * Description |` (optimization guides). Response tables are skipped. Units come from the
 * docs' own wording ("in seconds", "in meters", "unix timestamp"); when the docs do not
 * state one the field stays null. Pure functions, build-time only.
 */
import { parseBlocks, splitSections, type Block } from '../../src/docs/markdown.js';
import { stem } from '../../src/docs/tokenizer.js';
import type { PageRecord, ParameterRecord } from '../../src/docs/types.js';
import { slugify } from './mapping.js';

/** Headings that organise a page rather than name an operation or API variant. */
const GENERIC_HEADING =
  /^(introduction|overview|api overview|(?:post |get )?(?:request|query|path) (?:parameters?|body|schema)|(?:post )?body schema|response schema|input parameters|configuring the feature.*|samples?.*|examples?.*|example-.*|api (?:query|rate) limits.*|api error (?:codes|handling)|(?:get|post|put|delete) (?:request|method)|request|response|namespaces?|object overview|multi-dimensional parameters|webhook configurations?|read the .*results?|weather codes|action (?:response schema|message body))$/i;
const REQUEST_HEADING = /\b(request|parameters?|body|input|query|path)\b/i;
const EXCLUDE_HEADING = /\b(response|error|limits?|samples?|examples?)\b/i;
const STOP = new Set([
  'a',
  'an',
  'the',
  'of',
  'for',
  'to',
  'and',
  'method',
  'api',
  'apis',
  'new',
  'existing',
  'all',
  'its',
  'with',
]);

/** `Directions API` → `directions`; `Search Places API` → `search-places`. */
export function apiSlug(api: string): string {
  return slugify(api)
    .split('-')
    .filter((t) => t !== 'api' && t !== 'apis')
    .join('-');
}

function variantTokens(heading: string, apiWords: ReadonlySet<string>): string[] {
  return slugify(heading)
    .split('-')
    .filter((t) => t.length > 0 && !STOP.has(t) && !apiWords.has(stem(t)));
}

/**
 * `<api-slug>[/<variant>]`: the variant is built from the page's own slug (when it is not
 * the API's index page) and from every non-generic heading above the table, minus the
 * API's own words. `Directions Flexible API` → `directions/flexible`;
 * `Create a Geofence` → `geofence/create`; the synchronous Distance Matrix page's
 * `Distance Matrix Fast API` → `distance-matrix/synchronous-fast`.
 */
export function endpointFor(page: PageRecord, headingPath: ReadonlyArray<string>): string {
  const api = apiSlug(page.api);
  const apiWords = new Set(api.split('-').map(stem));
  const seen = new Set<string>();
  const tokens: string[] = [];
  const push = (list: string[]): void => {
    for (const token of list) {
      const key = stem(token);
      if (seen.has(key)) continue;
      seen.add(key);
      tokens.push(token);
    }
  };
  push(variantTokens(page.doc_id.split('/').pop() ?? '', apiWords));
  for (const heading of headingPath.slice(1)) {
    if (GENERIC_HEADING.test(heading.trim())) continue;
    push(variantTokens(heading, apiWords));
  }
  return tokens.length === 0 ? api : `${api}/${tokens.join('-')}`;
}

interface Table {
  headers: string[];
  rows: string[][];
}

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

export function parseTable(lines: ReadonlyArray<string>): Table | undefined {
  if (lines.length < 3) return undefined;
  const headers = splitRow(lines[0]!);
  const separator = splitRow(lines[1]!);
  if (!separator.every((c) => /^:?-{2,}:?$/.test(c.trim()))) return undefined;
  const rows = lines.slice(2).map((l) => {
    const cells = splitRow(l);
    while (cells.length < headers.length) cells.push('');
    return cells;
  });
  return { headers, rows };
}

type Role = 'name' | 'required' | 'format' | 'type' | 'description' | 'default' | 'location';

function roleOf(header: string): Role | undefined {
  const h = header.toLowerCase().replace(/[`*]/g, '').trim();
  if (/^(name|field|parameter|param|property|key|attribute)s?$/.test(h)) return 'name';
  if (h === 'required') return 'required';
  if (/^format/.test(h)) return 'format';
  if (/^type/.test(h)) return 'type';
  if (h === 'description' || h === 'details') return 'description';
  if (h === 'default') return 'default';
  if (h === 'location') return 'location';
  return undefined;
}

const clean = (cell: string): string =>
  cell
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const code = (value: string): string =>
  value
    .replace(/^`|`$/g, '')
    .replace(/^\*\*|\*\*$/g, '')
    .trim();

const UNIT_WORDS: Record<string, string> = {
  kilogram: 'kilograms',
  kilograms: 'kilograms',
  kg: 'kilograms',
  kgs: 'kilograms',
  gram: 'grams',
  grams: 'grams',
  tonne: 'tonnes',
  tonnes: 'tonnes',
  ton: 'tons',
  tons: 'tons',
  meter: 'meters',
  meters: 'meters',
  metre: 'meters',
  metres: 'meters',
  kilometer: 'kilometers',
  kilometers: 'kilometers',
  kilometre: 'kilometers',
  kilometres: 'kilometers',
  km: 'kilometers',
  centimeter: 'centimeters',
  centimeters: 'centimeters',
  centimetre: 'centimeters',
  centimetres: 'centimeters',
  cm: 'centimeters',
  second: 'seconds',
  seconds: 'seconds',
  sec: 'seconds',
  secs: 'seconds',
  minute: 'minutes',
  minutes: 'minutes',
  min: 'minutes',
  mins: 'minutes',
  hour: 'hours',
  hours: 'hours',
  hr: 'hours',
  hrs: 'hours',
  millisecond: 'milliseconds',
  milliseconds: 'milliseconds',
  ms: 'milliseconds',
  degree: 'degrees',
  degrees: 'degrees',
  percent: 'percent',
  percentage: 'percent',
  'km/h': 'km/h',
  kph: 'km/h',
  mph: 'mph',
  'm/s': 'm/s',
};
const UNIT_PATTERN = new RegExp(
  `\\b(?:in|as)\\s+(${Object.keys(UNIT_WORDS)
    .map((w) => w.replace('/', '\\/'))
    .join('|')})\\b`,
  'i',
);

/** The unit the docs state for a parameter, or null. Never inferred from the name. */
export function unitsFrom(text: string): string | null {
  const explicit = /\bunits?\s*:\s*`?([a-z]+(?:\/[a-z]+)?)`?/i.exec(text);
  if (explicit) {
    const word = explicit[1]!.toLowerCase();
    if (UNIT_WORDS[word]) return UNIT_WORDS[word]!;
  }
  const match = UNIT_PATTERN.exec(text);
  if (match) return UNIT_WORDS[match[1]!.toLowerCase()] ?? match[1]!.toLowerCase();
  if (/\bunix\s+(?:epoch|timestamp)\b/i.test(text)) {
    return /\b(?:milliseconds|ms)\b/i.test(text)
      ? 'unix timestamp (milliseconds)'
      : 'unix timestamp (seconds)';
  }
  return null;
}

export const NUMERIC_TYPE = /^(integer|int|number|float|double|long|decimal|numeric)/i;

function parseFormat(cell: string): Partial<ParameterRecord> & { formatNote?: string } {
  const out: Partial<ParameterRecord> & { formatNote?: string } = {};
  for (const raw of cell.split(/<br\s*\/?>/i)) {
    const piece = raw.trim();
    const m = /^([A-Za-z][A-Za-z ]{1,24}?)\s*:\s*(.+)$/.exec(piece);
    if (!m) continue;
    const key = m[1]!.toLowerCase().trim();
    const value = m[2]!.trim().replace(/,$/, '');
    if (key === 'type') out.type = code(value).toLowerCase();
    else if (key === 'default') out.default = code(value);
    else if (/^(allowed values?|values|options|enum)$/.test(key)) {
      out.allowed_values = value
        .split(/,\s*|\s+or\s+/)
        .map(code)
        .filter((v) => v.length > 0);
    } else if (key === 'example') out.example = code(value);
    else if (/^(minimum( value)?|min)$/.test(key)) out.minimum = code(value);
    else if (/^(maximum( value)?|max)$/.test(key)) out.maximum = code(value);
    else if (key === 'format') out.formatNote = value;
    else if (/^units?$/.test(key)) out.units = value.toLowerCase();
  }
  return out;
}

function locationFrom(heading: string, explicit?: string): ParameterRecord['location'] {
  const text = `${explicit ?? ''} ${heading}`.toLowerCase();
  if (/\bpath\b/.test(text)) return 'path';
  if (/\bbody\b/.test(text)) return 'body';
  if (/\bquery\b|\brequest parameters?\b|\bget request\b/.test(text)) return 'query';
  return null;
}

/** Extract request parameters from one page's Markdown. */
export function extractParameters(page: PageRecord, markdown: string): ParameterRecord[] {
  const blocks = parseBlocks(markdown);
  const sections = splitSections(blocks);
  const records: ParameterRecord[] = [];
  for (const section of sections) {
    let nearest: Block | undefined;
    for (const block of section.blocks) {
      if (block.kind === 'heading') {
        nearest = block;
        continue;
      }
      if (block.kind !== 'table') continue;
      const table = parseTable(block.lines);
      if (!table) continue;
      const roles = table.headers.map(roleOf);
      const col = (role: Role): number => roles.indexOf(role);
      if (
        col('name') === -1 ||
        (col('type') === -1 && col('format') === -1 && col('description') === -1)
      )
        continue;
      const tableHeading =
        nearest?.heading ?? section.headingPath[section.headingPath.length - 1] ?? '';
      const requestLayout = col('required') !== -1 || col('format') !== -1;
      if (
        !requestLayout &&
        !(REQUEST_HEADING.test(tableHeading) && !EXCLUDE_HEADING.test(tableHeading))
      )
        continue;
      if (EXCLUDE_HEADING.test(tableHeading) && /\bresponse\b/i.test(tableHeading)) continue;

      const headingPath = [...section.headingPath];
      if (
        nearest &&
        (nearest.level ?? 0) > section.level &&
        nearest.heading &&
        headingPath[headingPath.length - 1] !== nearest.heading
      ) {
        headingPath.push(nearest.heading);
      }
      const endpoint = endpointFor(page, headingPath);

      for (const row of table.rows) {
        const name = code(row[col('name')] ?? '');
        if (!/^[A-Za-z_][\w.\-\[\]]*$/.test(name)) continue;
        const format = col('format') !== -1 ? parseFormat(row[col('format')]!) : {};
        const typeCell = col('type') !== -1 ? clean(row[col('type')]!) : '';
        let type = format.type ?? (typeCell ? code(typeCell).toLowerCase() : null);
        let explicitLocation: string | undefined;
        if (type && type.includes('/') && !/\bkm\/h|m\/s/.test(type)) {
          const [t, loc] = type.split('/').map((x) => x.trim());
          type = t || null;
          explicitLocation = loc;
        }
        const requiredCell =
          col('required') !== -1 ? clean(row[col('required')]!).toLowerCase() : '';
        const required = /^(yes|required|true|mandatory)/.test(requiredCell)
          ? true
          : /^(no|optional|false)/.test(requiredCell)
            ? false
            : null;
        const description = clean(row[col('description')] ?? '');
        const defaultValue =
          format.default ??
          (col('default') !== -1 ? code(clean(row[col('default')]!)) || null : null);
        const unitText = `${format.formatNote ?? ''} ${description}`;
        const record: ParameterRecord = {
          endpoint,
          name,
          type,
          required,
          default: defaultValue,
          allowed_values: format.allowed_values ?? [],
          units: format.units ?? unitsFrom(unitText),
          location: locationFrom(
            tableHeading,
            explicitLocation ?? (col('location') !== -1 ? row[col('location')] : undefined),
          ),
          description,
          heading_path: headingPath,
          doc_id: page.doc_id,
        };
        if (format.example) record.example = format.example;
        if (format.minimum) record.minimum = format.minimum;
        if (format.maximum) record.maximum = format.maximum;
        records.push(record);
      }
    }
  }
  return records;
}

/** Keep the first record per (endpoint, name); callers pass reference pages first. */
export function dedupe(records: ReadonlyArray<ParameterRecord>): ParameterRecord[] {
  const seen = new Set<string>();
  const out: ParameterRecord[] = [];
  for (const record of records) {
    const key = `${record.endpoint}|${record.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

export function missingUnitsReport(
  records: ReadonlyArray<ParameterRecord>,
  provenance: string,
): string {
  const numeric = records.filter(
    (r) => r.type !== null && NUMERIC_TYPE.test(r.type) && r.units === null,
  );
  const byDoc = new Map<string, ParameterRecord[]>();
  for (const r of numeric) byDoc.set(r.doc_id, [...(byDoc.get(r.doc_id) ?? []), r]);
  return [
    '# Numeric parameters without a stated unit',
    '',
    provenance,
    '',
    `For the docs team: ${numeric.length} numeric request parameters (of ${records.length} extracted) have no unit in their description or format cell, so \`get_api_parameters\` returns \`units: null\` for them. Adding "in seconds", "in meters", etc. to the docs fixes this without any code change.`,
    '',
    ...[...byDoc.entries()].flatMap(([docId, list]) => [
      `## ${docId} (${list.length})`,
      '',
      '| Endpoint | Parameter | Type | Section |',
      '| --- | --- | --- | --- |',
      ...list.map(
        (r) => `| ${r.endpoint} | ${r.name} | ${r.type} | ${r.heading_path.slice(1).join(' > ')} |`,
      ),
      '',
    ]),
  ].join('\n');
}
