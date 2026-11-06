# How to run the Claude Code MCP server eval

Runbook for the 48-prompt comparison of the hosted NextBillion MCP server (`https://mcp.nextbillion.io`)
against the drk hybrid server, using headless Claude Code (`claude -p`) as the agent and the judge.
Everything lives in `evals/claude-code-benchmark/`; finished workbooks go to `evals/reports/`.

## 1. What this does

1. Starts one headless Claude Code session per prompt per server (48 prompts x 2 servers = 96 runs).
2. Records the tool calls, results, final answer, tokens, cost and wall time of every run.
3. Has a second headless Claude Code call grade each run into one of seven statuses
   (Pass, Partial Pass, Ungrounded, Capability Gap, Partial Fail, Fail, Fail (Bug)).
4. Builds an Excel report with a summary, per-prompt evidence and the method notes.

A reference run (2026-11-06, `claude-opus-5-5`) took about 35 minutes for the agent runs, about 3 minutes
for judging, and cost about $22 by Claude Code's own estimate.

## 2. Prerequisites

| Need | Check |
|---|---|
| Node.js 20+ | `node --version` |
| Claude Code CLI, logged in | `claude --version`, then `claude -p "say hi"` should answer |
| Repo dependencies | `npm install` (provides `@mcpjam/sdk`, used by `list_tools.mjs` and `cleanup.mjs`) |
| NextBillion API key | `NBAI_API_KEY` in the repo `.env` (never committed) |
| Python 3 with openpyxl | `python3 -m venv ~/.cache/venv48 && ~/.cache/venv48/bin/pip install openpyxl` |

Notes:
- Both servers must be reachable. Check the hosted one with `curl https://mcp.nextbillion.io/health`.
- Keep the venv outside `/tmp`; temp folders get cleaned and the venv disappears.
- Runs use your Claude Code usage. Budget about $0.25 per run; one slow prompt (03-1, long directions
  output) cost $1.24 and took 281 s.

## 3. Run it

Always from the repo root:

```bash
set -a; . ./.env; set +a

# 1. Save each server's tool list (used by the judge and the report)
node evals/claude-code-benchmark/list_tools.mjs

# 2. Smoke test on one prompt and both servers (about 15 s, about $0.30)
ONLY=01-2 node evals/claude-code-benchmark/run_agent.mjs

# 3. Full run, 3 sessions at a time. Resumable: rerun the same command to continue.
CONC=3 node evals/claude-code-benchmark/run_agent.mjs

# 4. Grade every run
node evals/claude-code-benchmark/judge.mjs

# 5. Delete what the drk-side runs created (preview first)
DRY_RUN=1 node evals/claude-code-benchmark/cleanup.mjs
node evals/claude-code-benchmark/cleanup.mjs

# 6. Build the Excel report
~/.cache/venv48/bin/python evals/claude-code-benchmark/build_report.py
```

For a long run, put step 3 in the background and watch the log:

```bash
(CONC=3 nohup node evals/claude-code-benchmark/run_agent.mjs > evals/claude-code-benchmark/results/run1.log 2>&1 &)
tail -f evals/claude-code-benchmark/results/run1.log
```

Output of step 6: `evals/reports/2026-11-06_claude_code_48_prompt_run.xlsx` (rename the date in
`build_report.py` for a new run so the old report is kept).

## 4. Options

Environment variables for `run_agent.mjs`:

| Variable | Default | Meaning |
|---|---|---|
| `ONLY` | all | Comma-separated prompt ids, e.g. `01-1,05-1` |
| `SERVERS` | `off,drk` | `off` = hosted official, `drk` = hybrid server |
| `CONC` | 2 | Parallel sessions |
| `CLAUDE_MODEL` | Claude Code default | Pin a model, e.g. to compare two models |
| `MAX_TURNS` | 8 | Agent turn limit per run |
| `MAX_BUDGET_USD` | 1.5 | Spend cap per run |
| `RUN_TIMEOUT_MS` | 240000 | Kill a run after this long |
| `OFF_URL`, `DRK_URL` | built in | Point at other endpoints |

`judge.mjs` accepts `JUDGE_MODEL` and `CONC`.

## 5. How a run is isolated

- Fresh empty working directory per run: no `CLAUDE.md`, no project settings (`--setting-sources ""`).
- `--strict-mcp-config` with a single server named `nextbillion`, so both servers show identical tool-name prefixes.
- Built-in tools (Bash, Read, Edit, web) are denied; only `mcp__nextbillion` is allowed; `--permission-mode dontAsk`.
- No session is saved (`--no-session-persistence`).
- The API key goes into a mode-0600 temp config as an `Authorization: Bearer` header (hosted) or `x-api-key`
  header (drk). The model never sees it.
- Claude Code loads MCP tool schemas lazily through its own `ToolSearch` tool, so most runs start with a
  `ToolSearch` call. It is ignored in tool-call counts and by the judge.

## 6. Mutating prompts and cleanup

These prompts write to the drk server through your API key:

| Prompt | What it can create |
|---|---|
| 05-1 | a tracked asset |
| 05-2 | a geofence |
| 06-1, 06-2, 06-3 | driver-assignment and clustering jobs (compute only, nothing to delete) |
| 07-3 | a road restriction (currently fails with a 404, so nothing is created) |

`cleanup.mjs` reads the ids from the saved results and deletes the asset, geofences and restrictions.
Run it with `DRY_RUN=1` first. To avoid the writes entirely, run with `ONLY` set to the other prompt ids.

## 7. Reading the results

The workbook has three sheets:

- **Summary**: winner tally, status counts, breakdown by capability category and prompt type, cost per run,
  and key takeaways.
- **Detail**: one row per prompt with each server's status, the judge's verdict, the tool calls, the final-answer
  excerpt, and a rule-based status for cross-checking.
- **Method & Caveats**: how the run and the judge work, and their limits.

Winner ranking: Pass, Partial Pass, Ungrounded, Partial Fail, Capability Gap, then Fail and Fail (Bug).
A missing tool ranks above an attempted failure, so a row where drk failed and the official server had no
tool is a wash, not a quality edge.

Caveats to keep in mind when quoting numbers:
- One run per prompt per server; results vary between runs.
- The agent and judge share a model family, so judge bias is possible. Check any `Fail (Bug)` row in Detail
  before reporting it as a server defect.
- Costs are Claude Code estimates, not billing figures.

## 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `SKIP ... MCP server not connected` | Endpoint down or wrong key. Check `/health`, then `NBAI_API_KEY`. The run is not saved, so rerunning retries it. |
| `SKIP ... no result event (exit null)` | The run hit `RUN_TIMEOUT_MS` and was killed. Rerun with `RUN_TIMEOUT_MS=420000 ONLY=<id> SERVERS=<server>`. |
| A run shows `error_max_turns` | The agent used all `MAX_TURNS`. Raise it, or treat as an agent-side failure (the judge usually notes this). |
| Judge prints `SKIP ... bad judge output` | Rerun `judge.mjs`; it only grades runs that have no verdict yet. |
| `build_report.py` fails on `import openpyxl` | Use the venv python from step 2 of the prerequisites. |
| Log appears stuck | Output is written in bursts as runs finish; check with `ps -eo etime,command \| grep "claude -p"`. |

## 9. Reusing it for another server or prompt set

- New prompts: edit `prompts.json` (fields `id`, `category`, `type`, `title`, `prompt`; `type` is either
  `MCP Tool Call` or `API/SDK Knowledge Q&A`).
- Other servers: change `OFF_URL` / `DRK_URL`, or the `SERVER_CFG` block in `run_agent.mjs` for a different
  transport or auth header. Keep the server name `nextbillion` for both so the comparison stays fair.
- Different model: set `CLAUDE_MODEL` for the agent and `JUDGE_MODEL` for the judge, run into a fresh results
  folder (or move the old `results/*.json` aside), and rebuild the report.
- Start clean: move or delete `results/agent_results.json` and `results/judged.json`; otherwise the runner
  and judge resume and skip what is already there.

## 10. Files

| File | Purpose |
|---|---|
| `prompts.json` | The 48 prompts |
| `list_tools.mjs` | Saves each server's tool names to `results/tools.json` |
| `run_agent.mjs` | Runs each prompt through `claude -p`; saves `results/agent_results.json` |
| `judge.mjs` | Grades runs; saves `results/judged.json` |
| `cleanup.mjs` | Deletes resources the drk runs created |
| `build_report.py` | Builds the workbook in `evals/reports/` |
| `results/` | Raw run data, judge output and logs from the 2026-11-06 reference run |
