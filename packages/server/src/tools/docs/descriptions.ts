/**
 * Descriptions and server instructions for the documentation tools, verbatim from the
 * build instructions (revision 4, appendix). Each description follows the standard
 * enforced by tests/unit/tools-mapping.test.ts: a `Parameters:` section, one example
 * call, under 1,200 characters.
 */

export const SERVER_INSTRUCTIONS =
  'For questions about how a NextBillion API or SDK works, use search_documentation and ' +
  'cite the returned source_url. The other tools execute real requests; use them only when ' +
  'the user wants an actual result, such as a route or a geocode.';

export const SEARCH_DOCUMENTATION_DESCRIPTION =
  "Search NextBillion's official API and SDK documentation. Use for any question about how " +
  'NextBillion works: calling an API, what a parameter means, which API to use, or SDK setup. ' +
  'The map tools (directions, place_search, etc.) execute real requests; do not use them to ' +
  'answer such questions.\n' +
  "Search with the docs' own terms and exact parameter names (truck_weight, option=flexible), " +
  'not everyday phrasing; retry with other API terms if results are thin. Results are ' +
  'excerpts: for multi-part questions, search again or fetch pages with get_documentation. ' +
  'Cite source_url; related_tools names the tool that performs the operation.\n' +
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
  'the size limit return truncated: true and a section list; request one section with ' +
  'section. Sample request and response bodies are omitted unless include_examples is true.\n' +
  'Parameters:\n' +
  '- doc_id (string, required): page id from search results.\n' +
  '- section (string, optional): heading of one section to return.\n' +
  '- include_examples (boolean, optional): default false.\n' +
  'Example: {"doc_id": "routing/directions-api/examples/legal-routes-for-a-given-truck-weight"}';

export const GET_API_PARAMETERS_DESCRIPTION =
  'Get structured parameter details for a NextBillion REST API endpoint: type, required, ' +
  'default, allowed values, units and description. Prefer this over searching prose for ' +
  'questions about a specific parameter. Returns every matching API variant (e.g. ' +
  'directions/flexible and directions/fast); check heading_path. Empty units means the docs ' +
  'do not state the unit; do not infer it. SDK methods are not covered.\n' +
  'Parameters:\n' +
  '- endpoint (string, required unless doc_id given): API slug, optionally with variant, ' +
  'e.g. directions or directions/flexible.\n' +
  '- doc_id (string, optional): page id instead of endpoint.\n' +
  '- name (string, optional): one parameter name.\n' +
  'Example: {"endpoint": "directions", "name": "truck_weight"}';

export const LIST_DOCUMENTATION_TOPICS_DESCRIPTION =
  'List the available documentation categories, APIs and pages, with index metadata. Use ' +
  "when you don't yet know the right terms to search for, e.g. to see which APIs exist for a " +
  'problem area before searching.\n' +
  'Parameters:\n' +
  '- category (string, optional): limit to one category.\n' +
  '- sdk (string, optional): Android, iOS or Flutter.\n' +
  'Example: {"category": "Optimization"}';

/** Documentation tools read a bundled index: read-only and closed-world. */
export const DOCS_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
