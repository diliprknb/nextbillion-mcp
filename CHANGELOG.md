# Changelog

## 0.3.0 — 2026-10-08

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
