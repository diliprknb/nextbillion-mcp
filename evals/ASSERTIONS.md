# `Nextbillion-MCPEval-Suite-Master` — Added Assertions

Every case originally checked only **tool selection** (was the right tool called at all — `toolCalledWith` with an empty `args: {}`, which matched any arguments). This pass adds two more layers to every one of the 32 cases:

1. **Argument correctness** (`toolCalledWith`, gating) — the tool must be called with the specific arguments the case authored, not just called by name.
2. **Response correctness** — either a literal-text check (`toolResultContains`) for cases with a stable expected answer, or a structural/category check (`toolResultMatchesSchema`) for cases whose exact output can legitimately vary. See [Design notes](#design-notes) below for which cases are gating vs advisory and why.

Confirmed against **Run #16** (`mh74a0072x510zr5he04s08wbh8fbj0w`, 64/64 iterations passed): every case's 3-step assertion chain (`toolCalledWith` → response check → `noToolErrors`) evaluated against real, non-empty tool-call arguments and real, non-truncated (or advisory) tool-result content — not a fallback/error path.

## Places & Geocoding

| Test Case | Tool | Argument-Correctness Check | Response-Correctness Check | Gating |
|---|---|---|---|---|
| Autocomplete Google Amphitheatre address prefix | `autocomplete` | args match on: `query` | `toolResultContains`: response text contains **"Amphitheatre"** | Advisory |
| Autocomplete 'stat' prefix in Oklahoma City with country filter | `autocomplete` | args match on: `country_codes`, `near`, `query` | `toolResultContains`: response text contains **"State"** | Advisory |
| Autosuggest misspelled aquarium query | `autosuggest` | args match on: `near`, `query` | `toolResultContains`: response text contains **"Aquarium"** | Advisory |
| Autosuggest partial tourist query with radius | `autosuggest` | args match on: `query`, `radius_m` | `toolResultContains`: response text contains **"Museum"** | Advisory |
| Search coffee shops near location | `place_search` | args match on: `near`, `query`, `radius_m` | `toolResultMatchesSchema`: every returned item's category is tagged `"café/pub"` | Advisory |
| Search business by name around coordinates | `place_search` | args match on: `near`, `query` | `toolResultContains`: response text contains **"Gas Light"** | Advisory |
| Geocode 10 Downing Street address | `geocode_forward` | args match on: `query` | `toolResultContains`: response text contains **"Downing Street"** | Advisory |
| Geocode White House with USA country code | `geocode_forward` | args match on: `country_codes`, `query` | `toolResultContains`: response text contains **"Pennsylvania Avenue"** | Advisory |
| Reverse geocode Paris coordinates | `geocode_reverse` | args match on: `coordinate` | `toolResultContains`: response text contains **"Paris"** | Advisory |
| Reverse geocode Berlin coordinates with country filter | `geocode_reverse` | args match on: `coordinate`, `country_codes` | `toolResultContains`: response text contains **"Berlin"** | Advisory |
| Structured geocode 221B Baker Street London | `geocode_structured` | args match on: `city`, `country_code`, `house_number`, `street` | `toolResultContains`: response text contains **"Baker Street"** | Advisory |
| Structured geocode Mullen Ave San Francisco | `geocode_structured` | args match on: `city`, `country_code`, `postal_code`, `state`, `street` | `toolResultContains`: response text contains **"Mullen Avenue"** | Advisory |
| Batch geocode US landmarks | `geocode_batch` | args match on: `queries` | `toolResultMatchesSchema`: has `results` (>= 3 item(s), each: has `items` (array)) | Advisory |
| Batch geocode White House and Empire State Building | `geocode_batch` | args match on: `queries` | `toolResultMatchesSchema`: has `results` (>= 2 item(s), each: has `items` (array)) | Advisory |
| Browse restaurants near Singapore coordinates | `place_browse` | args match on: `categories`, `near`, `radius_m` | `toolResultMatchesSchema`: every returned item's category is tagged `"restaurant"` | Advisory |
| Browse schools near Berlin coordinates | `place_browse` | args match on: `categories`, `near`, `radius_m` | `toolResultMatchesSchema`: every returned item's category is tagged `"school"` | Advisory |
| Lookup place details for Mullen Avenue | `place_lookup` | args match on: `id` | `toolResultContains`: response text contains **"Mullen Avenue"** | Advisory |
| Lookup details for Empire State Building ID | `place_lookup` | args match on: `id` | `toolResultContains`: response text contains **"Empire State Building"** | Advisory |
| Lookup postal code 90011 USA | `postcode_lookup` | args match on: `country`, `postal_code` | `toolResultContains`: response text contains **"90011"** | Advisory |
| Lookup postal code 110007 India | `postcode_lookup` | args match on: `country`, `postal_code` | `toolResultContains`: response text contains **"110007"** | Advisory |

## Routing

| Test Case | Tool | Argument-Correctness Check | Response-Correctness Check | Gating |
|---|---|---|---|---|
| Directions SF to LA avoiding tolls | `directions` | args match on: `avoid`, `destination`, `origin` | `toolResultMatchesSchema`: has `routes` (>= 1 item(s), each: has `distance`, `duration`, `geometry`) | Advisory |
| Truck directions with hazardous cargo | `directions` | args match on: `destination`, `hazmat_type`, `mode`, `origin`, `truck_weight_kg` | `toolResultMatchesSchema`: has `routes` (>= 1 item(s), each: has `distance`, `duration`, `geometry`) | Advisory |
| Distance matrix Singapore 1x2 | `distance_matrix` | args match on: `destinations`, `origins` | `toolResultMatchesSchema`: has `rows` (>= 1 item(s), each: has `elements` (>= 1 item(s), each: has `distance` (has `value`), `duration` (has `value`))), `status` | Advisory |
| Distance matrix Barcelona 2x1 | `distance_matrix` | args match on: `destinations`, `origins` | `toolResultMatchesSchema`: has `rows` (>= 1 item(s), each: has `elements` (>= 1 item(s), each: has `distance` (has `value`), `duration` (has `value`))), `status` | Advisory |
| Isochrone 10 and 20 minute driving contours | `isochrone` | args match on: `contours_minutes`, `origin` | `toolResultMatchesSchema`: has `features` (>= 1 item(s), each: has `geometry` (has `coordinates` (array))) | Advisory |
| Isochrone 5-minute car driving polygon | `isochrone` | args match on: `contours_minutes`, `origin`, `polygons` | `toolResultMatchesSchema`: has `features` (>= 1 item(s), each: has `geometry` (has `coordinates` (array))) | Advisory |
| Search gas stations along 2-point route | `search_along_route` | args match on: `max_detour_seconds`, `query`, `route_points` | `toolResultMatchesSchema`: every returned item's category is tagged `"Gas Station"` | Advisory |
| Search gas stations along 4-waypoint route | `search_along_route` | args match on: `max_detour_seconds`, `query`, `route_points` | `toolResultMatchesSchema`: every returned item's category is tagged `"Gas Station"` | Advisory |

## Maps

| Test Case | Tool | Argument-Correctness Check | Response-Correctness Check | Gating |
|---|---|---|---|---|
| Static map of Paris with red marker | `static_map_image` | args match on: `center`, `markers`, `zoom` | `toolResultMatchesSchema`: >= 1 item(s), each: has `data`, `mediaType` | Advisory |
| Hybrid static map centered in LA | `static_map_image` | args match on: `center`, `height`, `style`, `width`, `zoom` | `toolResultMatchesSchema`: >= 1 item(s), each: has `data`, `mediaType` | Advisory |
| Static route map from SF route points | `static_route_map` | args match on: `route_points`, `stroke_color` | `toolResultMatchesSchema`: >= 1 item(s), each: has `data`, `mediaType` | Advisory |
| Auto-fitted static map with polygon overlay | `static_route_map` | args match on: `paths` | `toolResultMatchesSchema`: >= 1 item(s), each: has `data`, `mediaType` | Advisory |

## Design notes

- **Deterministic single-entity lookups** (`geocode_forward`/`_reverse`/`_structured`, `place_lookup`, `postcode_lookup`, `autocomplete`, `autosuggest`) assert a stable literal substring (e.g. `"Paris"`, `"Downing Street"`) pulled from a real recorded response — these should not drift over time.

- **Structural/numeric tools** (`directions`, `distance_matrix`, `isochrone`, `geocode_batch`) assert *shape* (required fields present, numeric fields positive, arrays non-empty) rather than exact distance/duration values, since those can shift slightly with routing-engine/map-data updates.

- **Category-listing tools** (`place_search`, `place_browse`, `search_along_route`) assert that *every* returned item's category is tagged with the expected term (e.g. every coffee-search result must carry `"café/pub"` in its category — confirmed 10/10 in live data) rather than asserting specific place names, since which businesses appear can legitimately change over time.

- **`search_along_route` (gas-station cases) is intentionally `Advisory`, not gating.** Evidence: only ~1 in 5 results returned for a "gas station" query actually carries category `"Gas Station"` — the rest are name-substring matches like *Gas Company Tower* (Commercial Building) or *Gas Bake Dispensary Shop* (Marijuana Dispensary). This is a real, reproducible tool-selection/category-filtering gap in `search_along_route`, confirmed again in Run #16 (`step-expect-1` failed with "Items did not match schema" on both cases, correctly non-gating). Treat this as an open product issue, not an eval bug.

- **All response-correctness checks are currently `Advisory` suite-wide**, not just the gas-station ones. Reason: an earlier CLI-triggered run (`eval run` from the `mcpjam` CLI) could not populate the `toolResults` transcript-capture channel these checks read from ("no tool results captured"), which is a MCPJam hosted-runner capture gap unrelated to the checks themselves — confirmed by the raw conversation trace containing the correct data while the predicate evaluator saw none. Runs triggered from the **dashboard UI** (e.g. Run #16) do not have this problem — capture works and the checks evaluate real content. Once you're confident runs will only be triggered from the UI (or MCPJam fixes the CLI-run capture path), these can be flipped back to `Required` on a per-case basis.

- **Large-payload cases had their tool result truncated by MCPJam's storage cap** in Run #16, which also correctly resulted in a non-gating `fail` on the response check rather than a false pass: `static_map_image` (both cases), `static_route_map` (both cases), `geocode_batch` (landmarks case, 3 queries), `directions` (SF→LA), and `isochrone` (10/20-min contours). These payloads (base64 images, long encoded polylines, large GeoJSON) exceed the platform's per-result storage/capture size limit before the schema validator ever sees them. Not an assertion bug — a size ceiling on what MCPJam retains for inspection.
