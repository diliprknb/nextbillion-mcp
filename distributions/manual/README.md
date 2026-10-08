# Manual configuration (any MCP client)

The `nextbillion-mcp` server runs locally over stdio via `npx`. Any MCP-capable client can use
it with the snippets below. You need a NextBillion.ai API key from
[console.nextbillion.ai](https://console.nextbillion.ai) or by emailing support@nextbillion.ai.

## Claude Code

```bash
claude mcp add nextbillion \
  --env NBAI_API_KEY=YOUR_KEY \
  --env npm_config_audit=false --env npm_config_fund=false --env npm_config_update_notifier=false \
  -- npx -y nextbillion-mcp
```

## Cursor

Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in your project):

```json
{
  "mcpServers": {
    "nextbillion": {
      "command": "npx",
      "args": ["-y", "nextbillion-mcp"],
      "env": {
        "NBAI_API_KEY": "YOUR_KEY",
        "npm_config_audit": "false",
        "npm_config_fund": "false",
        "npm_config_update_notifier": "false"
      }
    }
  }
}
```

## Claude Desktop

The simplest route is the extension bundle: download `nextbillion-mcp-<version>.mcpb` from
the [latest release](https://github.com/nextbillion-ai/nextbillion-mcp/releases/latest) and
open it; see [`../claude-desktop/README.md`](../claude-desktop/README.md). The manual
configuration below is the alternative for people who prefer npx.

Claude Desktop → Settings → Developer → Edit Config opens `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`,
Windows: `%APPDATA%\Claude\claude_desktop_config.json`). Add:

```json
{
  "mcpServers": {
    "nextbillion": {
      "command": "npx",
      "args": ["-y", "nextbillion-mcp"],
      "env": {
        "NBAI_API_KEY": "YOUR_KEY",
        "npm_config_audit": "false",
        "npm_config_fund": "false",
        "npm_config_update_notifier": "false"
      }
    }
  }
}
```

Restart Claude Desktop afterwards; the nextbillion tools appear under the tools icon.
Requires Node.js on the machine. Note: the "Add custom connector" dialog is only for
remote (URL-based) MCP servers — this package currently ships as a local stdio server,
so use the config file instead.

## Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.nextbillion]
command = "npx"
args = ["-y", "nextbillion-mcp"]
env = { "NBAI_API_KEY" = "YOUR_KEY", "NBAI_IMAGE_DIR" = "tmp", "npm_config_audit" = "false", "npm_config_fund" = "false", "npm_config_update_notifier" = "false" }
```

`NBAI_IMAGE_DIR = "tmp"` makes the map tools also save each rendered image to the OS temp
directory and report the file path, because the Codex CLI cannot display images inline.
Leave it out for clients that show images (Claude Desktop, Claude Code, Cursor); the
server then writes nothing to disk.

The three `npm_config_*` variables switch off npm's post-install security audit, funding
notice, and self-update check when npx launches the server. None of them affect the server;
on some corporate networks the audit request hangs for minutes and MCP clients give up
after their 30 s startup timeout.

## Environment variables

| Variable          | Required | Description                                                                                                                                                                                         |
| ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NBAI_API_KEY`    | yes      | NextBillion.ai API key                                                                                                                                                                              |
| `NBAI_BASE_URL`   | no       | API base URL (default `https://api.nextbillion.io`)                                                                                                                                                 |
| `NBAI_TIMEOUT_MS` | no       | Per-request timeout in milliseconds (default 30000)                                                                                                                                                 |
| `NBAI_IMAGE_DIR`  | no       | Opt-in: also save rendered map images to this absolute directory, or `tmp` for the OS temp dir. Unset (default): nothing is written to disk. Needed only for terminal clients such as the Codex CLI |
