# Connecting to the hosted server (any MCP client)

`nextbillion-mcp` runs as a hosted MCP server at **https://mcp.nextbillion.io**. Nothing is
installed locally: add the URL to your client and sign in with your NextBillion.ai API key
when the browser opens (get a key at [console.nextbillion.ai](https://console.nextbillion.ai)
or by emailing support@nextbillion.ai).

## Claude (claude.ai / Claude Desktop)

Settings → Connectors → _Add custom connector_ → URL `https://mcp.nextbillion.io` → Connect.
The browser sign-in page asks for your API key once.

## Claude Code

```bash
claude mcp add --transport http nextbillion https://mcp.nextbillion.io
```

Then `/mcp` → nextbillion → Authenticate. (The Claude Code plugin in this repository does the
same with one command: `claude plugin marketplace add nextbillion-ai/nextbillion-mcp &&
claude plugin install nextbillion-mcp@nextbillion`.)

## Codex

```bash
codex mcp add nextbillion --url https://mcp.nextbillion.io
```

Codex detects the sign-in and opens the browser.

## Cursor

Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in your project):

```json
{
  "mcpServers": {
    "nextbillion": {
      "url": "https://mcp.nextbillion.io"
    }
  }
}
```

## Scripts and CI (no browser)

Send the API key directly as a bearer token instead of signing in:

```bash
claude mcp add --transport http nextbillion https://mcp.nextbillion.io \
  --header "Authorization: Bearer $NBAI_API_KEY"
```

Any client that can set a header on an HTTP MCP server works the same way.

## Notes

- The four documentation tools need no sign-in; API tools ask you to sign in on first use.
- Requests to the NextBillion.ai API come from the server's fixed address `136.85.116.23`.
  If your key has an IP allowlist, allow that address.
- To revoke the server's access, reset your API key in the console.
