# Claude Desktop extension (MCP Bundle)

This folder holds the manifest for the Claude Desktop extension. `npm run build:mcpb` packs
the zero-dependency server bundle (`packages/server/dist/index.js`), this manifest, the icon,
the README and the LICENSE into `dist-mcpb/nextbillion-mcp-<version>.mcpb` using the official
`@anthropic-ai/mcpb` CLI, after validating the manifest and checking that its tool list
matches the tools the bundled server actually serves. CI builds the file on every run and
uploads it as a workflow artifact; releases carry it as an asset.

The extension bundles the server, so it installs offline, pins the reviewed version, and needs
no Node.js on the machine (Claude Desktop ships its own runtime for `node` extensions). The API
key is the only setting: it is requested at install time as a sensitive value and passed to
the server as `NBAI_API_KEY`. `NBAI_IMAGE_DIR` is deliberately not exposed, so the extension
never writes to disk; Claude Desktop displays rendered maps inline.

## Install

1. Download `nextbillion-mcp-<version>.mcpb` from the
   [latest release](https://github.com/nextbillion-ai/nextbillion-mcp/releases/latest).
2. Open the file (double-click), or in Claude Desktop go to Settings → Extensions →
   Advanced settings → Install Extension… and pick it. A locally installed bundle that is not
   signed by Anthropic may show a warning; bundles distributed through the directory are
   signed by Anthropic.
3. Paste your NextBillion.ai API key when prompted and enable the extension.

## Manual test checklist (run on macOS and on Windows before a submission)

1. Install as above. Expected: the API key prompt appears once; the extension shows as
   enabled with 16 tools.
2. Ask: "Geocode 1600 Pennsylvania Avenue NW, Washington DC". Expected: `geocode_forward`
   runs without a permission prompt (read-only) and returns coordinates near 38.8977, -77.0365.
3. Ask: "Show me a map of Singapore's Marina Bay". Expected: `static_map_image` returns an
   inline map image and the caption contains no "Saved to" path.
4. Confirm nothing was written: macOS `ls "$TMPDIR/nextbillion-mcp"` and Windows
   `dir %TEMP%\nextbillion-mcp` both report that the directory does not exist (unless an
   earlier, non-extension setup created it).
5. Open the extension's settings, clear the key, save. Expected: tools fail with a readable
   "NBAI_API_KEY is not set" error, not a crash.
6. Uninstall from Settings → Extensions. Expected: the tools disappear after a restart.

## Build locally

```bash
npm ci
npm run build
npm run build:mcpb
node node_modules/@anthropic-ai/mcpb/dist/cli/cli.js info dist-mcpb/nextbillion-mcp-<version>.mcpb
```

The manifest version must equal the server package version (checked by
`scripts/check-dist-versions.mjs`), and `manifest.tools` must list exactly the served tool
names (checked by the build script). Tool descriptions in the manifest are short display
strings; the full descriptions live in the server.
