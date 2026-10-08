import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export interface ServerConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

export interface ImageDirResolution {
  /** Directory to save rendered map images to; undefined means nothing is written. */
  dir?: string;
  /** Set when NBAI_IMAGE_DIR was given but unusable; saving is disabled in that case. */
  warning?: string;
}

/**
 * Saving rendered map images to disk is opt-in via NBAI_IMAGE_DIR. When it is unset the
 * server never touches the filesystem: the image is returned inline only, which is all
 * that desktop hosts need. Terminal-based MCP clients such as the Codex CLI cannot display
 * image content, so their configs set the variable; the literal value `tmp` selects
 * `<OS temp dir>/nextbillion-mcp` and keeps those configs portable. Relative paths are
 * rejected because a stdio server's working directory is whatever the host chose.
 */
export function resolveImageDir(env: NodeJS.ProcessEnv = process.env): ImageDirResolution {
  const raw = env.NBAI_IMAGE_DIR?.trim();
  if (!raw) return {};
  if (raw.toLowerCase() === 'tmp') return { dir: join(tmpdir(), 'nextbillion-mcp') };
  if (!isAbsolute(raw)) {
    return {
      warning: `NBAI_IMAGE_DIR must be an absolute path or "tmp", got "${raw}"; map images will not be saved`,
    };
  }
  return { dir: raw };
}

/** Directory for saved map images, or undefined when saving is not enabled. */
export function imageOutputDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return resolveImageDir(env).dir;
}

export const DEFAULT_BASE_URL = 'https://api.nextbillion.io';
export const DEFAULT_TIMEOUT_MS = 30_000;

export class ConfigError extends Error {}

/** Read configuration from environment variables. Throws ConfigError when the API key is missing. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const apiKey = env.NBAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError(
      'NBAI_API_KEY is not set. Get an API key at https://console.nextbillion.ai and ' +
        'expose it to the server, e.g. NBAI_API_KEY=<your key> npx nextbillion-mcp',
    );
  }
  const timeoutMs = env.NBAI_TIMEOUT_MS ? Number(env.NBAI_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigError(`NBAI_TIMEOUT_MS must be a positive number, got: ${env.NBAI_TIMEOUT_MS}`);
  }
  return {
    apiKey,
    baseUrl: (env.NBAI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    timeoutMs,
  };
}
