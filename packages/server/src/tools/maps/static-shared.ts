import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as z from 'zod/v4';
import { imageOutputDir } from '../../config.js';
import { logError } from '../../log.js';
import type { NbClient, Query } from '../../nbclient/client.js';
import { CoordinateSchema, type Coordinate } from '../shared/geo.js';
import { fitPolylineToBudget } from './polyline.js';
import type { ToolResult } from '../types.js';

export const StaticImageShape = {
  width: z
    .number()
    .int()
    .min(16)
    .max(2048)
    .optional()
    .describe('Image width in pixels (default 512)'),
  height: z
    .number()
    .int()
    .min(16)
    .max(2048)
    .optional()
    .describe('Image height in pixels (default 512)'),
  style: z
    .string()
    .optional()
    .describe('Map style id: "streets", "light", "dark", or "hybrid" (default streets)'),
  format: z.enum(['png', 'jpg', 'webp']).optional().describe('Image format (default png)'),
  retina: z.boolean().optional().describe('Render at @2x resolution for high-DPI displays'),
};

export const MarkerSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  color: z
    .string()
    .optional()
    .describe('Marker color, e.g. "red" or "#0000ff" (ignored when icon_url is set)'),
  icon_url: z
    .string()
    .url()
    .optional()
    .describe('URL of a custom marker image (max 64 kB / 4096 px, e.g. 64x64 PNG)'),
  anchor: z
    .enum([
      'top',
      'left',
      'bottom',
      'right',
      'center',
      'topleft',
      'bottomleft',
      'topright',
      'bottomright',
    ])
    .optional()
    .describe('Anchor point of a custom icon (default bottom)'),
  scale: z.number().positive().optional().describe('Custom icon scale factor (default 1)'),
});
export type MarkerInput = z.output<typeof MarkerSchema>;

export const PathSchema = z
  .strictObject({
    points: z
      .array(CoordinateSchema)
      .min(2)
      .optional()
      .describe('Vertices as {latitude, longitude} objects'),
    geojson_coordinates: z
      .array(z.array(z.number()).min(2).max(2))
      .min(2)
      .optional()
      .describe(
        'Vertices as GeoJSON [longitude, latitude] pairs - pass an isochrone or GeoJSON ring here unchanged',
      ),
    stroke_color: z.string().optional().describe('Line color (default blue)'),
    stroke_width: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Line width in px (default 3)'),
    fill_color: z
      .string()
      .optional()
      .describe(
        'Fill color for a closed shape, e.g. "rgba(255,0,0,0.3)" or "#ff000055"; omit for a line',
      ),
  })
  .describe('A line or filled polygon overlay');
export type PathInput = z.output<typeof PathSchema>;

export const PathsShape = {
  paths: z
    .array(PathSchema)
    .max(10)
    .optional()
    .describe('Extra lines/polygons to draw (e.g. isochrone contours as filled polygons)'),
};

export interface StaticImageArgs {
  width?: number;
  height?: number;
  style?: string;
  format?: 'png' | 'jpg' | 'webp';
  retina?: boolean;
}

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

/** Build the `/maps/{style}/static/{position}/{size}.{format}` path. */
export function staticImagePath(positionSegment: string, args: StaticImageArgs): string {
  const style = args.style ?? 'streets';
  const size = `${args.width ?? 512}x${args.height ?? 512}${args.retina ? '@2x' : ''}`;
  const format = args.format ?? 'png';
  return `/maps/${encodeURIComponent(style)}/static/${positionSegment}/${size}.${format}`;
}

/**
 * Marker coordinate order differs per endpoint variant (verified against the live API,
 * 2026-08-31): the center-based endpoint parses `markers` as `longitude,latitude` (as
 * documented), but the auto-fit endpoint parses them as `latitude,longitude` — sending
 * the documented order there places markers in the wrong hemisphere and forces a
 * world-level auto-zoom. Paths and center segments are `lat,lng` everywhere.
 */
export function markerParam(markers: MarkerInput[], order: 'lng-first' | 'lat-first'): string {
  return markers
    .map((m) => {
      const pair =
        order === 'lng-first' ? `${m.longitude},${m.latitude}` : `${m.latitude},${m.longitude}`;
      const commands: string[] = [];
      // The query builder URL-encodes the whole value once; pre-encoding here would double-encode.
      if (m.icon_url) commands.push(`icon:${m.icon_url}`);
      if (m.anchor) commands.push(`anchor:${m.anchor}`);
      if (m.scale !== undefined) commands.push(`scale:${m.scale}`);
      const color = m.color && !m.icon_url ? `,${m.color}` : '';
      return `${commands.length ? commands.join('|') + '|' : ''}${pair}${color}`;
    })
    .join('|');
}

export async function fetchImageResult(
  nb: NbClient,
  path: string,
  query: Query,
  caption: string,
  args: StaticImageArgs,
  filePrefix = 'map',
): Promise<ToolResult> {
  const image = await nb.getBinary(path, query);
  const mimeType = image.contentType.startsWith('image/')
    ? image.contentType
    : MIME_TYPES[args.format ?? 'png']!;
  const savedPath = await saveImage(image.data, filePrefix, args.format ?? 'png');
  const location = savedPath
    ? ` Saved to ${savedPath} (for clients that cannot display images inline).`
    : '';
  return {
    content: [
      { type: 'image', data: Buffer.from(image.data).toString('base64'), mimeType },
      { type: 'text', text: caption + location },
    ],
  };
}

/**
 * Persist the rendered image locally so terminal clients (which drop inline image
 * content) can open it. Opt-in: does nothing unless NBAI_IMAGE_DIR is set. The file name
 * is fixed by the server (prefix, UTC timestamp, content hash), never by tool arguments,
 * and an existing file is never overwritten. Failures are logged and never fail the call.
 */
async function saveImage(
  data: Uint8Array,
  prefix: string,
  ext: string,
): Promise<string | undefined> {
  const dir = imageOutputDir();
  if (!dir) return undefined;
  try {
    await mkdir(dir, { recursive: true });
    const hash = createHash('sha1').update(data).digest('hex').slice(0, 8);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
    const filePath = join(dir, `${prefix}-${stamp}-${hash}.${ext === 'jpg' ? 'jpg' : ext}`);
    try {
      await writeFile(filePath, data, { flag: 'wx' });
    } catch (error) {
      // Same second and same content hash: the identical file is already there.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    return filePath;
  } catch (error) {
    logError('Could not save rendered image to disk', error);
    return undefined;
  }
}

/** Stay comfortably under the Static Images API's documented 8192-byte URL limit. */
export const URL_BYTE_BUDGET = 8000;

function pathVertices(path: PathInput): Coordinate[] {
  const vertices = path.points?.length
    ? path.points
    : (path.geojson_coordinates ?? []).map(([longitude, latitude]) => ({ latitude, longitude }));
  // The API fills a closed shape but strokes only the edges between the given vertices, so
  // a filled polygon whose ring is not explicitly closed renders without its last edge.
  // Close it (GeoJSON rings already repeat the first vertex, so this is a no-op for them).
  if (path.fill_color && vertices.length >= 3) {
    const first = vertices[0]!;
    const last = vertices[vertices.length - 1]!;
    if (first.latitude !== last.latitude || first.longitude !== last.longitude) {
      return [...vertices, first];
    }
  }
  return vertices;
}

/**
 * Serialize overlay paths as `path=` query values. Geometry is always sent as a Google
 * encoded polyline (`enc:`), which is far more compact than raw coordinate lists; when
 * `maxEncodedChars` is given each path is simplified to fit it (used when the request
 * URL would otherwise exceed the API limit).
 */
export function pathParams(
  paths: PathInput[],
  maxEncodedChars = Number.POSITIVE_INFINITY,
): { values: string[]; simplified: boolean } {
  let simplified = false;
  const values = paths.map((path) => {
    const style = [
      `stroke:${path.stroke_color ?? 'blue'}`,
      `width:${path.stroke_width ?? 3}`,
      `fill:${path.fill_color ?? 'none'}`,
    ];
    const fitted = fitPolylineToBudget(pathVertices(path), maxEncodedChars);
    simplified ||= fitted.simplified;
    return `${style.join('|')}|enc:${fitted.encoded}`;
  });
  return { values, simplified };
}
