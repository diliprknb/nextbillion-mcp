/**
 * All logging goes to stderr, where Cloud Run collects it. The MCP `logging`
 * capability is deprecated in the 2026-07-28 revision and is not used.
 */
export function logError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : '';
  console.error(`[nextbillion-mcp] ${message}${detail}`);
}

export function logInfo(message: string): void {
  console.error(`[nextbillion-mcp] ${message}`);
}
