import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContainerStationClient } from "./client.js";

const BASE_URL = "https://qnap.local";

function makeClient() {
  return new ContainerStationClient({
    baseUrl: BASE_URL,
    username: "user",
    password: "pass",
    verifySSL: false,
  });
}

function mockFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  let call = 0;
  return vi.fn(async () => {
    const r = responses[call++] ?? responses[responses.length - 1];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (h: string) => r.headers?.[h] ?? null },
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    };
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("login", () => {
  it("logs in successfully", async () => {
    const fetchMock = mockFetch([{ status: 200, body: { username: "user", isAdmin: false } }]);
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    await client.login();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/login");
    expect(init.method).toBe("POST");
  });

  it("throws on failed login", async () => {
    vi.stubGlobal("fetch", mockFetch([{ status: 401, body: { code: 1002, message: "unauthorized" } }]));

    await expect(makeClient().login()).rejects.toThrow("Login failed (401)");
  });
});

describe("auto re-login on 401", () => {
  it("re-logs in and retries when a request returns 401", async () => {
    const fetchMock = mockFetch([
      { status: 200, body: { username: "user" } },           // initial login
      { status: 401, body: { code: 1002 } },                 // first attempt → 401
      { status: 200, body: { username: "user" } },           // re-login
      { status: 200, body: [{ id: "abc", name: "test" }] },  // retry succeeds
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    await client.login();
    const containers = await client.listContainers();

    expect(containers).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("listContainers", () => {
  it("returns containers", async () => {
    const containers = [{ id: "abc", name: "my-container", state: "running" }];
    vi.stubGlobal("fetch", mockFetch([
      { status: 200, body: { username: "user" } },
      { status: 200, body: containers },
    ]));

    const client = makeClient();
    const result = await client.listContainers();
    expect(result).toEqual(containers);
  });
});

describe("container actions", () => {
  async function clientWithLogin() {
    vi.stubGlobal("fetch", mockFetch([
      { status: 200, body: { username: "user" } },
      { status: 200, body: {} },
    ]));
    const client = makeClient();
    await client.login();
    return client;
  }

  it("starts a container", async () => {
    const fetchMock = mockFetch([{ status: 200, body: {} }]);
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient();
    (client as any).loggedIn = true;
    await client.startContainer("docker", "abc123");
    expect(fetchMock.mock.calls[0][0]).toContain("/container/docker/abc123/start");
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
  });

  it("stops a container", async () => {
    const fetchMock = mockFetch([{ status: 200, body: {} }]);
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient();
    (client as any).loggedIn = true;
    await client.stopContainer("docker", "abc123");
    expect(fetchMock.mock.calls[0][0]).toContain("/container/docker/abc123/stop");
  });

  it("restarts a container", async () => {
    const fetchMock = mockFetch([{ status: 200, body: {} }]);
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient();
    (client as any).loggedIn = true;
    await client.restartContainer("docker", "abc123");
    expect(fetchMock.mock.calls[0][0]).toContain("/container/docker/abc123/restart");
  });
});

describe("listApps", () => {
  it("returns apps", async () => {
    const apps = { "my-app": { container: ["c1"], yml: true, creating: false } };
    vi.stubGlobal("fetch", mockFetch([
      { status: 200, body: { username: "user" } },
      { status: 200, body: apps },
    ]));
    const client = makeClient();
    const result = await client.listApps();
    expect(result).toEqual(apps);
  });
});

describe("getLogs", () => {
  it("passes query params correctly", async () => {
    const fetchMock = mockFetch([{ status: 200, body: [] }]);
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient();
    (client as any).loggedIn = true;
    await client.getLogs({ limit: 10, level: "ERROR", category: "container" });
    expect(fetchMock.mock.calls[0][0]).toContain("limit=10");
    expect(fetchMock.mock.calls[0][0]).toContain("level=ERROR");
    expect(fetchMock.mock.calls[0][0]).toContain("category=container");
  });
});

describe("TLS verification scoping", () => {
  function initCapturingFetch() {
    const inits: RequestInit[] = [];
    const fn = vi.fn(async (_url: string, init: RequestInit = {}) => {
      inits.push(init);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [],
        text: async () => "",
      };
    });
    return { fn, inits };
  }

  it("passes an undici dispatcher when verifySSL is false", async () => {
    const { fn, inits } = initCapturingFetch();
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    (client as any).loggedIn = true;
    await client.listContainers();
    expect((inits[0] as any).dispatcher).toBeDefined();
  });

  it("passes no dispatcher when verifySSL is true", async () => {
    const { fn, inits } = initCapturingFetch();
    vi.stubGlobal("fetch", fn);
    const client = new ContainerStationClient({
      baseUrl: BASE_URL,
      username: "user",
      password: "pass",
      verifySSL: true,
    });
    (client as any).loggedIn = true;
    await client.listContainers();
    expect((inits[0] as any).dispatcher).toBeUndefined();
  });

  it("does not touch NODE_TLS_REJECT_UNAUTHORIZED", async () => {
    const saved = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    try {
      const { fn } = initCapturingFetch();
      vi.stubGlobal("fetch", fn);
      const client = makeClient();
      (client as any).loggedIn = true;
      await client.listContainers();
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = saved;
    }
  });
});
