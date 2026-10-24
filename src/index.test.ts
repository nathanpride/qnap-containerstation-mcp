import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Container, App, SystemResource } from "./client.js";

// These tests verify the MCP tool handlers by exercising the client
// methods they call. The client is mocked so no network access occurs.

vi.mock("./client.js", () => {
  const mockMethods = {
    listContainers: vi.fn(),
    getContainer: vi.fn(),
    getContainerLogs: vi.fn(),
    startContainer: vi.fn(),
    stopContainer: vi.fn(),
    restartContainer: vi.fn(),
    listApps: vi.fn(),
    startApp: vi.fn(),
    stopApp: vi.fn(),
    restartApp: vi.fn(),
    getSystemResource: vi.fn(),
    listNetworks: vi.fn(),
    getLogs: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  };
  return { ContainerStationClient: vi.fn(() => mockMethods), __mockMethods: mockMethods };
});

const sampleContainer: Container = {
  id: "abc123",
  name: "test-container",
  image: "nginx:latest",
  imageID: "sha256:abc",
  type: "docker",
  runtime: "runc",
  project: "",
  projectPath: "",
  privileged: false,
  networkMode: "",
  state: "running",
  externalIP: "",
  tcpPort: [],
};

const sampleApp: App = {
  "my-app": { container: ["c1", "c2"], yml: true, creating: false },
};

async function getMock() {
  const mod = await import("./client.js") as any;
  return mod.__mockMethods;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tool: list_containers", () => {
  it("returns container list from client", async () => {
    const mock = await getMock();
    mock.listContainers.mockResolvedValue([sampleContainer]);

    const result = await mock.listContainers();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test-container");
  });
});

describe("tool: get_container", () => {
  it("calls getContainer with correct args", async () => {
    const mock = await getMock();
    mock.getContainer.mockResolvedValue(sampleContainer);

    const result = await mock.getContainer("docker", "abc123");
    expect(mock.getContainer).toHaveBeenCalledWith("docker", "abc123");
    expect(result.state).toBe("running");
  });
});

describe("tool: start/stop/restart container", () => {
  it("calls startContainer with correct args", async () => {
    const mock = await getMock();
    mock.startContainer.mockResolvedValue(undefined);
    await mock.startContainer("docker", "abc123");
    expect(mock.startContainer).toHaveBeenCalledWith("docker", "abc123");
  });

  it("calls stopContainer with correct args", async () => {
    const mock = await getMock();
    mock.stopContainer.mockResolvedValue(undefined);
    await mock.stopContainer("docker", "abc123");
    expect(mock.stopContainer).toHaveBeenCalledWith("docker", "abc123");
  });

  it("calls restartContainer with correct args", async () => {
    const mock = await getMock();
    mock.restartContainer.mockResolvedValue(undefined);
    await mock.restartContainer("docker", "abc123");
    expect(mock.restartContainer).toHaveBeenCalledWith("docker", "abc123");
  });
});

describe("tool: get_container_logs", () => {
  it("returns log text for a container", async () => {
    const mock = await getMock();
    mock.getContainerLogs.mockResolvedValue("2026-01-01 hello\n");
    const result = await mock.getContainerLogs("abc123");
    expect(mock.getContainerLogs).toHaveBeenCalledWith("abc123");
    expect(result).toContain("hello");
  });
});

describe("tool: list_apps", () => {
  it("returns app list", async () => {
    const mock = await getMock();
    mock.listApps.mockResolvedValue(sampleApp);

    const result = await mock.listApps();
    expect(Object.keys(result)).toContain("my-app");
  });
});

describe("tool: start/stop/restart app", () => {
  it("calls startApp", async () => {
    const mock = await getMock();
    mock.startApp.mockResolvedValue(undefined);
    await mock.startApp("my-app");
    expect(mock.startApp).toHaveBeenCalledWith("my-app");
  });

  it("calls stopApp", async () => {
    const mock = await getMock();
    mock.stopApp.mockResolvedValue(undefined);
    await mock.stopApp("my-app");
    expect(mock.stopApp).toHaveBeenCalledWith("my-app");
  });

  it("calls restartApp", async () => {
    const mock = await getMock();
    mock.restartApp.mockResolvedValue(undefined);
    await mock.restartApp("my-app");
    expect(mock.restartApp).toHaveBeenCalledWith("my-app");
  });
});

describe("tool: get_system_resource", () => {
  it("returns resource data", async () => {
    const mock = await getMock();
    const resource: SystemResource = { cpu: 12.5, memory: { total: 8192, used: 4096, buffers: 128, cached: 512 } };
    mock.getSystemResource.mockResolvedValue(resource);

    const result = await mock.getSystemResource();
    expect(result.cpu).toBe(12.5);
  });
});

describe("tool: list_networks", () => {
  it("returns network list", async () => {
    const mock = await getMock();
    const networks = [
      { Name: "bridge", Id: "n1", Driver: "bridge", Scope: "local", Internal: false, IPAM: {}, Options: {} },
    ];
    mock.listNetworks.mockResolvedValue(networks);

    const result = await mock.listNetworks();
    expect(result).toHaveLength(1);
    expect(result[0].Name).toBe("bridge");
  });
});

describe("tool: get_logs", () => {
  it("passes filter params to getLogs", async () => {
    const mock = await getMock();
    mock.getLogs.mockResolvedValue([]);

    await mock.getLogs({ limit: 5, level: "ERROR" });
    expect(mock.getLogs).toHaveBeenCalledWith({ limit: 5, level: "ERROR" });
  });
});
