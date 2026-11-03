import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDocsIndexFile, isDocsPage } from '../../src/docs/builder.js';
import { fetchSnapshot, latestCommit, readTar } from '../../src/docs/github.js';
import { DOCS_FIXTURE } from '../setup.js';
import {
  configureDocsIndex,
  docsIndexInfo,
  getDocsIndex,
  refreshDocsIndex,
  startDocsIndex,
} from '../../src/docs/store.js';

/** A tar archive (ustar headers) of the given files, as GitHub would prefix them. */
function tarball(prefix: string, files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [path, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const header = Buffer.alloc(512);
    header.write(`${prefix}/${path}`, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8);
    header.write('0000000\0', 108, 8);
    header.write('0000000\0', 116, 8);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12);
    header.write('00000000000\0', 136, 12);
    header.write('        ', 148, 8); // checksum placeholder
    header.write('0', 156, 1);
    header.write('ustar\0', 257, 6);
    header.write('00', 263, 2);
    let sum = 0;
    for (const b of header) sum += b;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const DOCS = {
  'Routing/Directions API/directions-api.md':
    '# Directions API\n\nComputes routes.\n\n## Request Parameters\n\n| Parameter | Type | Description |\n|---|---|---|\n| key | string | Required. Your API key. |\n',
  'README.md': '# not a page\n',
};

function github(commits: string[], files: Record<string, string> = DOCS) {
  const calls: string[] = [];
  let impl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push(`${url}${headers.get('if-none-match') ? ' (conditional)' : ''}`);
    const sha = commits[0]!;
    if (/\/commits\//.test(url)) {
      if (headers.get('if-none-match') === `"${sha}"`) return new Response(null, { status: 304 });
      return Response.json({ sha, commit: { committer: { date: '2026-10-27T00:00:00Z' } } });
    }
    if (/\/tarball\//.test(url)) {
      return new Response(new Uint8Array(tarball(`owner-repo-${sha}`, files)), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  const fetchFn: typeof fetch = (input, init) => impl(input, init);
  return {
    fetchFn,
    calls,
    advance: (sha: string) => commits.unshift(sha),
    breakNetwork: () => {
      impl = async () => {
        throw new Error('boom');
      };
    },
  };
}

afterEach(() => configureDocsIndex({}));

describe('builder', () => {
  it('indexes Markdown pages, skips README and excluded pages, and extracts parameters', () => {
    expect(isDocsPage('Routing/x.md')).toBe(true);
    expect(isDocsPage('README.md')).toBe(false);
    expect(isDocsPage('Routing/README.md')).toBe(false);
    expect(isDocsPage('image.png')).toBe(false);
    const files = new Map(Object.entries(DOCS));
    files.set('Secret/draft.md', '# Draft\n');
    const { index, skipped, problems } = buildDocsIndexFile({
      files,
      commitSha: 'abc',
      docsUpdatedAt: '2026-10-27T00:00:00Z',
      overrides: { folderAliases: {}, pages: { 'Secret/draft.md': { exclude: 'unpublished' } } },
    });
    expect(problems).toEqual([]);
    expect(skipped).toEqual([{ path: 'Secret/draft.md', reason: 'unpublished' }]);
    expect(index.meta).toMatchObject({ format: 2, commit_sha: 'abc', pages: 1 });
    expect(index.pages[0]).toMatchObject({
      doc_id: 'routing/directions-api/directions-api',
      title: 'Directions API',
      source_url: 'https://docs.nextbillion.ai/routing/directions-api',
    });
    expect(index.parameters.map((p) => p.name)).toEqual(['key']);
  });
});

describe('github', () => {
  it('reads a tarball and strips the repository prefix', async () => {
    const entries = [...readTar(Buffer.from(gzipSync(Buffer.alloc(0)).length ? [] : []))];
    expect(entries).toEqual([]);
    const gh = github(['c1']);
    const snapshot = await fetchSnapshot({ repo: 'owner/repo', ref: 'main', fetchFn: gh.fetchFn });
    expect(snapshot.commitSha).toBe('c1');
    expect([...snapshot.files.keys()].sort()).toEqual(Object.keys(DOCS).sort());
    expect(snapshot.files.get('README.md')).toBe('# not a page\n');
  });

  it('answers unchanged from a conditional request', async () => {
    const gh = github(['c1']);
    const src = { repo: 'owner/repo', ref: 'main', fetchFn: gh.fetchFn };
    expect(await latestCommit(src)).toMatchObject({ changed: true, sha: 'c1' });
    expect(await latestCommit(src, 'c1')).toEqual({ changed: false, sha: 'c1' });
    gh.advance('c2');
    expect(await latestCommit(src, 'c1')).toMatchObject({ changed: true, sha: 'c2' });
  });
});

describe('hosted index lifecycle', () => {
  it('builds from GitHub at start, ignores unchanged checks, rebuilds when main moves', async () => {
    const gh = github(['c1']);
    configureDocsIndex({
      github: { repo: 'owner/repo', ref: 'main', fetchFn: gh.fetchFn },
    });
    await startDocsIndex();
    expect(docsIndexInfo()).toMatchObject({ origin: 'github', commit_sha: 'c1' });
    expect((await getDocsIndex()).pageList[0]!.title).toBe('Directions API');

    expect((await refreshDocsIndex()).status).toBe('unchanged');
    expect(gh.calls.at(-1)).toMatch(/\/commits\/main \(conditional\)$/);

    gh.advance('c2');
    expect((await refreshDocsIndex()).status).toBe('rebuilt');
    expect(docsIndexInfo()).toMatchObject({ origin: 'github', commit_sha: 'c2' });
  });

  it('keeps the previous index when a refresh fails and reports the error', async () => {
    const gh = github(['c1']);
    configureDocsIndex({
      github: { repo: 'owner/repo', ref: 'main', fetchFn: gh.fetchFn },
    });
    await startDocsIndex();
    gh.breakNetwork();
    expect((await refreshDocsIndex()).status).toBe('failed');
    expect(docsIndexInfo()).toMatchObject({ origin: 'github', commit_sha: 'c1' });
    expect(docsIndexInfo().last_error).toMatch(/boom/);
  });

  it('serves a configured index file and reports its origin', async () => {
    configureDocsIndex({ file: DOCS_FIXTURE });
    expect((await getDocsIndex()).pageList.length).toBeGreaterThan(20);
    expect(docsIndexInfo()).toMatchObject({ origin: 'file' });
  });

  it('explains itself when nothing is available', async () => {
    configureDocsIndex({
      github: {
        repo: 'owner/repo',
        ref: 'main',
        fetchFn: async () => {
          throw new Error('ENOTFOUND api.github.com');
        },
      },
    });
    await startDocsIndex();
    expect(docsIndexInfo()).toMatchObject({ origin: 'none' });
    await expect(getDocsIndex()).rejects.toThrow(
      /index is temporarily unavailable \(ENOTFOUND.*https:\/\/docs\.nextbillion\.ai/,
    );
  });
});
