/**
 * Validates the docs → URL mapping against the live-sitemap snapshot and maintains the
 * two coverage reports required by the Docs KB spec (§5):
 *   docs/reports/files-without-urls.md   pages that are not indexed, and why
 *   docs/reports/urls-without-files.md   live pages with no source in nb-public-docs
 *
 * Usage (from packages/server):
 *   tsx scripts/docs/validate-mapping.ts                      check mode: fails on errors or stale reports
 *   tsx scripts/docs/validate-mapping.ts --write              regenerate the reports
 *   tsx scripts/docs/validate-mapping.ts --docs <clone> --write      also refresh docs-files.txt + the pin
 *   tsx scripts/docs/validate-mapping.ts --fetch-sitemap --write     also refresh the sitemap snapshot
 *
 * Check mode needs no network and no access to the private docs repo: it runs on the
 * committed file list (docs/docs-files.txt) and sitemap snapshot (docs/sitemap-urls.txt).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_SITE, mapDocPath, stripFragment, type UrlOverrides } from './mapping.js';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '../../docs');
const FILES = join(docsDir, 'docs-files.txt');
const PIN = join(docsDir, 'docs-pin.json');
const SITEMAP = join(docsDir, 'sitemap-urls.txt');
const OVERRIDES = join(docsDir, 'url-overrides.json');
const REPORT_FILES = join(docsDir, 'reports', 'files-without-urls.md');
const REPORT_URLS = join(docsDir, 'reports', 'urls-without-files.md');
const SITEMAP_URL = `${DOCS_SITE}/sitemap-0.xml`;

interface Pin {
  repo: string;
  commit: string;
  commit_date: string;
  sitemap_fetched_at: string;
}

const args = process.argv.slice(2);
const hasFlag = (name: string): boolean => args.includes(name);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

function fail(message: string): never {
  console.error(`validate-mapping: ${message}`);
  process.exit(1);
}

const write = hasFlag('--write');
const docsClone = option('--docs');
const fetchSitemap = hasFlag('--fetch-sitemap');
if ((docsClone !== undefined || fetchSitemap) && !write) {
  fail('--docs and --fetch-sitemap refresh committed inputs and therefore require --write');
}

const pin: Pin = existsSync(PIN)
  ? (JSON.parse(readFileSync(PIN, 'utf8')) as Pin)
  : { repo: 'nextbillion-ai/nb-public-docs', commit: '', commit_date: '', sitemap_fetched_at: '' };

if (docsClone !== undefined) {
  const git = (gitArgs: string[]): string =>
    execFileSync('git', gitArgs, { cwd: docsClone, encoding: 'utf8' }).trim();
  const files = git(['ls-files', '--', '*.md'])
    .split('\n')
    .filter((f) => f.length > 0)
    .sort();
  pin.commit = git(['rev-parse', 'HEAD']);
  pin.commit_date = git(['log', '-1', '--format=%cI']);
  writeFileSync(FILES, `${files.join('\n')}\n`);
  console.log(`docs-files.txt: ${files.length} pages at ${pin.commit.slice(0, 7)}`);
}

if (fetchSitemap) {
  const response = await fetch(SITEMAP_URL);
  if (!response.ok) fail(`sitemap fetch failed: HTTP ${response.status}`);
  const xml = await response.text();
  const paths = new Set<string>();
  for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    const path = match[1].replace(DOCS_SITE, '').replace(/^\/+|\/+$/g, '');
    if (path.length > 0 && !/\.(png|ico|svg|jpg)$/i.test(path)) paths.add(path);
  }
  if (paths.size < 100) fail(`sitemap looks wrong: only ${paths.size} URLs parsed`);
  pin.sitemap_fetched_at = new Date().toISOString().slice(0, 10);
  writeFileSync(SITEMAP, `${[...paths].sort().join('\n')}\n`);
  console.log(`sitemap-urls.txt: ${paths.size} live URLs`);
}

if (docsClone !== undefined || fetchSitemap) {
  writeFileSync(PIN, `${JSON.stringify(pin, null, 2)}\n`);
}

for (const required of [FILES, SITEMAP, OVERRIDES]) {
  if (!existsSync(required))
    fail(`missing ${required}; run with --docs <clone> --fetch-sitemap --write`);
}

const lines = (file: string): string[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);

const files = lines(FILES);
const sitemap = new Set(lines(SITEMAP));
const overrides = JSON.parse(readFileSync(OVERRIDES, 'utf8')) as UrlOverrides;

const errors: string[] = [];
const excluded: Array<{ file: string; reason: string }> = [];
const unmapped: Array<{ file: string; path: string; rule: string }> = [];
const filesByUrl = new Map<string, string[]>();
const fragmentsByUrl = new Map<string, number>();

for (const file of files) {
  const result = mapDocPath(file, overrides);
  if (result.kind === 'excluded') {
    excluded.push({ file, reason: result.reason });
    continue;
  }
  const path = stripFragment(result.path);
  if (!sitemap.has(path)) {
    unmapped.push({ file, path: result.path, rule: result.rule });
    continue;
  }
  const owners = filesByUrl.get(path) ?? [];
  owners.push(file);
  filesByUrl.set(path, owners);
  if (path !== result.path) fragmentsByUrl.set(path, (fragmentsByUrl.get(path) ?? 0) + 1);
}

for (const [path, owners] of filesByUrl) {
  const plain = owners.length - (fragmentsByUrl.get(path) ?? 0);
  if (plain > 1) {
    errors.push(`${owners.length} files map to ${path} without fragments: ${owners.join(', ')}`);
  }
}
const fileSet = new Set(files);
for (const key of Object.keys(overrides.pages)) {
  if (!fileSet.has(key)) errors.push(`stale page override: ${key} is not in docs-files.txt`);
}
for (const entry of unmapped) {
  errors.push(
    `${entry.file} -> ${entry.path} (${entry.rule}) is not a live URL; add a url or exclude in url-overrides.json`,
  );
}

const urlsWithoutFiles = [...sitemap].filter((path) => !filesByUrl.has(path)).sort();
const section = (path: string): string => path.split('/')[0];
const sectionsWithFiles = new Set([...filesByUrl.keys()].map(section));
const bySection = new Map<string, string[]>();
for (const path of urlsWithoutFiles) {
  const list = bySection.get(section(path)) ?? [];
  list.push(path);
  bySection.set(section(path), list);
}

const provenance = `Generated by \`npm run docs:validate -- --write\` from ${pin.repo} at ${pin.commit.slice(0, 7)} (${pin.commit_date.slice(0, 10)}) and the sitemap snapshot of ${pin.sitemap_fetched_at}. Do not edit by hand.`;

const filesReport = [
  '# Docs pages without a live URL',
  '',
  provenance,
  '',
  `Pages listed here are not indexed. A page must either map to a URL in the live sitemap or be excluded with a reason in \`url-overrides.json\`; validation fails otherwise.`,
  '',
  `| Pages in repo | Mapped to a live URL | Excluded | Unmapped |`,
  `| --- | --- | --- | --- |`,
  `| ${files.length} | ${files.length - excluded.length - unmapped.length} | ${excluded.length} | ${unmapped.length} |`,
  '',
  `## Excluded (${excluded.length})`,
  '',
  '| File | Reason |',
  '| --- | --- |',
  ...excluded.map((e) => `| ${e.file} | ${e.reason} |`),
  '',
  `## Unmapped (${unmapped.length})`,
  '',
  ...(unmapped.length === 0
    ? ['None.']
    : [
        '| File | Rule result |',
        '| --- | --- |',
        ...unmapped.map((u) => `| ${u.file} | ${u.path} |`),
      ]),
  '',
].join('\n');

const urlsReport = [
  '# Live URLs without a source page',
  '',
  provenance,
  '',
  'These pages exist on docs.nextbillion.ai but have no Markdown file in nb-public-docs, so the index cannot answer questions about them (spec §5, known coverage gap).',
  '',
  '| Section | Live URLs | With a source file | Without |',
  '| --- | --- | --- | --- |',
  ...[...new Set([...sitemap].map(section))].sort().map((s) => {
    const total = [...sitemap].filter((p) => section(p) === s).length;
    const missing = bySection.get(s)?.length ?? 0;
    return `| ${s} | ${total} | ${total - missing} | ${missing} |`;
  }),
  '',
  ...[...bySection.keys()].sort().flatMap((s) => {
    const list = bySection.get(s) ?? [];
    const note = sectionsWithFiles.has(s) ? '' : ' — no source files in the repo';
    return [`## ${s} (${list.length})${note}`, '', ...list.map((p) => `- ${p}`), ''];
  }),
].join('\n');

const summary = [
  `pages ${files.length}: mapped ${files.length - excluded.length - unmapped.length}, excluded ${excluded.length}, unmapped ${unmapped.length}`,
  `live URLs ${sitemap.size}: with source ${filesByUrl.size}, without ${urlsWithoutFiles.length}`,
];

if (write) {
  writeFileSync(REPORT_FILES, filesReport);
  writeFileSync(REPORT_URLS, urlsReport);
  console.log(`reports written to ${join(docsDir, 'reports')}`);
} else {
  const stale = [
    [REPORT_FILES, filesReport],
    [REPORT_URLS, urlsReport],
  ].filter(([file, content]) => !existsSync(file) || readFileSync(file, 'utf8') !== content);
  for (const [file] of stale) {
    errors.push(`${file} is out of date; run: npm run docs:validate -- --write`);
  }
}

console.log(summary.join('\n'));
if (errors.length > 0) {
  console.error(`\n${errors.length} problem(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('docs URL mapping is complete and matches the live sitemap snapshot.');
