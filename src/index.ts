#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ContainerStationClient } from "./client.js";

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

server.tool(
  "list_containers",
  "List all containers with their state, image, type, and project",
  {},
  async () => {
    const containers = await client.listContainers();
    return { content: [{ type: "text", text: JSON.stringify(containers, null, 2) }] };
  }
);

server.tool(
  "get_container",
  "Get details for a specific container",
  { type: z.string().describe("Container type: docker, lxc, or lxd"), id: z.string().describe("Container ID") },
  async ({ type, id }) => {
    const container = await client.getContainer(type, id);
    return { content: [{ type: "text", text: JSON.stringify(container, null, 2) }] };
  }
);

server.tool(
  "get_container_logs",
  "Fetch logs for a Docker container",
  { id: z.string().describe("Container ID") },
  async ({ id }) => {
    const logs = await client.getContainerLogs(id);
    return { content: [{ type: "text", text: String(logs) }] };
  }
);

server.tool(
  "start_container",
  "Start a container",
  { type: z.string().describe("Container type: docker, lxc, or lxd"), id: z.string().describe("Container ID") },
  async ({ type, id }) => {
    await client.startContainer(type, id);
    return { content: [{ type: "text", text: `Container ${id} started.` }] };
  }
);

server.tool(
  "stop_container",
  "Stop a container",
  { type: z.string().describe("Container type: docker, lxc, or lxd"), id: z.string().describe("Container ID") },
  async ({ type, id }) => {
    await client.stopContainer(type, id);
    return { content: [{ type: "text", text: `Container ${id} stopped.` }] };
  }
);

server.tool(
  "restart_container",
  "Restart a container",
  { type: z.string().describe("Container type: docker, lxc, or lxd"), id: z.string().describe("Container ID") },
  async ({ type, id }) => {
    await client.restartContainer(type, id);
    return { content: [{ type: "text", text: `Container ${id} restarted.` }] };
  }
);

server.tool(
  "list_apps",
  "List all Docker Compose applications",
  {},
  async () => {
    const apps = await client.listApps();
    return { content: [{ type: "text", text: JSON.stringify(apps, null, 2) }] };
  }
);

server.tool(
  "start_app",
  "Start a Docker Compose application",
  { name: z.string().describe("Application name") },
  async ({ name }) => {
    await client.startApp(name);
    return { content: [{ type: "text", text: `App ${name} started.` }] };
  }
);

server.tool(
  "stop_app",
  "Stop a Docker Compose application",
  { name: z.string().describe("Application name") },
  async ({ name }) => {
    await client.stopApp(name);
    return { content: [{ type: "text", text: `App ${name} stopped.` }] };
  }
);

server.tool(
  "restart_app",
  "Restart a Docker Compose application",
  { name: z.string().describe("Application name") },
  async ({ name }) => {
    await client.restartApp(name);
    return { content: [{ type: "text", text: `App ${name} restarted.` }] };
  }
);

server.tool(
  "get_system_resource",
  "Get current CPU and memory usage",
  {},
  async () => {
    const resource = await client.getSystemResource();
    return { content: [{ type: "text", text: JSON.stringify(resource, null, 2) }] };
  }
);

server.tool(
  "list_networks",
  "List all Docker networks",
  {},
  async () => {
    const networks = await client.listNetworks();
    return { content: [{ type: "text", text: JSON.stringify(networks, null, 2) }] };
  }
);

server.tool(
  "get_logs",
  "Query Container Station system logs",
  {
    limit: z.number().optional().describe("Max number of log entries to return"),
    offset: z.number().optional().describe("Number of entries to skip"),
    level: z.enum(["INFO", "WARN", "ERROR"]).optional().describe("Filter by log level"),
    category: z.string().optional().describe("Filter by category: container, image, import, export, backup, system"),
  },
  async ({ limit, offset, level, category }) => {
    const logs = await client.getLogs({ limit, offset, level, category });
    return { content: [{ type: "text", text: JSON.stringify(logs, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
