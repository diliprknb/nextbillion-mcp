# nextbillion-mcp

The [NextBillion.ai](https://nextbillion.ai) MCP server: geocoding, place search, routing,
distance matrices, isochrones, static maps and the product documentation as tools for AI
agents. It runs as a **hosted service at https://mcp.nextbillion.io** — add the URL to your
MCP client and sign in with your NextBillion.ai API key in the browser. Nothing is installed
locally.

Implements the [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28)
(stateless core, Streamable HTTP, OAuth 2.1) via the official TypeScript SDK v2; older-protocol
clients are served through the SDK's built-in legacy negotiation.

## Quick start

Get an API key from [console.nextbillion.ai](https://console.nextbillion.ai) or by emailing
support@nextbillion.ai, then connect your client:

| Client                             | How                                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude (claude.ai, Claude Desktop) | Settings → Connectors → _Add custom connector_ → `https://mcp.nextbillion.io`                                                                                                                                                                     |
| Claude Code                        | `claude mcp add --transport http nextbillion https://mcp.nextbillion.io`, then `/mcp` → Authenticate — or install the plugin: `claude plugin marketplace add nextbillion-ai/nextbillion-mcp && claude plugin install nextbillion-mcp@nextbillion` |
| Codex                              | `codex mcp add nextbillion --url https://mcp.nextbillion.io`                                                                                                                                                                                      |
| Cursor                             | add `{ "url": "https://mcp.nextbillion.io" }` under `mcpServers.nextbillion` in `mcp.json`                                                                                                                                                        |
| Scripts / CI                       | send the key directly: `--header "Authorization: Bearer $NBAI_API_KEY"`                                                                                                                                                                           |

The browser sign-in page asks for your API key once. Without signing in you can already list
the tools and use the four documentation tools; the first API tool call triggers the sign-in.
Full snippets: [`distributions/manual/README.md`](distributions/manual/README.md).

## Tools

| Tool                        | NextBillion API                                            |
| --------------------------- | ---------------------------------------------------------- |
| `autocomplete`              | Autocomplete (prefix address completion)                   |
| `autosuggest`               | Autosuggest (typo-tolerant suggestions)                    |
| `directions`                | Directions (fast + flexible)                               |
| `distance_matrix`           | Distance Matrix (fast + flexible, synchronous)             |
| `geocode_batch`             | Batch Geocode (up to 100 queries per call)                 |
| `geocode_forward`           | Forward Geocode                                            |
| `geocode_reverse`           | Reverse Geocode                                            |
| `geocode_structured`        | Structured Geocode                                         |
| `isochrone`                 | Isochrone                                                  |
| `place_browse`              | Browse (places by category near a location)                |
| `place_lookup`              | Place Lookup                                               |
| `place_search`              | Discover (POI search)                                      |
| `postcode_lookup`           | Geocode Postcode                                           |
| `search_along_route`        | Search Along Route                                         |
| `static_map_image`          | Static Images                                              |
| `static_route_map`          | Static Images (route/path overlay)                         |
| `search_documentation`      | Documentation search (index of docs.nextbillion.ai)        |
| `get_documentation`         | Documentation page by `doc_id`                             |
| `get_api_parameters`        | Request parameters of a REST endpoint, as records          |
| `list_documentation_topics` | Documentation categories, APIs and pages                   |
| `measure`                   | Straight-line distance, line length, area, bearing (local) |
| `points_in_polygon`         | Geofencing: which points fall inside a polygon (local)     |
| `polygon_ops`               | Union, intersection, difference of polygons (local)        |
| `buffer`                    | Zone within a distance of a point, line or polygon (local) |
| `nearest`                   | Nearest candidates, or nearest position on a line (local)  |
| `bbox`                      | Bounding box of points, a line or a polygon (local)        |
| `centroid`                  | Centroid and guaranteed-inside label point (local)         |

Tool inputs always use explicit `{latitude, longitude}` objects; the server handles the
underlying API's coordinate-order conventions internally.

### Geometry tools (local, no sign-in)

Seven tools compute straight-line geometry on the WGS84 ellipsoid inside the server, without
calling the NextBillion.ai API: `measure` (distance, length, area, bearing), `points_in_polygon`
(geofencing), `polygon_ops` (union / intersect / difference), `buffer`, `nearest`, `bbox` and
`centroid`. They take the same `{latitude, longitude}` points as the other tools and GeoJSON
Polygon/MultiPolygon geometry, so an `isochrone` contour can be passed straight into
`points_in_polygon` or `polygon_ops`. Results that return a shape are simplified to a vertex
budget (`max_vertices`, default 500) to keep them small in the model's context. Their descriptions
say so explicitly: straight-line, not road distance — `directions` and `distance_matrix` remain the
tools for travel questions.

### Documentation tools

Four tools answer questions about the APIs and SDKs from the official documentation: `search_documentation` returns ranked excerpts with a `source_url` to cite and the name of the tool that performs the operation, `get_documentation` returns one page or one section, `get_api_parameters` returns the request parameters of a REST endpoint as structured records (units only when the docs state them), and `list_documentation_topics` lists what is covered. The hosted server builds its index from the documentation repository at start and rebuilds it whenever the repository's `main` branch changes, so documentation updates reach it within minutes; the image carries a fallback snapshot built at release time (see `packages/server/docs/README.md`). Pages that exist on the site but not in the docs repository (solutions, apps, help, the Web Maps SDK v1) are not covered.

## How the hosted server works

- **The MCP endpoint is the root** of `https://mcp.nextbillion.io` (also the OAuth `resource`).
  `GET /health` answers liveness and reports the documentation index in use;
  `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` serve
  OAuth discovery.
- **Credentials travel with each request.** There is no server-wide key: every API call uses
  the key of the caller, sealed into the OAuth tokens or sent as a bearer header.
- **Lazy authentication.** Without credentials a host can connect, list tools and use the
  documentation tools; the first API tool call is answered with HTTP 401 and a
  `WWW-Authenticate: Bearer resource_metadata=…` challenge, which makes the host open sign-in.
- **Sign-in.** The server is its own OAuth 2.1 authorization server (`/oauth/*`). The sign-in
  page asks for the API key once, checks it with the API (an unbilled request) and seals it
  into the tokens it issues (AES-256-GCM, key in `NBAI_TOKEN_KEY`). Nothing is stored
  server-side; revoke by resetting the key in the console. Claude identifies itself with its
  Client ID Metadata Document; other hosts use dynamic registration. PKCE is required.
- **Documentation follows the docs repository.** The server rebuilds its documentation index
  from `nb-public-docs` at start and whenever `main` moves (checked every 10 minutes), so
  documentation updates reach users within minutes and without a release.
- **Stateless.** One server instance per request, built from that request's credentials.
  Nothing about a caller is retained between requests.
- **Fixed egress address** `136.85.116.23` for calls to the NextBillion.ai API; allow it if
  your key has an IP allowlist.
- Running it yourself: `docker build -t nextbillion-mcp .` then
  `docker run -p 8080:8080 -e NBAI_PUBLIC_URL=https://your.host -e NBAI_TOKEN_KEY=… -e NBAI_DOCS_GITHUB_TOKEN=… nextbillion-mcp`.
  `node packages/server/dist/index.js --help` lists every environment variable. Infrastructure
  (Cloud Run, static egress, secrets, domain) is Terraform-managed in `nextbillion-infra`.

## Privacy Policy

`nextbillion-mcp` is a hosted MCP server operated by NextBillion.ai at https://mcp.nextbillion.io.
NextBillion.ai's privacy policy applies: https://nextbillion.ai/privacy.

**What is collected and sent.** When your AI client calls one of the API tools, the server
forwards that tool call's arguments (for example addresses, place names, coordinates, route
and map parameters) to `api.nextbillion.io` over HTTPS, authenticated with your API key, and
returns the API's response to your client unchanged. The server does not receive or
transmit anything else: no conversation content beyond the tool arguments, no files, no
device information.

**Your API key.** At sign-in your API key is sent to the server once, checked against the
NextBillion.ai API, and returned to your MCP host sealed inside encrypted tokens. On every
tool call the server decrypts the token in memory and uses the key for that request only. The
server keeps no database and stores no keys or tokens. Revoke access at any time by resetting
the key in the console; existing tokens stop working immediately.

**Documentation tools.** The four documentation tools (`search_documentation`,
`get_documentation`, `get_api_parameters` and `list_documentation_topics`) answer from an
index the server builds from NextBillion.ai's own documentation repository. They need no
sign-in and send nothing to the NextBillion.ai API.

**Logs and telemetry.** The server logs method, path, status and duration of each request —
never headers, bodies, keys or tokens. There is no analytics or crash reporting. Calls to the
API come from the server's fixed address `136.85.116.23` rather than from your machine.

**Third-party sharing and retention.** The server shares data with no one other than
NextBillion.ai. How NextBillion.ai uses and retains API request data is described in its
privacy policy at https://nextbillion.ai/privacy.

**Contact.** Privacy or support questions: support@nextbillion.ai.

## Repository layout

- `packages/server/` — the server (not published to npm since 0.4; it ships as a container).
  - `src/core/` — server assembly (spec compliance, error mapping)
  - `src/tools/` — one file per tool, grouped by product (places / routing / maps / docs)
  - `src/nbclient/` — shared NextBillion HTTP client (auth, timeout, retry, key redaction)
  - `src/http/` — Streamable HTTP app, bearer verification, the OAuth authorization server
  - `src/docs/` — documentation index: builder (from the docs repository), BM25 search, GitHub reader
  - `tests/fixtures/docs-index.json` — small committed sample of the index (the pages the
    tests depend on); the hosted server builds the full index in-process at start-up.
- `distributions/` — client setup: the Claude Code and Codex plugins (URL only, no code) and
  snippets for Cursor and manual configuration.
- `Dockerfile`, `.github/workflows/ci.yml` — image build; release tags push the image and
  deploy it to Cloud Run.

## Development

```bash
npm install
npm run typecheck
npm test          # unit + protocol conformance (no network, no key needed)
npm run build     # bundles the server into a single zero-dependency dist/index.js
NBAI_API_KEY=<key> npm run test:e2e   # live-API smoke tests
npm run build && NBAI_TOKEN_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))") \
  NBAI_PUBLIC_URL=http://localhost:8080 node packages/server/dist/index.js   # run it locally
```

Test a local build interactively with the MCP Inspector: start the server as above, then
`npx @modelcontextprotocol/inspector` and connect to `http://localhost:8080` (transport
Streamable HTTP; use the browser sign-in, or set the header `Authorization: Bearer <key>`).

## License

Copyright 2026 NextBillion.ai. Licensed under the [Apache License, Version 2.0](LICENSE).
