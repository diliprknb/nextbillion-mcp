# Documentation knowledge base: inputs and mapping

This directory holds the checked-in inputs for the documentation tools (`search_documentation`, `get_documentation`, `get_api_parameters`, `list_documentation_topics`). The source is the private repository `nextbillion-ai/nb-public-docs`; nothing here requires access to it at build or test time. Retrieval quality is checked by the unit tests on the committed index (spec acceptance tests) and by the manual host pass before a release.

| File                                   | What it is                                                                                         | Maintained by                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `docs-pin.json`                        | The docs commit the committed inputs were taken from, and the date of the sitemap snapshot         | `npm run docs:validate -- --docs … --write`        |
| `docs-files.txt`                       | Every Markdown page in the docs repo at the pinned commit                                          | same                                               |
| `sitemap-urls.txt`                     | Snapshot of the live sitemap (`https://docs.nextbillion.ai/sitemap-0.xml`), URL paths only         | `npm run docs:validate -- --fetch-sitemap --write` |
| `../src/docs/build/url-overrides.json` | Folder aliases and page overrides for the path-to-URL mapping (see below); bundled into the server | by hand                                            |
| `reports/files-without-urls.md`        | Pages that are not indexed, and why                                                                | `npm run docs:validate -- --write`                 |
| `reports/urls-without-files.md`        | Live pages with no source in the docs repo (known coverage gap)                                    | same                                               |
| `reports/missing-units-report.md`      | Numeric request parameters whose docs state no unit                                                | `npm run docs:build-index`                         |

## How a page gets its URL

The docs repo has no site configuration and no front matter, so `src/docs/build/mapping.ts` derives the published URL from the file path:

1. A page override in `url-overrides.json` wins (`{ "url": … }`, optionally with a `#fragment` when several files are sections of one live page; or `{ "exclude": "reason" }`).
2. Otherwise every path segment is slugified (lower case, non-alphanumerics become dashes).
3. An index page `Folder/folder.md` is published at the folder's URL.
4. The longest folder prefix with an entry in `folderAliases` is rewritten (SDK folders such as `Maps/Mobile SDKs/Android` become `maps/android-maps-sdk`; renamed APIs such as `Routing/Distance Matrix` become `routing/distance-matrix-api`).

The live sitemap is the source of truth. `npm run docs:validate` fails when a mapped URL is not in the snapshot, when a page is neither mapped nor explicitly excluded, when two pages share a URL without fragments, when an override points at a page that no longer exists, or when the committed reports are stale. Only pages that map to a live URL are indexed.

A page's `doc_id` is its slugified repo path without `.md`, independent of the URL (for example `routing/directions-api/examples/legal-routes-for-a-given-truck-weight`).

## Refreshing after a docs change (manual, by decision of 2026-10-07)

The hosted server does not depend on this file for freshness: it rebuilds the index in-process from the docs repository at start and whenever `main` moves (`src/docs/store.ts`, using the same `src/docs/builder.ts`). The steps below refresh the committed snapshot (the image's fallback); run them when the URL mapping or the pinned commit should move.

```bash
# 1. Update the local clone of the docs repo
git -C ../nb-public-docs pull --ff-only

# 2. Refresh the pinned file list and the sitemap snapshot, regenerate the reports
cd packages/server
npm run docs:validate -- --docs ../../../nb-public-docs --fetch-sitemap --write

# 3. Fix anything the validator reports (new or renamed pages need an alias or an override),
#    then confirm check mode passes and tests are green
npm run docs:validate
npm test

# 4. Rebuild the packed index
npm run docs:build-index -- --docs ../../../nb-public-docs
cd ../.. && npm run build && cd packages/server

# 5. Bump the patch version (scripts/check-dist-versions.mjs lists every manifest), then open a PR
```

Review the diff of the two reports in the PR: a new entry in `files-without-urls.md` means a page was excluded, and growth in `urls-without-files.md` means the site gained pages the repo does not have.

## The index

Also holds the request parameters extracted from the reference pages' tables (`src/docs/build/parameters.ts`): the `| Name | Required | Format and Usage | Description |` query-parameter layout, `| Field | Type | Description |` request bodies and the `| Parameter | Type / Location | Description |` guide layout. Response tables and SDK pages are skipped. The endpoint id is `<api-slug>[/<variant>]`, with the variant taken from the page slug and the non-generic headings above the table (`directions/flexible`, `distance-matrix/asynchronous-fast`, `geofence/create`). Units are taken only from the docs' wording ("in seconds", "unix timestamp"); `null` otherwise.

The index is not stored anywhere: the running server builds it in memory from the docs
repository when it starts and rebuilds it whenever the repository changes. The only copy in
this repository is a small sample for the tests, `../tests/fixtures/docs-index.json` (26 pages
listed in `../tests/fixtures/docs-fixture-pages.txt`). `npm run docs:build-index -- --docs <clone>`
regenerates that sample from the pinned commit; it builds the full index first, for the integrity
checks and the missing-units report, then writes only the listed pages. Deterministic for a given
commit. Plain chunks with page metadata, no prebuilt term index (ranking changes do not need a docs rebuild). The server resolves it at `../data/docs-index.json` relative to its bundle (the Docker image copies it next to `dist/`). `NBAI_DOCS_INDEX=<path>` overrides the location (tests and experiments only).
