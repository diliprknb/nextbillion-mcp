/**
 * Reads nb-public-docs straight from GitHub so the hosted server can rebuild its
 * documentation index whenever `main` moves: one request learns the current commit
 * (conditional, free when unchanged), one more downloads the repository as a tarball
 * (~1 MB gzipped) when it has. No git, no clone, no disk.
 */
import { gunzipSync } from 'node:zlib';

export interface GitHubDocsSource {
  /** `owner/name` */
  repo: string;
  /** Branch, tag or commit; default `main`. */
  ref: string;
  /** Token with read access to the repository (private); optional for public ones. */
  token?: string;
  fetchFn?: typeof fetch;
}

export interface RepoSnapshot {
  commitSha: string;
  /** Commit date (ISO 8601) of `commitSha`, when the API returned one. */
  commitDate?: string;
  /** Repo-relative path → UTF-8 content, for every regular file in the tarball. */
  files: Map<string, string>;
}

const API = 'https://api.github.com';
const FETCH_TIMEOUT_MS = 60_000;

function headers(source: GitHubDocsSource, accept: string): Record<string, string> {
  const h: Record<string, string> = {
    accept,
    'user-agent': 'nextbillion-mcp',
    'x-github-api-version': '2022-11-28',
  };
  if (source.token) h.authorization = `Bearer ${source.token}`;
  return h;
}

async function request(
  source: GitHubDocsSource,
  path: string,
  accept: string,
  extra: Record<string, string> = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await (source.fetchFn ?? fetch)(`${API}${path}`, {
      headers: { ...headers(source, accept), ...extra },
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The commit `ref` currently points at. With `knownSha`, an unchanged ref costs a 304
 * that GitHub does not count against the rate limit.
 */
export async function latestCommit(
  source: GitHubDocsSource,
  knownSha?: string,
): Promise<{ changed: boolean; sha: string; date?: string }> {
  const response = await request(
    source,
    `/repos/${source.repo}/commits/${encodeURIComponent(source.ref)}`,
    'application/vnd.github+json',
    knownSha ? { 'if-none-match': `"${knownSha}"` } : {},
  );
  if (response.status === 304 && knownSha) return { changed: false, sha: knownSha };
  if (!response.ok) throw new Error(`GitHub ${response.status} for ${source.repo}@${source.ref}`);
  const body = (await response.json()) as {
    sha?: string;
    commit?: { committer?: { date?: string } };
  };
  if (typeof body.sha !== 'string') throw new Error('GitHub commit response has no sha');
  return { changed: body.sha !== knownSha, sha: body.sha, date: body.commit?.committer?.date };
}

/** Downloads the repository at `ref` and returns its files. */
export async function fetchSnapshot(source: GitHubDocsSource): Promise<RepoSnapshot> {
  const head = await latestCommit(source);
  const response = await request(
    source,
    `/repos/${source.repo}/tarball/${encodeURIComponent(head.sha)}`,
    'application/vnd.github+json',
  );
  if (!response.ok)
    throw new Error(`GitHub ${response.status} downloading ${source.repo}@${head.sha.slice(0, 7)}`);
  const tar = gunzipSync(Buffer.from(await response.arrayBuffer()));
  const files = new Map<string, string>();
  for (const entry of readTar(tar)) {
    // GitHub prefixes every path with `<owner>-<repo>-<sha>/`.
    const slash = entry.path.indexOf('/');
    if (slash === -1) continue;
    files.set(entry.path.slice(slash + 1), entry.content.toString('utf8'));
  }
  return { commitSha: head.sha, commitDate: head.date, files };
}

interface TarEntry {
  path: string;
  content: Buffer;
}

/** Minimal POSIX ustar / GNU tar reader: regular files only, long names supported. */
export function* readTar(tar: Buffer): Generator<TarEntry> {
  let offset = 0;
  let longName: string | undefined;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive blocks
    const name = cstr(header, 0, 100);
    const size = parseInt(cstr(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156]!);
    const prefix = cstr(header, 345, 155);
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'L') {
      longName = cstr(data, 0, size); // GNU long name: applies to the next entry
      continue;
    }
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = undefined;
    if (type === '0' || type === '\0' || type === '') {
      yield { path, content: Buffer.from(data) };
    }
  }
}

function cstr(buffer: Buffer, start: number, length: number): string {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}
