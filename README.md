# QNAP Container Station MCP

MCP server for managing containers on a QNAP NAS via the Container Station API.

## Disclaimers

This is a personal project, built for use on my own NAS. It is not affiliated with, endorsed by, or in any way connected to QNAP Systems, Inc. QNAP and Container Station are trademarks of their respective owners.

This project is shared as-is. I make no claims about its suitability for any purpose other than my own use. Use it at your own risk.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your QNAP credentials
npm run build
```

## Configuration

Create a `.env` file (never commit this):

```
QNAP_URL=https://your-qnap.local
QNAP_USERNAME=container-mcp
QNAP_PASSWORD=your-password
QNAP_VERIFY_SSL=false
```

`QNAP_VERIFY_SSL=false` is needed for self-signed certificates (default on most QNAP devices).

## Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "qnap-container-station": {
      "command": "node",
      "args": ["/path/to/qnap-containerstation-mcp/dist/index.js"],
      "env": {
        "QNAP_URL": "https://your-qnap.local",
        "QNAP_USERNAME": "container-mcp",
        "QNAP_PASSWORD": "your-password",
        "QNAP_VERIFY_SSL": "false"
      }
    }
  }
}
```

## Claude Desktop

Add to `~/.config/Claude/claude_desktop_config.json` (Linux) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "qnap-container-station": {
      "command": "node",
      "args": ["/path/to/qnap-containerstation-mcp/dist/index.js"],
      "env": {
        "QNAP_URL": "https://your-qnap.local",
        "QNAP_USERNAME": "container-mcp",
        "QNAP_PASSWORD": "your-password",
        "QNAP_VERIFY_SSL": "false"
      }
    }
  }
}
```

## OpenCode

Add to `opencode.json` (project) or `~/.config/opencode/opencode.json` (global).

**OpenCode v1:**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "qnap-container-station": {
      "type": "local",
      "command": ["node", "/path/to/qnap-containerstation-mcp/dist/index.js"],
      "enabled": true,
      "environment": {
        "QNAP_URL": "https://your-qnap.local",
        "QNAP_USERNAME": "container-mcp",
        "QNAP_PASSWORD": "your-password",
        "QNAP_VERIFY_SSL": "false"
      }
    }
  }
}
```

**OpenCode v2:** servers move under `mcp.servers`, and `enabled` is replaced by the inverse `disabled`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "qnap-container-station": {
        "type": "local",
        "command": ["node", "/path/to/qnap-containerstation-mcp/dist/index.js"],
        "environment": {
          "QNAP_URL": "https://your-qnap.local",
          "QNAP_USERNAME": "container-mcp",
          "QNAP_PASSWORD": "your-password",
          "QNAP_VERIFY_SSL": "false"
        }
      }
    }
  }
}
```

In v2 you can also reference your shell environment instead of hardcoding secrets: `"QNAP_PASSWORD": "{env:QNAP_PASSWORD}"`.

## Available Tools

| Tool | Description |
|------|-------------|
| `list_containers` | List all containers with state, image, type |
| `get_container` | Get details for a specific container |
| `get_container_logs` | Fetch logs for a Docker container |
| `start_container` | Start a container |
| `stop_container` | Stop a container |
| `restart_container` | Restart a container |
| `list_apps` | List Docker Compose applications |
| `start_app` | Start a Compose app |
| `stop_app` | Stop a Compose app |
| `restart_app` | Restart a Compose app |
| `get_system_resource` | Get CPU and memory usage |
| `list_networks` | List Docker networks |
| `get_logs` | Query Container Station system logs |
| `list_compose_apps` | List Compose apps with status and resource limits (v3 API) |
| `get_compose_file` | Get the docker-compose YAML Container Station uses for an app (v3 API) |

> **Note:** Confirmed working on Container Station 3.x: `list_containers`, `list_apps`,
> `start_container`, `stop_container`, `restart_container`. Other endpoints may return 404
> depending on your Container Station version.

> **Note:** `list_compose_apps` and `get_compose_file` use the v3 API introduced in
> Container Station 3.1 (the one the Container Station web UI itself uses). It is not
> officially documented and may change between versions; both tools reuse the same
> v1 login session and fail with a clear error if the endpoints are unavailable.

## Tests

```bash
# Unit tests
npm test

# Live API tests (requires .env or env vars)
npm run test:live

# Override the test container (must be safe to stop/start)
QNAP_TEST_CONTAINER_ID=<container-id> npm run test:live
```
