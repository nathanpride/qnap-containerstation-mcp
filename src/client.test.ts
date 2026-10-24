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

describe("v3 bridge", () => {
  const V3 = `${BASE_URL}/container-station/api/v3`;
  const LOGIN = { status: 200, body: { username: "user" }, headers: { "set-cookie": "CS_SESS_ID=xyz789; Path=/" } };

  function capturingFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    let call = 0;
    const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, headers: (init.headers as Record<string, string>) ?? {} });
      const r = responses[call++] ?? responses[responses.length - 1];
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: { get: (h: string) => r.headers?.[h] ?? null },
        json: async () => r.body,
        text: async () => JSON.stringify(r.body),
      };
    });
    return { fn, calls };
  }

  it("sends the v1 session id as a Bearer token to the v3 base URL", async () => {
    const { fn, calls } = capturingFetch([LOGIN, { status: 200, body: { data: {} } }]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await (client as any).requestV3("/apps/compose");
    expect(calls[1].url).toBe(`${V3}/apps/compose`);
    expect(calls[1].headers["Authorization"]).toBe("Bearer xyz789");
  });

  it("re-logs in and retries once after a 401", async () => {
    const { fn, calls } = capturingFetch([
      LOGIN,
      { status: 401, body: { message: "unauthorized" } },
      LOGIN,
      { status: 200, body: { data: {} } },
    ]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await expect((client as any).requestV3("/apps/compose")).resolves.toEqual({ data: {} });
    expect(calls).toHaveLength(4);
  });

  it("throws a version hint on 404", async () => {
    vi.stubGlobal("fetch", mockFetch([LOGIN, { status: 404, body: { message: "not found" } }]));
    const client = makeClient();
    await expect((client as any).requestV3("/apps/x/inspect")).rejects.toThrow(/Endpoint not found \(404\)/);
  });

  it("falls back to the first cookie when CS_SESS_ID is absent", async () => {
    const { fn, calls } = capturingFetch([
      { status: 200, body: { username: "user" }, headers: { "set-cookie": "OTHER_COOKIE=abc; Path=/" } },
      { status: 200, body: { data: {} } },
    ]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await (client as any).requestV3("/apps/compose");
    expect(calls[1].headers["Authorization"]).toBe("Bearer abc");
  });

  it("throws when login returned no session cookie", async () => {
    vi.stubGlobal("fetch", mockFetch([{ status: 200, body: { username: "user" } }]));
    const client = makeClient();
    await expect((client as any).requestV3("/apps/compose")).rejects.toThrow(/did not return a session cookie/);
  });
});
