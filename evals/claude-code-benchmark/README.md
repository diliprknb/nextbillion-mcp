# Claude Code benchmark: hosted official vs drk hybrid MCP server

Re-runs the 48-prompt comparison with **headless Claude Code (`claude -p`)** as the agent and judge, so the
results use the same client family as the earlier Claude-based reports. Reusable for any pair of MCP servers:
change the endpoints and prompts.

## Files

| File | Purpose |
|---|---|
| `prompts.json` | The 48 prompts (id, category, type, title, prompt). |
| `list_tools.mjs` | Saves each server's tool names to `results/tools.json` (used by the judge and report). |
| `run_agent.mjs` | Runs every prompt on both servers through `claude -p`; saves `results/agent_results.json` (resumable). |
| `judge.mjs` | Grades each run with a second `claude -p` call (JSON schema, no tools); saves `results/judged.json`. |
| `cleanup.mjs` | Deletes assets, geofences and road restrictions that the drk-side runs created. |
| `build_report.py` | Builds `evals/reports/2026-11-06_claude_code_48_prompt_run.xlsx` (Summary, Detail, Method & Caveats). |

## Run it

From the repo root, with `NBAI_API_KEY` in `.env` and Claude Code (`claude`) logged in:

```bash
set -a; . ./.env; set +a
node evals/claude-code-benchmark/list_tools.mjs          # tool lists
CONC=3 node evals/claude-code-benchmark/run_agent.mjs    # 96 runs, resumable
node evals/claude-code-benchmark/judge.mjs               # statuses
DRY_RUN=1 node evals/claude-code-benchmark/cleanup.mjs   # preview what the drk runs created
node evals/claude-code-benchmark/cleanup.mjs             # delete it
python3 -m venv ~/.cache/venv48 && ~/.cache/venv48/bin/pip install openpyxl   # once
~/.cache/venv48/bin/python evals/claude-code-benchmark/build_report.py
```

Useful env vars: `ONLY=01-1,05-1` (subset), `SERVERS=off` (one server), `CLAUDE_MODEL`, `MAX_TURNS`,
`MAX_BUDGET_USD` (per run), `OFF_URL`, `DRK_URL`, `JUDGE_MODEL`.

## How a run is isolated

- Empty temp working directory per run (no `CLAUDE.md`, no project settings), `--setting-sources ""`.
- `--strict-mcp-config` with a single server named `nextbillion` (identical tool-name prefix for both servers).
- Built-in tools disabled; only `mcp__nextbillion` allowed; `--permission-mode dontAsk`; `--no-session-persistence`.
- API key passed to the server through a header in a `0600` temp config, never in the prompt.
- Claude Code defers MCP tools behind its own `ToolSearch`; those calls are ignored in counts and judging.

## Notes

- Each run spends Claude Code usage (cost is recorded per run in `cost_usd`).
- The mutating prompts (05-1, 05-2, 07-3, 06-x) write to the drk server through your API key. Run `cleanup.mjs` after.
- Runs that never started (MCP server not connected, no result event) are not saved, so a rerun retries them.
- Results are single runs; model behaviour varies. Agent and judge share a model family, so judge bias is possible.
- The earlier Gemini-based version lives in `evals/hosted-benchmark/`.
