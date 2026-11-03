# Changelog

## 0.5.3 — 2026-10-30

- `list_documentation_topics` now says "docs last updated YYYY-MM-DD" and returns the field
  `docs_updated_at` instead of `built_at`. The value is unchanged (the commit date of the
  documentation the index was built from); the old name led clients to describe it as an
  index build time and to doubt whether the docs were current. `/health` reports the same
  renamed field.
- The 7.5 MB documentation index snapshot is no longer committed or shipped in the image.
  The hosted server builds its index from the docs repository at start-up as before; if that
  is not possible, the four documentation tools now answer that the index is temporarily
  unavailable and give the public docs site (https://docs.nextbillion.ai, with an example
  page URL) to read instead, plus `docs_site_url` in the structured result, rather than
  serving a stale copy. Their descriptions mention this. Tests use a small committed fixture
  (`tests/fixtures/docs-index.json`, 26 pages) built by `npm run docs:build-index`.

## 0.5.2 — 2026-10-30

- Release pipeline only: CI now authenticates to Google Cloud through Workload Identity
  Federation (a short-lived token GitHub issues per run) instead of a stored service-account
  key, and a manual "GCP auth check" workflow verifies that path without deploying. The
  hosted server's secrets are now generated and managed by Terraform; existing sign-ins were
  invalidated once by the key rollover. No tool or behaviour changes.

## 0.5.1 — 2026-10-29

- `directions` and `distance_matrix` can route for a specific truck class on the designated
  freight network: new `prefer: "truck_route"` and `truck_type` (rigid_truck, semi_trailer,
  b_double, road_train, generic_truck) parameters, plus `require: "truck_route"` on `directions`
  to stay on freight network roads only (the API answers 422 when none is within 2 km of a stop).
  The API ignores `truck_type` and `require` without `prefer`, and all three outside flexible truck
  routing; the tools reject those combinations instead of silently routing a generic truck.

## 0.5.0 — 2026-10-27

### Geometry tools (local, no sign-in)

Seven new tools compute straight-line geometry inside the server, with no NextBillion.ai API
call and no sign-in: `measure` (geodesic distance, line length, polygon area and perimeter,
bearing), `points_in_polygon` (geofencing, holes respected), `polygon_ops` (union, intersect,
difference), `buffer` (geodesic circle / corridor / grown or shrunk polygon; a shrunk shape may
become a MultiPolygon), `nearest` (nearest candidates, or nearest position on a line), `bbox`
(antimeridian-aware) and `centroid` (area-weighted centroid plus a guaranteed-inside label point).
Inputs use the server's `{latitude, longitude}` points and GeoJSON Polygon/MultiPolygon (or an
isochrone Feature) so results chain between tools. Measures use geographiclib (exact WGS84);
polygon operations use polyclip-ts; the buffer is our own geodesic construction (no JSTS).
Shapes are simplified to `max_vertices` (default 500) with the tolerance reported. Limits:
5,000 vertices per shape, 20,000 vertices and 20 polygons per `polygon_ops` call, 1,000 points per call; shapes spanning the antimeridian are rejected
in this version. Bundle +~200 KB.

- Housekeeping after going hosted-only: README tool table lists `get_api_parameters`, a License
  section and the copyright line in LICENSE; comments, docs and ignore files no longer refer to
  the removed local mode; `--help` documents `NBAI_ALLOW_HTTP`; test fixtures use example hosts.

## 0.4.2 — 2026-10-27

**Hosted only.** The local (stdio) mode and everything that existed for it are removed; the
server is the hosted service at https://mcp.nextbillion.io and nothing else.

- Removed: the stdio transport and the `--http` flag (the binary is the HTTP server),
  `NBAI_API_KEY` as a server-wide key, `NBAI_IMAGE_DIR` and saving map images to disk, the
  bundled-server Claude Code plugin, the npx-based Codex plugin configuration, the Claude
  Desktop extension (`.mcpb`) and its build script, the plugin bundle sync, and the npm
  package publication (the package is now `private`; 0.3.2 remains the last npm release and
  is deprecated in favour of the hosted server).
- The Claude Code and Codex plugins now contain only the hosted server URL: installing them
  configures the connection and the browser sign-in; no code is downloaded.
- README and client snippets rewritten for the hosted server (Claude, Claude Code, Cursor,
  Codex, scripts with a bearer header).

## 0.4.1 — 2026-10-27

- **Hosted mode: liveness URL is `GET /health`.** Google's front end intercepts the exact
  path `/healthz` on `*.run.app` and custom domains and answers its own 404 before the
  request reaches the container; `/health` returns the same document (status, version,
  documentation index origin and commit). `/healthz` still works inside the container and
  remains the Cloud Run probe path. The release workflow checks `/health` on the service URL
  and only warns about the custom domain while DNS or the certificate is pending.

## 0.4.0 — 2026-10-27

Hosted mode: the same server runs at https://mcp.nextbillion.io with a browser sign-in, so
Claude, Claude Code, Cursor and Codex connect to a URL instead of launching a local process.
Stdio mode, tools and schemas are unchanged.

### Documentation follows the docs repository

- The hosted server rebuilds its documentation index in-process from `nextbillion-ai/nb-public-docs`:
  at start, and again whenever `main` moves (checked every `NBAI_DOCS_REFRESH_MINUTES`,
  default 10, with a conditional request that is free when nothing changed). A rebuild
  downloads the repository as a tarball (~1 MB), runs the same builder as
  `npm run docs:build-index` and swaps the new index in atomically; the previous one serves
  until then. Documentation changes therefore reach the hosted server within minutes and
  without a release. `NBAI_DOCS_GITHUB_TOKEN` (read access to the private repository) is
  required for this; without it, or when GitHub is unreachable at start, the copy built into
  the image is served and `/healthz` says so (`docs.origin`, `docs.commit_sha`,
  `docs.last_error`).
- The builder (`src/docs/builder.ts`, with the URL mapping and parameter extraction) is now
  part of the server bundle; `scripts/docs/build-index.ts` is a thin wrapper around it.

### Sign-in (OAuth authorization server)

- **Built-in OAuth 2.1 authorization server** at `/oauth/authorize`, `/oauth/token`,
  `/oauth/register` plus `/.well-known/oauth-authorization-server`. Sign-in is a page where the
  user pastes their NextBillion.ai API key once; the key is checked with an unbilled gateway
  request (`GET /h/geocode` without a query: 401 means an unknown key regardless of the
  customer's SKUs; a 403 naming IP/origin restrictions is reported as such) and sealed into
  the tokens. Hosts such as Claude, Claude Code, Cursor and Codex can now connect to the hosted
  server with a browser sign-in and no local configuration.
- **Stateless by design.** Authorization codes, access tokens (1 h), refresh tokens (30 d) and
  dynamically registered client ids are all encrypted payloads (AES-256-GCM, key from
  `NBAI_TOKEN_KEY`, comma-separated keys for rotation). The server stores nothing about any
  user; revoking access is resetting the key in the console. Without `NBAI_TOKEN_KEY` a random
  key is used and tokens die with the process (fine locally, warned at start-up).
- Client identification by Client ID Metadata Document (what Claude uses) with a 5-minute
  cache, and by stateless Dynamic Client Registration for other hosts. PKCE S256 required;
  loopback redirect URIs match on any port (Claude Code); redirects only ever go to registered
  URIs; RFC 9207 `iss` on the callback; refresh tokens rotate; failures are `invalid_grant`.
- Access tokens from this server and bare API keys are both accepted as bearer tokens.
- MCP SDK 2.0 → 2.3.1 (additive release; no behaviour change).

### Streamable HTTP server

- **`--http` mode (Streamable HTTP).** The same server can run hosted: `nextbillion-mcp --http`
  listens on `PORT` (default 8080) and serves the MCP endpoint at the root of `NBAI_PUBLIC_URL`
  (default `https://mcp.nextbillion.io`). Stateless by construction (one server instance per
  request, per the 2026-07-28 revision); nothing about a caller is kept between requests.
- **Per-request credentials.** Callers send `Authorization: Bearer <NextBillion.ai API key>`;
  the key is used for that request's API calls only. `NBAI_API_KEY` and `NBAI_IMAGE_DIR` are
  ignored in this mode (a hosted server bills nobody's key by default and writes nothing to
  disk).
- **Lazy authentication.** Anonymous hosts can connect, list tools and use the four
  documentation tools. A call to an API tool without credentials is answered with HTTP 401 and
  a `WWW-Authenticate: Bearer resource_metadata=…` challenge, which is what makes Claude open
  its sign-in flow. `/.well-known/oauth-protected-resource` is served; the authorization
  server behind it (paste-your-API-key sign-in) lands in the next change.
- `GET /healthz` liveness route; `Dockerfile` (node:22-alpine, bundled server + docs index,
  non-root); CI builds the image and checks `/healthz`, and a tag-triggered job publishes it
  to the company registry with `nip`.
- No changes to stdio mode, tools or schemas.

## 0.3.2 — 2026-10-22

Documentation tools: six fixes found while reproducing the knowledge-base evaluation runs
of 15 October, plus a refresh of the bundled documentation. No new tools, no schema changes.

- **Documentation refreshed to nb-public-docs 713d1e5 (2026-10-22).** 25 new pages: Android
  Offline Maps (14) and Android Offline Navigation (11), mapped to their live URLs (five
  files were renamed in the repo after publishing; the overrides keep the live slugs).
  Updated pages: Directions API gains the `require=truck_route` parameter and the freight
  network wording for `prefer`; Distance Matrix and Navigation API `prefer` wording; Route
  Optimization gains `coordinate_jobs` (multi-technician jobs, 21 fields) and
  `options.coordination` (3); Hours of Service fixes the type of
  `driver_current_hos_state.daily_cycle_duty_times` (array of integer). 342 → 367 pages,
  1,435 → 1,460 parameters, index 7.3 → 7.5 MB.
- **`get_api_parameters` resolves more endpoint spellings.** Hosts build the slug from
  whatever they have seen, so `geocode/batch`, `geocode_batch` (the tool name),
  `Batch Geocode API` and the page's doc_id now all resolve to `batch-geocode`; the result
  says what the input was matched by. The evaluation's one failing case was this miss.
- **Array-element request-body fields are extracted.** Field names such as `[].q`,
  `[].limit` (JSON-array request bodies; Batch Geocode has six) were dropped by the
  extractor's name pattern, so the endpoint returned only `key`. 1,429 → 1,435 parameters.
- **No near-empty search chunks.** 451 of the 4,537 index chunks were a bare heading such
  as `## Request Body` (the heading was flushed alone when the next block was a large
  table or code sample) and 982 were under 100 characters; they ranked well and came back
  as results with an empty excerpt. Tiny chunks are now merged into their neighbour at
  build time (`mergeTinyChunks`): 3,568 chunks, none under 100 characters, pages still
  rejoin losslessly.
- **One search result per page section.** Several chunks of the same section no longer
  repeat the same title, heading and source_url; the best-scoring chunk represents the
  section.
- **sdk filter fallback.** When the `sdk` filter hides the page the query is really about
  (the best unfiltered hit scores at least 1.5× the best filtered one), the result names
  that page in `best_unfiltered` and in the text instead of filling the list with sdk
  pages that share only incidental words.
- **`get_documentation` returns pages up to 15% over the 32,000-character cap whole.** The
  Directions API page (33.5k) was cut by 4.6% and hosts fetched it twice. When a page is
  truncated, the section list now comes before the content.
- **Lookup misses are results, not tool errors.** An unknown endpoint, parameter name,
  doc_id or section returns `isError: false` with `found: false` and suggestions (similar
  endpoints or doc_ids, the parameter names under the scope, or the page's sections).
  Evaluation harnesses and the directory review count any tool error as a failure, even
  when the message lets the model recover. Malformed input (neither endpoint nor doc_id)
  is still an input error.
- Nine new unit tests, including the three evaluation cases as retrieval checks.

## 0.3.1 — 2026-10-11

Preparation of the Claude Desktop extension for Anthropic's directory review (replaces the
0.2.2 submission). No new features, no tool or schema changes.

- **Tool descriptions and the server `instructions` string** reworded to describe what each
  tool does and when it applies, instead of directing how the model should behave (the
  directory's pre-submission checklist rejects behaviour-directing wording). Changed:
  `search_documentation`, `get_documentation`, `get_api_parameters`,
  `list_documentation_topics`, `geocode_batch`, `directions`, `distance_matrix`,
  `isochrone`, `place_search`, `static_route_map`; a duplicated word in `directions` and a
  duplicated "Example" label in `static_route_map` fixed. Two new tests: one names the four
  documentation tools in the title/annotation guard, one rejects behaviour-directing
  phrasing in any description or in the instructions.
- **README Privacy Policy**: states that the four documentation tools run fully offline and
  send nothing anywhere.
- **Extension manifest**: `author.url` is now https://github.com/nextbillion-ai.
- 0.3.0 release date corrected to 7 October; the extension README's tool count updated.

## 0.3.0 — 2026-10-07

Documentation knowledge base: the server can now answer questions about the APIs from the
official documentation, offline, with citations. 16 → 20 tools.

- **Three documentation tools**: `search_documentation` (ranked excerpts with `source_url`
  and `related_tools`), `get_documentation` (one page or section, code samples on
  request) and `list_documentation_topics`. They read a bundled index of 342 pages from
  docs.nextbillion.ai (`packages/server/data/docs-index.json`, about 1 MB compressed) and
  never use the network. The server now sends initialisation `instructions` telling hosts
  to use `search_documentation` for how-to questions. Every API tool declares the pages
  that document it, which feeds `related_tools`. Retrieval is BM25 with the docs' own
  vocabulary, boosts for titles, headings and exact parameter names, and synonyms for
  everyday phrasing.
- **`get_api_parameters`**: structured request parameters (type, required, default, allowed
  values, units, description) for a REST endpoint, parsed from the reference pages' tables,
  with every API variant (`directions/flexible`, `directions/fast`, `geofence/create`, …).
  Units are only reported when the docs state them; `packages/server/docs/reports/missing-units-report.md`
  lists numeric parameters without one for the docs team.
- The `directions`, `distance_matrix`, `isochrone` and `place_search` descriptions point
  how-to questions to `search_documentation`.
- Refreshing the docs is a manual procedure documented in `packages/server/docs/README.md`.

- `packages/server/docs/` holds the checked-in inputs for the upcoming documentation
  tools: the mapping of docs-repo pages to live URLs (rules plus `url-overrides.json`),
  a pinned page list and sitemap snapshot, and two coverage reports. `npm run docs:validate`
  keeps them consistent and runs in CI without access to the private docs repository. The refresh procedure is manual by decision (see
  `packages/server/docs/README.md`).

## 0.2.2 — 2026-09-29

- Claude Desktop extension listing text revised for the directory submission (description
  and long description). API key instructions in the README, the manual setup guide and the
  extension's key prompt now also offer support@nextbillion.ai as a way to get a key.
  No server changes.

## 0.2.1 — 2026-09-23

Preparation for the Claude Desktop extension directory (Anthropic's review checks that
read-only tools have no side effects).

- **Rendered map images are no longer saved to disk by default.** Previously every
  `static_map_image` / `static_route_map` call also wrote the image to
  `<OS temp dir>/nextbillion-mcp/`. Now the server writes nothing unless you opt in.
  Desktop hosts (Claude Desktop, Claude Code, Cursor) display the inline image and lose
  nothing. **To re-enable saving**, set `NBAI_IMAGE_DIR` in the server's environment to
  an absolute directory, or to `tmp` for the OS temp directory (portable across
  platforms); the result caption then reports the file path as before. The Codex plugin
  and the Codex snippet in `distributions/manual/README.md` set `NBAI_IMAGE_DIR=tmp`
  because that client cannot display images. Relative paths are rejected with a startup
  warning, and an existing file is never overwritten. Both map tool descriptions state the
  optional save.
- README gains a full **Privacy Policy** section (data sent to the API, no telemetry, API
  key handling, no local storage unless `NBAI_IMAGE_DIR` is set, policy link) as required
  for the Claude Desktop extension directory submission.
- Claude Desktop extension: `npm run build:mcpb` packs the server into
  `nextbillion-mcp-<version>.mcpb` (manifest in `distributions/claude-desktop/`, built in CI,
  attached to the GitHub release). The extension bundles the server, asks for the API key at
  install, and never writes to disk.
- Tests guard that every tool exposes a Title Case `title` and the full read-only
  annotation set over `tools/list`; one `distance_matrix` sentence that directed model
  behaviour was reworded (#5).

## 0.2.0 — 2026-09-08

Closes the capability gaps found in the external MCP-server evaluation and Arnav's audit.

- **Static maps: line and polygon overlays, custom marker icons.** Both static_map_image and
  static_route_map accept `paths` (vertices as `{latitude, longitude}` objects or raw GeoJSON
  `[longitude, latitude]` pairs, with stroke/width and an optional fill color for polygons)
  and markers with `icon_url`/`anchor`/`scale`. static_route_map no longer requires a route —
  pass isochrone contour rings as `paths` to render reachable areas as filled polygons. All
  geometry is sent as encoded polylines and simplified automatically to fit the URL limit.
  A filled path whose ring is not explicitly closed is closed automatically (the API strokes
  only the edges between the given vertices, so an open ring rendered without its last edge).
- **directions / distance_matrix:** strict `exclude` filter, `road_info` (max_speed,
  toll_distance, toll_cost, toll_info, truck_route, stop_sign, traffic_light — directions),
  truck `hazmat_type`, `truck_axle_load`, `emission_class`, `cross_border`; distance_matrix
  `route_failed_prompt`.
- **isochrone:** `contours_colors`, `generalize`. **search_along_route:** `view`.
- **New tool `place_browse`:** list places by category around a location (Browse API).
- Descriptions of all changed tools updated to the standard; live e2e regression for
  isochrone-to-polygon rendering.

## 0.1.11 — 2026-09-08

- All 15 tool descriptions rewritten to one standard: what the tool does, when to use it
  (and which sibling tool to use instead), its parameters including nested objects, and one
  example call. A unit test enforces the standard. Motivation: the description is the primary
  guidance a model reads; a nested per-query field that the description never mentioned was
  misplaced by a model in production use.

## 0.1.10 — 2026-09-07

- All tool input schemas are now strict: an unknown or misplaced argument returns a clear
  validation error naming the key instead of being silently ignored. Previously a model that
  put `types` at the top level of geocode_batch (it belongs inside each query) got results
  that quietly ignored the filter.
- geocode_batch accepts a top-level `types` as the default for all queries (per-query `types`
  still overrides), and its description points out the per-query field.

## 0.1.9 — 2026-09-04

- Fix: the Claude Code plugin's bundled server file was excluded from git by the
  repository-wide `dist/` ignore rule, so plugins installed from GitHub had no server to
  run (0.1.8 only). The file is now committed and CI fails if it is missing or untracked.

## 0.1.8 — 2026-09-04

- Root-caused slow/failed first starts: after downloading the package, npx runs npm's
  security-audit request (`POST /-/npm/v1/security/advisories/bulk`), which on some
  networks hangs for minutes while every package download completes in under a second.
  MCP hosts give up after their ~30 s startup timeout.
- Claude Code plugin now launches its bundled copy of the server directly
  (`node ${CLAUDE_PLUGIN_ROOT}/dist/index.mjs`): no npx, no network, no install at startup.
- All npx-based configuration snippets and the Codex plugin now set
  `npm_config_audit=false`, `npm_config_fund=false`, `npm_config_update_notifier=false`
  in the server's environment. Measured cold start: 301 s → 1 s on an affected network.
- Version is injected at build time so the bundle is fully standalone.

## 0.1.7 — 2026-09-04

- Ship the server as a single self-contained file with zero runtime dependencies (bundled
  with esbuild). Previously `npx nextbillion-mcp` had to resolve and install the MCP SDK
  and zod on first run, which took minutes on some machines and exceeded MCP hosts'
  startup timeouts (Codex CLI: 30 s "connection closed"/"timed out"; Claude Code:
  30000 ms). First start is now a single small tarball download.

## 0.1.6 — 2026-09-04

- Rendered maps (static_map_image, static_route_map) are now also saved to a local file
  and the path is reported in the result text. Terminal-based MCP clients such as the
  Codex CLI cannot display inline image content, leaving users no way to see the map;
  the saved file closes that gap while inline images keep working in desktop clients.
  Location: `NBAI_IMAGE_DIR`, default `<system temp>/nextbillion-mcp/`.

## 0.1.5 — 2026-09-04

- Fix: `static_route_map` failed for long routes because the full-resolution polyline
  exceeded the Static Images API's 8192-byte GET URL limit (a 600 km route encodes to
  ~30k characters). The tool now simplifies the display geometry automatically until the
  URL fits, and says so in the caption; distances/durations come from the directions tool
  and are unaffected.

## 0.1.4 — 2026-09-04

- Tool results now mirror the complete API response as JSON inside the text block,
  after the human-readable summary. Hosts that surface only text content to the model
  (e.g. Claude Desktop) previously could not see fields beyond the summary — such as
  `access` points in geocoding results — even though they were present in
  `structuredContent`. Applies uniformly to all tools.

## 0.1.3 — 2026-09-02

- Add the `types` result filter (houseNumber/addressBlock/street/intersection/place/area)
  to geocode_forward, geocode_batch (per query), and geocode_structured — tracking the
  August API update.
- Add `honor_restrictions` to directions and distance_matrix (restricted-area handling,
  flexible service).

## 0.1.2 — 2026-08-31

- Fix: `static_route_map` markers rendered in the wrong hemisphere with a world-level
  auto-zoom. Root cause (verified against the live API): the Static Images auto-fit
  endpoint parses `markers` latitude-first, the opposite of the documented order that
  the center-based endpoint honors. Markers are now serialized per endpoint variant.
- Add unit + live-API regression tests for the per-endpoint marker order.

## 0.1.1 — 2026-08-05

- License the project under Apache-2.0 (was an UNLICENSED placeholder).
- No functional changes.

## 0.1.0 — 2026-08-05

- Initial release: stdio MCP server implementing the MCP 2026-07-28 specification
  (legacy-era clients served via SDK negotiation).
- 15 read-only tools: forward/reverse/batch/structured geocoding, postcode lookup,
  place search/lookup, autosuggest, autocomplete, directions, distance matrix,
  isochrone, search along route, static map image, static route map.
- Claude Code plugin marketplace served from this repository.
