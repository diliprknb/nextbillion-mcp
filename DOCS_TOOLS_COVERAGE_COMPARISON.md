# Documentation / Knowledge-Base Tool Coverage: nextbillion-mcp vs nb-mcp-server

Scope: only the tools that answer documentation or knowledge-base questions. Geocoding, routing, tracking, maps and other API-calling tools are excluded. `nextbillion-mcp` is the official repo of the NextBillion MCP Server and `nb-mcp-server` is the cloud deployed Hybrid MCP server made by Dilip.

Source: tool definitions in each repo, plus 13 direct tool calls per server run with the `mcpjam` CLI on 2026-10-15.

## Tool coverage at a glance

| Tool | nextbillion-mcp | nb-mcp-server |
|---|---|---|
| `search_documentation` | Yes | Yes |
| `get_documentation` | Yes | Yes |
| `list_documentation_topics` | Yes | Yes |
| `get_api_parameters` | **Yes** | No |
| `reason_and_route` | No | **Yes** |

Both servers share 3 of the 5 tools. Each server has one tool the other lacks.

## Tools that exist in only one server

### `get_api_parameters` (nextbillion-mcp only)
- Returns a structured parameter table for a REST endpoint: type, required, default, allowed values and units.
- Inputs: `endpoint` (e.g. `directions`, `directions/flexible`), `doc_id`, or `name` (one parameter, e.g. `truck_weight`).
- Checked: `endpoint="directions"` returned 42 parameters across the flexible and fast variants.
- In nb-mcp-server this call fails with `Tool get_api_parameters not found`. An AI client would have to read parameters out of prose from `get_documentation`.

### `reason_and_route` (nb-mcp-server only)
- Classifies a query as `TOOL_EXECUTION`, `API_DOC_INQUIRY` or `API_SELECTION_ADVICE`.
- Returns a confidence score, a rationale, recommended tools and relevant doc snippets.
- Inputs: `query`, optional `context`.
- Checked: "How do I avoid tolls in the directions API?" was classified `TOOL_EXECUTION` (0.92), which is arguably the wrong class for a how-to question. The doc snippets it returned were relevant.
- In nextbillion-mcp this call fails with `Tool reason_and_route not found`. The nearest substitute is `related_tools` on each `search_documentation` result.

## Tools in both servers: where they differ

### `search_documentation`

| Parameter | nextbillion-mcp | nb-mcp-server |
|---|---|---|
| `query` | Yes | Yes |
| `category` | Yes (boosts ranking) | Yes (filter) |
| `sdk` | Yes (Android, iOS, Flutter, Web) | Yes (Android, iOS, Flutter) |
| `limit` | Yes (1-10, default 5) | Yes (default 5) |
| `api` | Yes (boost, e.g. Directions) | No |
| `include_examples` | Yes | No |

I did not verify whether `category` is a hard filter or a boost in nb-mcp-server; the table follows the wording in each tool's parameter description.

- **Result shape:** nextbillion-mcp returns chunk-level excerpts with `doc_id`, `source_url`, `related_tools` and the docs commit. nb-mcp-server returns page-level results with a `matchScore` and a short snippet.
- **Safety wrapper:** nextbillion-mcp wraps excerpts in `<documentation-excerpt>` tags and states they are quoted content, not instructions. nb-mcp-server puts an `answer_formatting_guidance` instruction in the tool result.

### `get_documentation`

| Parameter | nextbillion-mcp | nb-mcp-server |
|---|---|---|
| `doc_id` | Yes | Yes (also accepts a relative path) |
| `section` | Yes | No |
| `include_examples` | Yes (off by default) | No |

- nextbillion-mcp truncates pages over about 32,000 characters and returns a section list so a client can request one section.
- nb-mcp-server returns the whole page as a JSON object. In my run the Flutter example page came to 11 KB, against 4.6 KB of compact Markdown from nextbillion-mcp.
- Both return an error with a pointer to the search and list tools when the `doc_id` is unknown.

### `list_documentation_topics`

| Parameter | nextbillion-mcp | nb-mcp-server |
|---|---|---|
| `category` | Yes | Yes |
| `sdk` | **Yes** | **No** |

- With `sdk="Flutter"`, nextbillion-mcp returned 35 pages (11 KB).
- nb-mcp-server silently ignored `sdk` and returned the full index (88 KB), the same as an unfiltered call. It gave no error.
- An unfiltered call returns the whole index in both servers (111 KB for nextbillion-mcp, 88 KB for nb-mcp-server).

## Content coverage

The two servers search different copies of the docs.

| | nextbillion-mcp | nb-mcp-server |
|---|---|---|
| Source | Prebuilt index (`data/docs-index.json`) | Markdown files in `docs/public-docs` |
| Pages | 342 | 301 files, 300 excluding the README |
| Shared (same file path) | 294 | 294 |
| Only in this server | 48 | 6 (plus the README) |

- **Only in nextbillion-mcp:** 48 pages, including the Azuga, Dynamics 365 and Geotab integration docs.
- **Only in nb-mcp-server:** 6 pages, including the mobile and platform SDK compatibility page, the avoid-and-restrictions guide and the snap-to-road guide.
- Matching was on exact file path. I did not check whether any of these pages exist under a different path in the other server.

## Takeaways

1. The shared core is the same: search, fetch a page, list topics.
2. nextbillion-mcp is stronger on precision: structured parameters, `section=` fetches, size limits, an `sdk` filter on topic listing, and chunk-level excerpts with citations.
3. nb-mcp-server adds a query router that nextbillion-mcp has no equivalent for, and its docs set includes a few guides the other index lacks.
4. Neither server's tool list is a superset of the other's.

## Limits of this comparison

- Findings come from reading the tool definitions and 13 hand-written direct tool calls per server. No LLM was involved, so tool selection and answer quality were not tested.
- Search-quality differences in the test calls may partly reflect the content gap above rather than ranking quality alone.
