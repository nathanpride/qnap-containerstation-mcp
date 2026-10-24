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

Add to `~/.config/Claude/claude_desktop_config.json`:

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
| `validate_compose_file` | Validate a compose YAML without creating anything (v3 API) |
| `create_compose_app` | Create a Compose app from a YAML document (v3 API) |
| `list_images` | List container images on the NAS (v3 API) |
| `list_volumes` | List container volumes with usage (v3 API) |
| `get_overview` | Container Station overview: apps, status, counts (v3 API) |

> **Note:** Confirmed working on Container Station 3.x: `list_containers`, `list_apps`,
> `start_container`, `stop_container`, `restart_container`. Other endpoints may return 404
> depending on your Container Station version.

> **Note:** The v3 tools use the API introduced in Container Station 3.1 (the one
> the Container Station web UI itself uses). It is not officially documented and
> may change between versions; all reuse the same v1 login session and fail with
> a clear error if the endpoints are unavailable. `create_compose_app` is the one
> **write** tool. Verified live: the underlying endpoint would silently re-run
> compose-up (redeploy) for an existing name, so the client checks existence
> first and **refuses to redeploy** — create is strictly create-only. Bind-mount
> source paths in the YAML must already exist on the NAS — see the TLS section
> of the README for the directory and ordering rules.

## Tests

```bash
# Unit tests
npm test

# Live API tests (requires .env or env vars)
npm run test:live

# Override the test container (must be safe to stop/start)
QNAP_TEST_CONTAINER_ID=<container-id> npm run test:live

# Live v3 API tests (read-only by default). With QNAP_ALLOW_CREATE=1 it also
# creates one throwaway compose app to verify the create flow and the
# refuse-to-redeploy guard — remove it in the Container Station UI afterwards.
npm run test:live:v3
QNAP_ALLOW_CREATE=1 npm run test:live:v3
```
