import { McpServer } from '@modelcontextprotocol/server';
import { NbApiError } from '../nbclient/errors.js';
import type { NbClient } from '../nbclient/client.js';
import { ALL_TOOLS } from '../tools/index.js';
import { ToolInputError, type ToolResult } from '../tools/types.js';
import { logError } from '../log.js';
import { SERVER_INSTRUCTIONS } from '../tools/docs/descriptions.js';

export const SERVER_NAME = 'nextbillion-mcp';

/**
 * Build one McpServer instance wired to the given NextBillion API client.
 * Used as the per-connection factory for serveStdio (and later HTTP serving).
 *
 * 2026-07-28 spec notes: the SDK provides server/discover, per-request _meta
 * validation, and resultType stamping. The deprecated Roots/Sampling/Logging
 * features are intentionally not implemented. The tool list is static, so
 * tools/list advertises a 24h public cache hint.
 */
export function buildServer(nb: NbClient, version: string): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version },
    {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
      cacheHints: {
        'tools/list': { ttlMs: 86_400_000, cacheScope: 'public' },
      },
    },
  );

  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args: unknown): Promise<ToolResult> => {
        try {
          return await tool.run(args as never, nb);
        } catch (error) {
          return toToolError(tool.name, error);
        }
      },
    );
  }
  return server;
}

/**
 * Upstream API failures and input validation problems come back as ordinary tool
 * results with isError, so the model can read the message and correct its call.
 */
function toToolError(toolName: string, error: unknown): ToolResult {
  if (error instanceof ToolInputError) {
    return { content: [{ type: 'text', text: `Invalid input: ${error.message}` }], isError: true };
  }
  if (error instanceof NbApiError) {
    return { content: [{ type: 'text', text: error.message }], isError: true };
  }
  logError(`Unexpected error in tool ${toolName}`, error);
  return {
    content: [
      {
        type: 'text',
        text: `Unexpected error in ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
    isError: true,
  };
}
