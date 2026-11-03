/**
 * Descriptions and server instructions for the documentation tools. Each description
 * follows the standard enforced by tests/unit/tools-mapping.test.ts: a `Parameters:`
 * section, one example call, under 1,200 characters, and no behaviour-directing phrasing
 * (Anthropic's directory review rejects descriptions that tell the model how to behave or
 * interfere with calling other tools; the text states what each tool does and when it
 * applies).
 */

export const SERVER_INSTRUCTIONS =
  'This server provides three kinds of tools. The four documentation tools ' +
  '(search_documentation, get_documentation, get_api_parameters, list_documentation_topics) ' +
  'answer questions about how NextBillion.ai APIs and SDKs work from the official documentation ' +
  'and need no sign-in; their results include a source_url for citation. The seven geometry tools ' +
  '(measure, points_in_polygon, polygon_ops, buffer, nearest, bbox, centroid) compute straight-line ' +
  'geodesic geometry locally, also without sign-in; they are not road distances or travel times. ' +
  'The other tools call the NextBillion.ai API with your key and return live results such as ' +
  'geocodes, places, routes, travel-time matrices, isochrones and map images.';

export const SEARCH_DOCUMENTATION_DESCRIPTION =
  "Search NextBillion's official API and SDK documentation. Use for any question about how " +
  'NextBillion works: calling an API, what a parameter means, which API to use, or SDK setup. ' +
  'Answers come from an index of the official documentation, not from live API calls; when ' +
  'the index is temporarily unavailable the result says so and names the public docs site.\n' +
  "Queries match best with the docs' own terms and exact parameter names (truck_weight, " +
  'option=flexible) rather than everyday phrasing; when results are thin, other API terms ' +
  'may match. Results are excerpts: get_documentation returns a full page. Each result ' +
  'carries a source_url for citation and related_tools, the name of the tool that performs ' +
  'the operation.\n' +
  'Parameters:\n' +
  '- query (string, required): search terms.\n' +
  '- category (string, optional): e.g. Routing, Places.\n' +
  '- api (string, optional): e.g. Directions.\n' +
  '- sdk (string, optional): Android, iOS or Flutter.\n' +
  '- limit (integer, optional): default 5, max 10.\n' +
  '- include_examples (boolean, optional): default false.\n' +
  'Example: {"query": "truck_size truck_weight routing", "api": "Directions"}';

export const GET_DOCUMENTATION_DESCRIPTION =
  'Fetch the full text of one documentation page by its doc_id, as returned by ' +
  'search_documentation. Use when an excerpt is not enough to answer accurately. Pages over ' +
  'the size limit return truncated: true and a section list; a single section can be ' +
  'requested with section. Sample request and response bodies are omitted unless ' +
  'include_examples is true. An unknown doc_id or section returns found: false with ' +
  'similar ids or the section list. When the index is temporarily unavailable the result ' +
  'says so and names the public docs site.\n' +
  'Parameters:\n' +
  '- doc_id (string, required): page id from search results.\n' +
  '- section (string, optional): heading of one section to return.\n' +
  '- include_examples (boolean, optional): default false.\n' +
  'Example: {"doc_id": "routing/directions-api/examples/legal-routes-for-a-given-truck-weight"}';

export const GET_API_PARAMETERS_DESCRIPTION =
  'Get structured parameter details for a NextBillion REST API endpoint: type, required, ' +
  'default, allowed values, units and description. More precise than a prose search for ' +
  'questions about one specific parameter. Returns every matching API variant (e.g. ' +
  'directions/flexible and directions/fast), identified by heading_path. Empty units means ' +
  'the documentation does not state a unit. SDK methods are not covered. When the index is ' +
  'temporarily unavailable the result says so and names the public docs site.\n' +
  'Parameters:\n' +
  '- endpoint (string, required unless doc_id given): API slug, optionally with variant, ' +
  'e.g. directions or directions/flexible; a tool name such as geocode_batch or a doc_id ' +
  'also resolves. An unknown endpoint returns found: false with similar endpoints.\n' +
  '- doc_id (string, optional): page id instead of endpoint.\n' +
  '- name (string, optional): one parameter name.\n' +
  'Example: {"endpoint": "directions", "name": "truck_weight"}';

export const LIST_DOCUMENTATION_TOPICS_DESCRIPTION =
  'List the available documentation categories, APIs and pages, with index metadata. Useful ' +
  'before searching, when the right terms are not yet known, e.g. to see which APIs exist ' +
  'for a problem area. When the index is temporarily unavailable the result says so and ' +
  'names the public docs site.\n' +
  'Parameters:\n' +
  '- category (string, optional): limit to one category.\n' +
  '- sdk (string, optional): Android, iOS or Flutter.\n' +
  'Example: {"category": "Optimization"}';

/** Documentation tools read the in-process index: read-only and closed-world. */
export const DOCS_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
