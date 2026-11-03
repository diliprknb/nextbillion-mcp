# Cursor

Add the hosted server to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "nextbillion": {
      "url": "https://mcp.nextbillion.io"
    }
  }
}
```

Cursor opens the browser sign-in on first use. A one-click "Add to Cursor" deeplink for the
docs site:

```
cursor://anysphere.cursor-deeplink/mcp/install?name=nextbillion&config=<base64 of {"url":"https://mcp.nextbillion.io"}>
```
