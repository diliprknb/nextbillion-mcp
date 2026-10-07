import type * as z from 'zod/v4';
import type { NbClient } from '../nbclient/client.js';

/** Subset of the MCP CallToolResult shape produced by our tools. */
export interface ToolResult {
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  >;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * One NextBillion API wrapped as an MCP tool. Every tool is a plain object so the
 * registry can sort and register them uniformly and tests can call `run` directly.
 */
export interface NbTool<Schema extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  annotations?: ToolAnnotations;
  /**
   * doc_ids of the reference pages that document the API this tool calls. Feeds
   * `related_tools` in search_documentation results; a unit test requires every API tool
   * to declare at least one existing page.
   */
  docs?: readonly string[];
  run(args: z.output<Schema>, nb: NbClient): Promise<ToolResult>;
}

/** All NextBillion Phase 1 APIs are read-only queries against an open dataset. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export class ToolInputError extends Error {}

/**
 * Build a tool result whose text block carries BOTH a human-readable summary and the
 * complete response as JSON. The MCP spec recommends mirroring structured content
 * into the text block: some hosts (e.g. Claude Desktop) surface only the text to the
 * model, so a summary-only text block made fields such as `access` invisible even
 * though they were present in `structuredContent`.
 */
export function textResult(
  summary: string,
  structuredContent?: Record<string, unknown>,
): ToolResult {
  const text =
    structuredContent === undefined
      ? summary
      : `${summary}\n\nFull response (JSON):\n${JSON.stringify(structuredContent)}`;
  return { content: [{ type: 'text', text }], structuredContent };
}
