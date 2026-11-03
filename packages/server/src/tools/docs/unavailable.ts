import { DOCS_SITE_URL, DocsUnavailableError, getDocsIndex } from '../../docs/store.js';
import type { DocsIndex } from '../../docs/store.js';
import type { ToolResult } from '../types.js';

/**
 * Runs a documentation tool body with the index, or returns the "index unavailable" result
 * when there is none: not an error for the client, but a plain answer that names the public
 * docs site so the model can read the documentation there instead.
 */
export async function withDocsIndex(
  body: (index: DocsIndex) => ToolResult | Promise<ToolResult>,
): Promise<ToolResult> {
  let index: DocsIndex;
  try {
    index = await getDocsIndex();
  } catch (error) {
    if (!(error instanceof DocsUnavailableError)) throw error;
    return {
      content: [{ type: 'text', text: error.message }],
      structuredContent: {
        available: false,
        ...(error.reason ? { reason: error.reason } : {}),
        docs_site_url: DOCS_SITE_URL,
      },
    };
  }
  return body(index);
}
