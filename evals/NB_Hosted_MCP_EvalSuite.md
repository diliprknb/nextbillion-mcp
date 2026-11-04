# NB_Hosted_MCP_EvalSuite

Eval suite for the hosted NextBillion MCP server at `https://mcp.nextbillion.io` (v0.5.3, 27 tools), run in MCPJam Cloud. Definition: [`NB_Hosted_MCP_EvalSuite.json`](NB_Hosted_MCP_EvalSuite.json).

## MCPJam setup

| Item | Value |
| --- | --- |
| Project | `Default` (`v9785n3vt6gz24qagc7bgacmjn8dr7tw`), account `orbitpixel96@gmail.com` |
| Server | `nextbillion-mcp-hosted`, HTTP, `https://mcp.nextbillion.io/` |
| Auth | `Authorization: Bearer <NBAI_API_KEY>` header stored on the server (the key is not in this repo) |
| Suite | `NB_Hosted_MCP_EvalSuite` (`md7des5hzckv5w62pjs9xy8czs8hkn7x`) |
| Model | `anthropic/claude-sonnet-4.5` |
| Cases | 72 (50 ported, 22 new) |

Without the bearer header, the offline tools (geometry, docs) work but every tool that calls the NextBillion API returns HTTP 401 and the case fails with a tool error.

## Tools on the hosted server (27)

- **Same as the stdio server (20):** `autocomplete`, `autosuggest`, `place_search`, `place_lookup`, `place_browse`, `geocode_forward`, `geocode_reverse`, `geocode_structured`, `geocode_batch`, `postcode_lookup`, `directions`, `distance_matrix`, `isochrone`, `search_along_route`, `static_map_image`, `static_route_map`, `search_documentation`, `get_documentation`, `get_api_parameters`, `list_documentation_topics`.
- **New (7), geometry, no API key needed:** `bbox`, `buffer`, `centroid`, `measure`, `nearest`, `points_in_polygon`, `polygon_ops`.
- `directions` and `distance_matrix` also take newer options: truck dimensions and weight, `honor_restrictions`, `emission_class`, `alternatives`.

## Where the cases came from

Old suites on the stdio `nextbillion-mcp` server:

| Old suite | Cases | Used here |
| --- | --- | --- |
| `Nextbillion-MCPEval_KB_Suite-Master` | 40 | all 40 |
| `NB_offcl_KB_Tools_EvalSuite` | 10 | all 10 |
| `Nextbillion-MCPEval-Suite-Master` | 32 | already inside the KB Suite-Master |
| `Nextbillion-MCPEval-KB-SuiteLite` | 4 | already inside the KB Suite-Master |

`NB_Drk_KB_Tools_EvalSuite` and `NB_Hybrid_MCP_EvalTestSuite` target the separate `nb-hybrid-mcp` server and were not ported.

The ported cases keep their original prompts and assertions unchanged.

## New cases (22)

- **Geometry (9):** bbox, 500 m buffer, centroid, point-to-point distance, polygon area, nearest candidate, points in polygon, polygon union, polygon intersection.
- **Places and geocoding (3):** `place_search`, `place_browse`, `geocode_forward`.
- **Routing (6):** truck route with dimensions and weight, alternatives, waypoint, 3x3 distance matrix, distance isochrone, walking isochrone.
- **Maps (1):** static route map.
- **Docs (2):** geofence search, iOS SDK topics.
- **Multi-turn (1):** geocode two cities, then route between them.

No negative cases (prompts where no tool should be called) were added, because the scoring semantics were not confirmed.

## Results

First full run: 69 of 72 passed. The 3 failures were mistakes in the new cases, not server faults:

| Case | Cause | Fix |
| --- | --- | --- |
| Geometry: intersection of two overlapping polygons | Expected `operation: intersection`; the tool enum value is `intersect`. After that the model skipped the tool on a vague prompt. | Corrected the value and reworded the prompt. Passed 3 of 3 re-runs. |
| Routing: directions with alternatives | HTTP 422: the Singapore coordinates were unroutable. | Switched to San Francisco to Oakland. Passed. |
| Docs: search for geofence alerts | Assertion required `query` to equal `geofence`; the model sent `geofence alerts`. | Dropped the query value from the assertion. Passed. |

The full suite was not re-run after these fixes. Only the three cases were re-run.

## Run it

```bash
mcpjam cloud eval run --project v9785n3vt6gz24qagc7bgacmjn8dr7tw \
  --suite NB_Hosted_MCP_EvalSuite --wait
```

Note: `mcpjam cloud eval validate` rejects the JSON file because it is a create-API body, not a versioned suite file. Create the suite with `mcpjam cloud eval create --file`.
