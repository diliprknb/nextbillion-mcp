# NextBillion MCP Evaluation Suite

Evaluation suite for testing tool routing, parameter validation, and tool disambiguation across all NextBillion.ai MCP server tools using [`@mcpjam/sdk`](https://www.npmjs.com/package/@mcpjam/sdk).

## Overview

The evaluation suite tests that LLM agents correctly identify and invoke the appropriate NextBillion.ai MCP tools for diverse real-world geospatial queries across:

- **Places & Geocoding** (`autocomplete`, `autosuggest`, `place_search`, `place_lookup`, `place_browse`, `geocode_structured`, `geocode_reverse`, `geocode_batch`, `postcode_lookup`)
- **Routing & Navigation** (`directions`, `distance_matrix`, `isochrone`, `search_along_route`)
- **Maps & Overlays** (`static_map_image`, `static_route_map`)
- **Documentation** (`search_documentation`, `get_documentation`, `get_api_parameters`, `list_documentation_topics`)
- **Negative / Out-of-Scope Disambiguation** (verifying tools are not erroneously called)

## Prerequisites

- Node.js >= 20
- Built NextBillion MCP server (`npm run build`)
- LLM API key (e.g. `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`)
- NextBillion API key (`NBAI_API_KEY`)
- _(Optional)_ MCPJam Project ID & API Key (`MCPJAM_PROJECT_ID`, `MCPJAM_API_KEY`) to upload results to the [MCPJam Cloud dashboard](https://app.mcpjam.com).

## Environment Variables

You can configure environment variables in `.env.evals` or your shell:

```bash
# LLM Provider Key (one of the following)
export GEMINI_API_KEY="your-gemini-api-key"
# or export OPENAI_API_KEY="your-openai-api-key"
# or export ANTHROPIC_API_KEY="your-anthropic-api-key"

# NextBillion.ai API key
export NBAI_API_KEY="your-nextbillion-api-key"

# Evaluation Model (optional, defaults to google/gemini-2.5-flash)
export EVAL_MODEL="google/gemini-2.5-flash"

# MCPJam Cloud Reporting (optional)
export MCPJAM_PROJECT_ID="your-project-id"
export MCPJAM_API_KEY="your-mcpjam-api-key"
```

## Running Evaluations

1. Build the server:

   ```bash
   npm run build
   ```

2. Run the evaluation runner:
   ```bash
   npm run eval
   ```
