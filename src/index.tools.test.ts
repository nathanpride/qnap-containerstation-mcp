import { describe, it, expect, vi, beforeAll } from "vitest";

// These tests import the real entry point with the MCP SDK and the client
// mocked, so the actual tool registration (names, schemas, annotations)
// is exercised without any network or stdio access.

const mocks = vi.hoisted(() => ({
  registerTool: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: vi.fn(function () {
    return {
      registerTool: mocks.registerTool,
      connect: mocks.connect,
    };
  }),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock("./client.js", () => ({
  ContainerStationClient: vi.fn(function () {
    return {};
  }),
}));

beforeAll(async () => {
  process.env.QNAP_URL = "https://qnap.local";
  process.env.QNAP_USERNAME = "user";
  process.env.QNAP_PASSWORD = "pass";
  process.env.QNAP_VERIFY_SSL = "true";
  await import("./index.js");
});

function toolConfig(name: string) {
  const call = mocks.registerTool.mock.calls.find(([n]) => n === name);
  if (!call) throw new Error(`tool ${name} was not registered`);
  return call[1];
}

describe("tool registration", () => {
  it("registers all 13 tools and connects over stdio", () => {
    expect(mocks.registerTool).toHaveBeenCalledTimes(13);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });

  it("gives every tool a title and description", () => {
    for (const [, config] of mocks.registerTool.mock.calls) {
      expect(config.title).toBeTruthy();
      expect(config.description).toBeTruthy();
    }
  });

  it("marks read-only tools with readOnlyHint", () => {
    for (const name of [
      "list_containers",
      "get_container",
      "get_container_logs",
      "list_apps",
      "get_system_resource",
      "list_networks",
      "get_logs",
    ]) {
      expect(toolConfig(name).annotations).toMatchObject({ readOnlyHint: true });
    }
  });

  it("marks start tools as non-destructive and idempotent", () => {
    for (const name of ["start_container", "start_app"]) {
      expect(toolConfig(name).annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      });
    }
  });

  it("marks stop tools as destructive and idempotent", () => {
    for (const name of ["stop_container", "stop_app"]) {
      expect(toolConfig(name).annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      });
    }
  });

  it("marks restart tools as destructive and non-idempotent", () => {
    for (const name of ["restart_container", "restart_app"]) {
      expect(toolConfig(name).annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      });
    }
  });

  it("keeps input schemas on tools that take parameters", () => {
    expect(Object.keys(toolConfig("get_container").inputSchema)).toEqual(["type", "id"]);
    expect(Object.keys(toolConfig("get_container_logs").inputSchema)).toEqual(["id"]);
    expect(Object.keys(toolConfig("start_app").inputSchema)).toEqual(["name"]);
    expect(Object.keys(toolConfig("get_logs").inputSchema)).toEqual(["limit", "offset", "level", "category"]);
  });
});
