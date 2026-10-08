/**
 * Maps Markdown pages of the private `nextbillion-ai/nb-public-docs` repository to their
 * published URLs on https://docs.nextbillion.ai.
 *
 * The docs repo has no site configuration and no front matter, so a page's URL is derived
 * from its file path by rules plus two checked-in tables (docs/url-overrides.json):
 *   - folderAliases: slugified folder path -> URL path prefix (SDK folders, renamed APIs)
 *   - pages: exact file path -> { url } for one-off renames (optionally with a #fragment
 *     when several files are sections of one live page), or { exclude } with a reason.
 * The live sitemap is the source of truth: validate-mapping.ts fails when a mapped URL
 * is not in it, or when a file is neither mapped nor explicitly excluded.
 *
 * Shared by the indexer, the validation script and the unit tests. Pure, no I/O.
 */
export const DOCS_SITE = 'https://docs.nextbillion.ai';

export type PageOverride = { url: string; why?: string } | { exclude: string };

export interface UrlOverrides {
  folderAliases: Record<string, string>;
  pages: Record<string, PageOverride>;
}

export type MappingRule = 'page-override' | 'folder-alias' | 'path-rules';

export type MappingResult =
  | { kind: 'url'; path: string; url: string; rule: MappingRule }
  | { kind: 'excluded'; reason: string };

/** Lower-case; runs of non-alphanumerics become one dash; no leading or trailing dash. */
export function slugify(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Stable page id: the slugified repo path without `.md` (spec §6). */
export function docIdForPath(relPath: string): string {
  return stripMd(relPath).split('/').map(slugify).join('/');
}

/** URL path without a `#fragment`, for sitemap comparison. */
export function stripFragment(urlPath: string): string {
  const i = urlPath.indexOf('#');
  return i === -1 ? urlPath : urlPath.slice(0, i);
}

function stripMd(relPath: string): string {
  return relPath.replace(/\.md$/i, '');
}

function urlResult(path: string, rule: MappingRule): MappingResult {
  return { kind: 'url', path, url: `${DOCS_SITE}/${path}`, rule };
}

/**
 * Resolve one repo-relative Markdown path (e.g. `Routing/Directions API/directions-api.md`)
 * to its published URL path (e.g. `routing/directions-api`), or to an explicit exclusion.
 */
export function mapDocPath(relPath: string, overrides: UrlOverrides): MappingResult {
  const override = overrides.pages[relPath];
  if (override !== undefined) {
    if ('exclude' in override) return { kind: 'excluded', reason: override.exclude };
    return urlResult(override.url, 'page-override');
  }

  const segments = stripMd(relPath).split('/').map(slugify);
  // Index pages: `<Folder>/<folder>.md` is published at the folder's own URL.
  if (segments.length >= 2 && segments[segments.length - 1] === segments[segments.length - 2]) {
    segments.pop();
  }
  // Longest folder prefix with an alias wins; the remainder of the path is kept.
  for (let n = segments.length; n >= 1; n -= 1) {
    const alias = overrides.folderAliases[segments.slice(0, n).join('/')];
    if (alias !== undefined) {
      const path = [alias, ...segments.slice(n)].filter((s) => s.length > 0).join('/');
      return urlResult(path, 'folder-alias');
    }
  }
  return urlResult(segments.join('/'), 'path-rules');
}
