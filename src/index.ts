#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ContainerStationClient } from "./client.js";
import { appNameSchema, containerIdSchema, containerTypeSchema } from "./schemas.js";

if (process.env.QNAP_VERIFY_SSL !== "true") {
  console.error(
    'Warning: TLS certificate verification is disabled (QNAP_VERIFY_SSL is not "true"). ' +
      "This is expected for QNAP devices with self-signed certificates, but only use it on networks you trust."
  );
}

const client = new ContainerStationClient({
  baseUrl: process.env.QNAP_URL ?? "",
  username: process.env.QNAP_USERNAME ?? "",
  password: process.env.QNAP_PASSWORD ?? "",
  verifySSL: process.env.QNAP_VERIFY_SSL === "true",
});

if (!process.env.QNAP_URL || !process.env.QNAP_USERNAME || !process.env.QNAP_PASSWORD) {
  console.error("Error: QNAP_URL, QNAP_USERNAME, and QNAP_PASSWORD must be set.");
  process.exit(1);
}

const server = new McpServer({
  name: "qnap-containerstation",
  version: "0.1.0",
});

// Tool annotations let MCP clients gate operations by risk: read-only tools
// are always safe to call, destructive ones may need explicit approval.
const READ_ONLY = { readOnlyHint: true };
const START = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
const STOP = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };
const RESTART = { readOnlyHint: false, destructiveHint: true, idempotentHint: false };

server.registerTool(
  "list_containers",
  {
    title: "List Containers",
    description: "List all containers with their state, image, type, and project",
    annotations: READ_ONLY,
  },
  async () => {
    const containers = await client.listContainers();
    return { content: [{ type: "text", text: JSON.stringify(containers, null, 2) }] };
  }
);

server.registerTool(
  "get_container",
  {
    title: "Get Container",
    description: "Get details for a specific container",
    inputSchema: { type: containerTypeSchema, id: containerIdSchema },
    annotations: READ_ONLY,
  },
  async ({ type, id }) => {
    const container = await client.getContainer(type, id);
    return { content: [{ type: "text", text: JSON.stringify(container, null, 2) }] };
  }
);

server.registerTool(
  "get_container_logs",
  {
    title: "Get Container Logs",
    description: "Fetch logs for a Docker container",
    inputSchema: { id: containerIdSchema },
    annotations: READ_ONLY,
  },
  async ({ id }) => {
    const logs = await client.getContainerLogs(id);
    return { content: [{ type: "text", text: String(logs) }] };
  }
);

server.registerTool(
  "start_container",
  {
    title: "Start Container",
    description: "Start a container",
    inputSchema: { type: containerTypeSchema, id: containerIdSchema },
    annotations: START,
  },
  async ({ type, id }) => {
    await client.startContainer(type, id);
    return { content: [{ type: "text", text: `Container ${id} started.` }] };
  }
);

server.registerTool(
  "stop_container",
  {
    title: "Stop Container",
    description: "Stop a container",
    inputSchema: { type: containerTypeSchema, id: containerIdSchema },
    annotations: STOP,
  },
  async ({ type, id }) => {
    await client.stopContainer(type, id);
    return { content: [{ type: "text", text: `Container ${id} stopped.` }] };
  }
);

server.registerTool(
  "restart_container",
  {
    title: "Restart Container",
    description: "Restart a container",
    inputSchema: { type: containerTypeSchema, id: containerIdSchema },
    annotations: RESTART,
  },
  async ({ type, id }) => {
    await client.restartContainer(type, id);
    return { content: [{ type: "text", text: `Container ${id} restarted.` }] };
  }
);

server.registerTool(
  "list_apps",
  {
    title: "List Apps",
    description: "List all Docker Compose applications",
    annotations: READ_ONLY,
  },
  async () => {
    const apps = await client.listApps();
    return { content: [{ type: "text", text: JSON.stringify(apps, null, 2) }] };
  }
);

server.registerTool(
  "start_app",
  {
    title: "Start App",
    description: "Start a Docker Compose application",
    inputSchema: { name: appNameSchema },
    annotations: START,
  },
  async ({ name }) => {
    await client.startApp(name);
    return { content: [{ type: "text", text: `App ${name} started.` }] };
  }
);

server.registerTool(
  "stop_app",
  {
    title: "Stop App",
    description: "Stop a Docker Compose application",
    inputSchema: { name: appNameSchema },
    annotations: STOP,
  },
  async ({ name }) => {
    await client.stopApp(name);
    return { content: [{ type: "text", text: `App ${name} stopped.` }] };
  }
);

server.registerTool(
  "restart_app",
  {
    title: "Restart App",
    description: "Restart a Docker Compose application",
    inputSchema: { name: appNameSchema },
    annotations: RESTART,
  },
  async ({ name }) => {
    await client.restartApp(name);
    return { content: [{ type: "text", text: `App ${name} restarted.` }] };
  }
);

server.registerTool(
  "list_compose_apps",
  {
    title: "List Compose Apps",
    description: "List Docker Compose applications with status and resource limits (v3 API, Container Station 3.1+)",
    annotations: READ_ONLY,
  },
  async () => {
    const apps = await client.listComposeApps();
    return { content: [{ type: "text", text: JSON.stringify(apps, null, 2) }] };
  }
);

server.registerTool(
  "get_compose_file",
  {
    title: "Get Compose File",
    description: "Get the docker-compose YAML that Container Station uses for an application (v3 API, Container Station 3.1+)",
    inputSchema: { name: appNameSchema },
    annotations: READ_ONLY,
  },
  async ({ name }) => {
    const yml = await client.getComposeFile(name);
    return { content: [{ type: "text", text: yml }] };
  }
);

server.registerTool(
  "get_system_resource",
  {
    title: "Get System Resource Usage",
    description: "Get current CPU and memory usage",
    annotations: READ_ONLY,
  },
  async () => {
    const resource = await client.getSystemResource();
    return { content: [{ type: "text", text: JSON.stringify(resource, null, 2) }] };
  }
);

server.registerTool(
  "list_networks",
  {
    title: "List Networks",
    description: "List all Docker networks",
    annotations: READ_ONLY,
  },
  async () => {
    const networks = await client.listNetworks();
    return { content: [{ type: "text", text: JSON.stringify(networks, null, 2) }] };
  }
);

server.registerTool(
  "get_logs",
  {
    title: "Get System Logs",
    description: "Query Container Station system logs",
    inputSchema: {
      limit: z.number().optional().describe("Max number of log entries to return"),
      offset: z.number().optional().describe("Number of entries to skip"),
      level: z.enum(["INFO", "WARN", "ERROR"]).optional().describe("Filter by log level"),
      category: z.string().optional().describe("Filter by category: container, image, import, export, backup, system"),
    },
    annotations: READ_ONLY,
  },
  async ({ limit, offset, level, category }) => {
    const logs = await client.getLogs({ limit, offset, level, category });
    return { content: [{ type: "text", text: JSON.stringify(logs, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
