import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MCPClientManager, HostRunner, createEvalRunReporter } from '@mcpjam/sdk';

// ─── Load Environment Variables ──────────────────────────────────────────────
function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim().replace(/^export\s+/, '');
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

// Check local .env.evals, .env.evals.example, or .env
loadEnvFile(resolve(process.cwd(), '.env.evals'));
loadEnvFile(resolve(process.cwd(), '.env.evals.example'));
loadEnvFile(resolve(process.cwd(), '.env'));

// ─── Configuration ───────────────────────────────────────────────────────────
const MCPJAM_API_KEY = process.env.MCPJAM_API_KEY;
const MCPJAM_PROJECT_ID = process.env.MCPJAM_PROJECT_ID;
const MODEL = process.env.EVAL_MODEL || 'google/gemini-2.5-flash';
// Prefer the key that matches the provider of EVAL_MODEL (e.g. anthropic/claude-sonnet-5.5).
const MODEL_PROVIDER_KEY: Record<string, string | undefined> = {
  anthropic: process.env.ANTHROPIC_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  google: process.env.GEMINI_API_KEY,
};
const LLM_API_KEY =
  MODEL_PROVIDER_KEY[MODEL.split('/')[0] ?? ''] ||
  process.env.GEMINI_API_KEY ||
  process.env.LLM_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.ANTHROPIC_API_KEY;

const NBAI_API_KEY = process.env.NBAI_API_KEY;
const SUITE_PATH = resolve(
  process.cwd(),
  process.env.EVAL_SUITE_PATH ?? 'evals/nextbillion_eval_suite.json',
);

interface TestCase {
  id: string;
  title?: string;
  name: string;
  category: string;
  description: string;
  prompt: string;
  expectedTool: string | null;
  expectedArgs?: Record<string, unknown>;
  forbiddenTools?: string[];
  passCriteria: string;
  expectedResponseContains?: { needle: string; caseSensitive?: boolean };
  expectedResponseSchema?: { schema: JsonSchema; advisory?: boolean };
}

// ─── Minimal JSON Schema subset validator ────────────────────────────────────
// Supports exactly the keywords used by this suite's authored schemas:
// type, required, properties, items, minItems, contains, pattern, const,
// minLength, minimum, exclusiveMinimum.
interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number';
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  minItems?: number;
  contains?: JsonSchema;
  pattern?: string;
  const?: unknown;
  minLength?: number;
  minimum?: number;
  exclusiveMinimum?: number;
}

function validateSchema(value: unknown, schema: JsonSchema, path = '$'): string[] {
  const errors: string[] = [];

  if (schema.const !== undefined) {
    if (value !== schema.const) errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    return errors;
  }

  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(`${path}: expected object, got ${value === null ? 'null' : typeof value}`);
      return errors;
    }
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${path}: missing required property "${key}"`);
    }
    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      if (key in obj) errors.push(...validateSchema(obj[key], subSchema, `${path}.${key}`));
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array, got ${typeof value}`);
      return errors;
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: expected at least ${schema.minItems} item(s), got ${value.length}`);
    }
    if (schema.items) {
      value.forEach((item, i) => errors.push(...validateSchema(item, schema.items!, `${path}[${i}]`)));
    }
    if (schema.contains) {
      const anyMatch = value.some((item) => validateSchema(item, schema.contains!, `${path}[]`).length === 0);
      if (!anyMatch) errors.push(`${path}: no item matches the required "contains" schema`);
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${path}: expected string, got ${typeof value}`);
      return errors;
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: expected length >= ${schema.minLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: does not match pattern /${schema.pattern}/`);
    }
  } else if (schema.type === 'number') {
    if (typeof value !== 'number') {
      errors.push(`${path}: expected number, got ${typeof value}`);
      return errors;
    }
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: expected >= ${schema.minimum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push(`${path}: expected > ${schema.exclusiveMinimum}`);
    }
  }
  return errors;
}

// ─── Partial argument matching (mirrors MCPJam's "toolCalledWith" partial mode) ──
// At every level of nesting, every key/element present in `expected` must
// partial-match the corresponding key/element in `actual`; extra object keys
// in `actual` are ignored at every depth (arrays still compare positionally).
function argsMatchPartial(expected: Record<string, unknown>, actual: Record<string, unknown> | undefined): string | null {
  if (!actual) return 'tool was not called, so no arguments were observed';
  for (const [key, expectedVal] of Object.entries(expected)) {
    if (!matchesPartial(actual[key], expectedVal)) {
      return `arg "${key}": expected ${JSON.stringify(expectedVal)}, got ${JSON.stringify(actual[key])}`;
    }
  }
  return null;
}

function matchesPartial(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (typeof actual === 'number' && typeof expected === 'number') return Math.abs(actual - expected) < 1e-9;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((v, i) => matchesPartial(actual[i], v));
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.entries(expected as Record<string, unknown>).every(([k, v]) =>
      matchesPartial((actual as Record<string, unknown>)[k], v),
    );
  }
  return false;
}

// ─── Extract the actual tool-result payload for response-correctness checks ────
function findToolResultOutput(
  toolMessages: Array<{ content: Array<{ type: string; toolName: string; output?: { type: string; value: unknown } }> }>,
  toolName: string,
): { value: unknown } | undefined {
  for (let i = toolMessages.length - 1; i >= 0; i--) {
    const parts = toolMessages[i]!.content;
    for (const part of parts) {
      if (part.type === 'tool-result' && part.toolName === toolName && part.output) {
        return part.output as { value: unknown };
      }
    }
  }
  return undefined;
}

function extractStructuredContent(output: { value: unknown } | undefined): unknown {
  const value = output?.value as { structuredContent?: unknown } | undefined;
  return value?.structuredContent ?? value;
}

function extractSearchableText(output: { value: unknown } | undefined): string {
  return JSON.stringify(output?.value ?? '');
}

interface SuiteDefinition {
  suiteName: string;
  description: string;
  cases: TestCase[];
}

async function main() {
  console.log('\n======================================================');
  console.log(' NextBillion MCP Evaluation Suite Runner (@mcpjam/sdk)');
  console.log('======================================================\n');
  console.log(`Model:           ${MODEL}`);
  console.log(`MCPJam Project:  ${MCPJAM_PROJECT_ID}`);
  console.log(
    `MCPJam Key:      ${MCPJAM_API_KEY ? MCPJAM_API_KEY.slice(0, 10) + '...' : '(none)'}`,
  );
  console.log(`LLM API Key:     ${LLM_API_KEY ? 'Present (configured)' : 'MISSING'}`);

  if (!LLM_API_KEY) {
    console.error('\n[Error] LLM API key not found in environment.');
    console.error('Please export GEMINI_API_KEY or LLM_API_KEY before running:');
    console.error('  export GEMINI_API_KEY="your-gemini-key"\n');
    process.exit(1);
  }

  // Load test suite
  const suiteData: SuiteDefinition = JSON.parse(readFileSync(SUITE_PATH, 'utf-8'));
  const testCases = suiteData.cases;
  console.log(`Loaded ${testCases.length} evaluation cases from: ${SUITE_PATH}\n`);

  // Ensure server bundle exists
  const serverBundlePath = resolve(process.cwd(), 'packages/server/dist/index.js');
  if (!existsSync(serverBundlePath)) {
    console.error(
      `[Error] Server bundle not found at ${serverBundlePath}. Run 'npm run build' first.`,
    );
    process.exit(1);
  }

  // Initialize MCPClientManager and connect to localhost nextbillion-mcp
  console.log('Connecting to localhost NextBillion MCP server via stdio...');
  const manager = new MCPClientManager();
  const SERVER_ID = 'nextbillion-mcp';

  await manager.connectToServer(SERVER_ID, {
    command: 'node',
    args: [serverBundlePath],
    env: {
      ...process.env,
      NBAI_API_KEY: NBAI_API_KEY ?? '',
    },
  });

  console.log('Connected successfully!');
  const tools = await manager.getToolsForAiSdk([SERVER_ID]);
  console.log(`Registered ${Object.keys(tools).length} tools for evaluation.\n`);

  // Initialize HostRunner with system prompt to guide tool invocation
  process.env.AI_SDK_LOG_WARNINGS = 'false';
  const runner = new HostRunner({
    tools,
    model: MODEL,
    apiKey: LLM_API_KEY,
    systemPrompt:
      'You are a geospatial AI assistant for NextBillion.ai. When an inquiry pertains to coordinates, locations, places, addresses, routing, navigation, distance matrices, isochrones, postcodes, or maps, you MUST use the corresponding NextBillion tool. Never fabricate geospatial data without calling a tool. Only respond without tools if the prompt is totally unrelated to geospatial queries (e.g., general knowledge, creative writing).',
    maxSteps: 6,
    mcpClientManager: manager,
  });

  // Initialize MCPJam Reporter if API Key provided
  let reporter: ReturnType<typeof createEvalRunReporter> | undefined;
  if (MCPJAM_API_KEY) {
    try {
      reporter = createEvalRunReporter({
        suiteName: suiteData.suiteName,
        apiKey: MCPJAM_API_KEY,
        project: MCPJAM_PROJECT_ID,
        strict: false,
        serverNames: [SERVER_ID],
        mcpClientManager: manager,
        expectedIterations: testCases.length,
      });
      console.log(`Connected to MCPJam Cloud Reporter for project: ${MCPJAM_PROJECT_ID}\n`);
    } catch (err) {
      console.warn('Could not initialize MCPJam cloud reporter:', err);
    }
  }

  // Run Test Cases
  console.log(
    '-----------------------------------------------------------------------------------------------------',
  );
  console.log(
    '| Status | Case ID                       | Target Tool           | Called Tools             | Time    |',
  );
  console.log(
    '-----------------------------------------------------------------------------------------------------',
  );

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i]!;
    const startTime = Date.now();
    let status = 'PASS';
    let calledTools: string[] = [];
    let errorMessage = '';

    try {
      let runResult = await runner.run(tc.prompt, {
        timeout: { totalMs: 35_000, stepMs: 25_000 },
      });

      // Handle rate limit / quota exceeded with backoff retry
      if (runResult.hasError()) {
        const errText = runResult.getError() || '';
        if (
          errText.includes('Quota exceeded') ||
          errText.includes('rate-limit') ||
          errText.includes('Please retry in') ||
          errText.includes('RESOURCE_EXHAUSTED')
        ) {
          const matches = [...errText.matchAll(/Please retry in ([\d\.]+)s/g)];
          let waitSecs = 60;
          if (matches.length > 0) {
            const parsed = matches.map((m) => Math.ceil(parseFloat(m[1])));
            waitSecs = Math.max(...parsed) + 5;
          }
          console.log(
            `\n  └─> [Rate Limit] Waiting ${waitSecs}s for quota window to clear before retrying...`,
          );
          await new Promise((r) => setTimeout(r, waitSecs * 1000));
          runner.resetPromptHistory();
          runResult = await runner.run(tc.prompt, {
            timeout: { totalMs: 45_000, stepMs: 35_000 },
          });
        }
      }

      const failureReasons: string[] = [];
      const warnings: string[] = [];

      if (runResult.hasError()) {
        failureReasons.push(`API error: ${runResult.getError()}`);
      } else {
        calledTools = runResult.toolsCalled();

        // Evaluation assertion: correct tool was called
        if (tc.expectedTool === null) {
          // Negative test case: no tool should be called
          if (calledTools.length > 0) {
            failureReasons.push(`Expected no tools, but called: ${calledTools.join(', ')}`);
          }
        } else {
          // Positive test case: expected tool must be in calledTools
          if (!calledTools.includes(tc.expectedTool)) {
            failureReasons.push(`Expected '${tc.expectedTool}', but called: ${calledTools.join(', ') || 'none'}`);
          }
        }

        // Disambiguation check: forbidden tools must not be called
        if (tc.forbiddenTools) {
          for (const fb of tc.forbiddenTools) {
            if (calledTools.includes(fb)) {
              failureReasons.push(`Forbidden tool '${fb}' was called`);
            }
          }
        }

        // Argument-correctness: the expected tool was called with the right arguments
        if (tc.expectedTool && tc.expectedArgs && calledTools.includes(tc.expectedTool)) {
          const actualArgs = runResult.getToolArguments(tc.expectedTool);
          const argError = argsMatchPartial(tc.expectedArgs, actualArgs);
          if (argError) failureReasons.push(`Args mismatch: ${argError}`);
        }

        // Response-correctness: the tool result actually contains/matches what was expected
        if (tc.expectedTool && calledTools.includes(tc.expectedTool)) {
          const toolMessages = runResult.getToolMessages() as unknown as Array<{
            content: Array<{ type: string; toolName: string; output?: { type: string; value: unknown } }>;
          }>;
          const output = findToolResultOutput(toolMessages, tc.expectedTool);

          if (tc.expectedResponseContains) {
            const { needle, caseSensitive } = tc.expectedResponseContains;
            const haystack = extractSearchableText(output);
            const found = caseSensitive
              ? haystack.includes(needle)
              : haystack.toLowerCase().includes(needle.toLowerCase());
            if (!found) failureReasons.push(`Response did not contain expected text "${needle}"`);
          }

          if (tc.expectedResponseSchema) {
            const structured = extractStructuredContent(output);
            const violations = validateSchema(structured, tc.expectedResponseSchema.schema);
            if (violations.length > 0) {
              const msg = `Response schema violation: ${violations[0]}${violations.length > 1 ? ` (+${violations.length - 1} more)` : ''}`;
              if (tc.expectedResponseSchema.advisory) warnings.push(msg);
              else failureReasons.push(msg);
            }
          }
        }
      }

      if (failureReasons.length > 0) {
        status = 'FAIL';
        errorMessage = failureReasons.join(' | ');
      }
      if (warnings.length > 0) {
        errorMessage = [errorMessage, `[advisory] ${warnings.join(' | ')}`].filter(Boolean).join(' | ');
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      if (status === 'PASS') passed++;
      else failed++;

      const caseCol = tc.id.padEnd(29, ' ');
      const toolCol = (tc.expectedTool || '(none)').padEnd(21, ' ');
      const calledCol = (calledTools.join(',') || '(none)').slice(0, 24).padEnd(24, ' ');
      const statusLabel = status === 'PASS' ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';

      console.log(
        `| ${statusLabel}   | ${caseCol} | ${toolCol} | ${calledCol} | ${duration.padStart(7, ' ')} |`,
      );
      if (errorMessage) {
        console.log(`  └─> \x1b[31m${errorMessage}\x1b[0m`);
      }

      // Record in MCPJam Cloud Reporter if available
      if (reporter && runResult) {
        try {
          await reporter.recordFromPrompt(runResult, {
            caseTitle: tc.title || tc.description || tc.name,
            caseId: tc.id,
            expectedToolCalls: tc.expectedTool ? [{ toolName: tc.expectedTool }] : [],
            isNegativeTest: tc.expectedTool === null,
          });
        } catch {
          // Non-fatal recording error
        }
      }
    } catch (err: unknown) {
      failed++;
      const duration = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      console.log(
        `| \x1b[31mERR \x1b[0m   | ${tc.id.padEnd(29, ' ')} | ${(tc.expectedTool || '').padEnd(21, ' ')} | ${'ERROR'.padEnd(24, ' ')} | ${duration.padStart(7, ' ')} |`,
      );
      console.log(
        `  └─> \x1b[31mError: ${err instanceof Error ? err.message : String(err)}\x1b[0m`,
      );
    }

    runner.resetPromptHistory();

    // Respect LLM rate limit (140 requests per minute sliding window)
    await new Promise((r) => setTimeout(r, 2500));
  }

  console.log(
    '-----------------------------------------------------------------------------------------------------\n',
  );
  const total = testCases.length;
  const passRate = ((passed / total) * 100).toFixed(1);
  console.log(`Results: ${passed}/${total} Passed (${passRate}% Pass Rate)`);

  if (reporter && reporter.getAddedCount() > 0) {
    console.log('\nFinalizing and uploading run results to MCPJam Cloud dashboard...');
    try {
      await reporter.finalize();
      console.log(
        `✓ Run data uploaded to: https://app.mcpjam.com/projects/${MCPJAM_PROJECT_ID}/evals`,
      );
    } catch (uploadErr) {
      console.warn('Upload to MCPJam dashboard failed:', uploadErr);
    }
  }

  await manager.disconnectAllServers();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
