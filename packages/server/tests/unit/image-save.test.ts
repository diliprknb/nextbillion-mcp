import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageOutputDir, resolveImageDir } from '../../src/config.js';
import { staticMapImage } from '../../src/tools/maps/static-map-image.js';
import { fakeNbClient } from '../helpers/fake-fetch.js';

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const ARGS = { center: { latitude: 1.28, longitude: 103.85 }, zoom: 12 };

function captionOf(result: Awaited<ReturnType<typeof staticMapImage.run>>): string {
  return (result.content.find((c) => c.type === 'text') as { text: string }).text;
}

describe('NBAI_IMAGE_DIR resolution', () => {
  it('disables saving when unset or empty', () => {
    expect(resolveImageDir({})).toEqual({});
    expect(resolveImageDir({ NBAI_IMAGE_DIR: '  ' })).toEqual({});
    expect(imageOutputDir({})).toBeUndefined();
  });

  it('maps the portable value "tmp" to the OS temp directory', () => {
    expect(resolveImageDir({ NBAI_IMAGE_DIR: 'tmp' })).toEqual({
      dir: join(tmpdir(), 'nextbillion-mcp'),
    });
    expect(resolveImageDir({ NBAI_IMAGE_DIR: 'TMP' }).dir).toBe(join(tmpdir(), 'nextbillion-mcp'));
  });

  it('accepts absolute paths and rejects relative ones with a warning', () => {
    const absolute = join(tmpdir(), 'somewhere');
    expect(resolveImageDir({ NBAI_IMAGE_DIR: absolute })).toEqual({ dir: absolute });
    const relative = resolveImageDir({ NBAI_IMAGE_DIR: 'images' });
    expect(relative.dir).toBeUndefined();
    expect(relative.warning).toMatch(/absolute path or "tmp"/);
  });
});

describe('saving rendered images is opt-in', () => {
  let dir: string;
  let previous: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nb-mcp-test-'));
    previous = process.env.NBAI_IMAGE_DIR;
  });
  afterEach(() => {
    vi.useRealTimers();
    if (previous === undefined) delete process.env.NBAI_IMAGE_DIR;
    else process.env.NBAI_IMAGE_DIR = previous;
  });

  it('writes nothing and reports no path when NBAI_IMAGE_DIR is unset', async () => {
    delete process.env.NBAI_IMAGE_DIR;
    const { nb } = fakeNbClient({ responses: [{ body: PNG_BYTES, contentType: 'image/png' }] });
    const result = await staticMapImage.run(ARGS, nb);
    expect(captionOf(result)).not.toContain('Saved to');
    expect(readdirSync(dir)).toHaveLength(0);
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });

  it('writes the PNG to NBAI_IMAGE_DIR and reports the path in the caption', async () => {
    process.env.NBAI_IMAGE_DIR = dir;
    const { nb } = fakeNbClient({ responses: [{ body: PNG_BYTES, contentType: 'image/png' }] });
    const result = await staticMapImage.run(ARGS, nb);
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^map-\d{8}T\d{6}-[0-9a-f]{8}\.png$/);
    expect(new Uint8Array(readFileSync(join(dir, files[0]!)))).toEqual(PNG_BYTES);
    expect(captionOf(result)).toContain(`Saved to ${join(dir, files[0]!)}`);
    // inline image is still returned first for clients that can display it
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });

  it('never overwrites an existing file', async () => {
    process.env.NBAI_IMAGE_DIR = dir;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-23T08:00:00Z'));
    const { nb } = fakeNbClient({ responses: [{ body: PNG_BYTES, contentType: 'image/png' }] });
    const first = await staticMapImage.run(ARGS, nb);
    const [file] = readdirSync(dir);
    const path = join(dir, file!);
    expect(captionOf(first)).toContain(`Saved to ${path}`);
    writeFileSync(path, 'pre-existing content'); // simulate a foreign file with our exact name
    const { nb: again } = fakeNbClient({
      responses: [{ body: PNG_BYTES, contentType: 'image/png' }],
    });
    const second = await staticMapImage.run(ARGS, again);
    expect(readFileSync(path, 'utf8')).toBe('pre-existing content');
    expect(readdirSync(dir)).toHaveLength(1);
    expect(captionOf(second)).toContain(`Saved to ${path}`);
  });

  it('disables saving on a relative NBAI_IMAGE_DIR instead of writing to the working directory', async () => {
    process.env.NBAI_IMAGE_DIR = 'relative-images';
    const { nb } = fakeNbClient({ responses: [{ body: PNG_BYTES, contentType: 'image/png' }] });
    const result = await staticMapImage.run(ARGS, nb);
    expect(captionOf(result)).not.toContain('Saved to');
  });
});
