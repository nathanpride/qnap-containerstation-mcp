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

function capturingFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  let call = 0;
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: (init.headers as Record<string, string>) ?? {},
    });
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

const API = `${BASE_URL}/container-station/api/v1`;
const LOGIN_OK = { status: 200, body: { username: "user", isAdmin: false }, headers: { "set-cookie": "sess=abc123; Path=/" } };

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

  it("omits the query string when no params are given", async () => {
    const fetchMock = mockFetch([{ status: 200, body: [] }]);
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient();
    (client as any).loggedIn = true;
    await client.getLogs();
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/log`);
  });
});

describe("session cookie", () => {
  it("captures the session cookie on login and replays it on later requests", async () => {
    const { fn, calls } = capturingFetch([LOGIN_OK, { status: 200, body: [] }]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await client.listContainers();
    expect(calls[1].headers["Cookie"]).toContain("sess=abc123");
  });

  it("sends no Cookie header before login", async () => {
    const { fn, calls } = capturingFetch([LOGIN_OK, { status: 200, body: [] }]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await client.listContainers();
    expect(calls[0].headers["Cookie"]).toBeUndefined();
  });
});

describe("login failures", () => {
  it("throws with status and body when credentials are rejected", async () => {
    vi.stubGlobal("fetch", mockFetch([{ status: 401, body: { message: "invalid credentials" } }]));
    const client = makeClient();
    await expect(client.login()).rejects.toThrow(/Login failed \(401\)/);
  });
});

describe("logout", () => {
  it("sends PUT /logout and clears the session", async () => {
    const { fn, calls } = capturingFetch([
      LOGIN_OK,
      { status: 200, body: {} },
      { status: 200, body: [] },
    ]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await client.listContainers();
    await client.logout();
    expect(calls[2].method).toBe("PUT");
    expect(calls[2].url).toBe(`${API}/logout`);
    // after logout the next request must log in again
    await client.listContainers();
    expect(calls[3].method).toBe("POST");
    expect(calls[3].url).toBe(`${API}/login`);
  });
});

describe("request retry and error handling", () => {
  it("re-logs in and retries once after a 401", async () => {
    const { fn, calls } = capturingFetch([
      LOGIN_OK,
      { status: 401, body: { message: "session expired" } },
      LOGIN_OK,
      { status: 200, body: [] },
    ]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await expect(client.listContainers()).resolves.toEqual([]);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${API}/login`,
      `GET ${API}/container`,
      `POST ${API}/login`,
      `GET ${API}/container`,
    ]);
  });

  it("throws if the request still fails with 401 after re-login", async () => {
    vi.stubGlobal("fetch", mockFetch([
      LOGIN_OK,
      { status: 401, body: { message: "unauthorized" } },
      LOGIN_OK,
      { status: 401, body: { message: "unauthorized" } },
    ]));
    const client = makeClient();
    await expect(client.listContainers()).rejects.toThrow(/Request failed \(401\)/);
  });

  it("throws a version hint on 404", async () => {
    vi.stubGlobal("fetch", mockFetch([
      LOGIN_OK,
      { status: 404, body: { message: "not found" } },
    ]));
    const client = makeClient();
    await expect(client.listContainers()).rejects.toThrow(/Endpoint not found \(404\)/);
  });

  it("throws with status and body on other errors", async () => {
    vi.stubGlobal("fetch", mockFetch([
      LOGIN_OK,
      { status: 500, body: { message: "internal error" } },
    ]));
    const client = makeClient();
    await expect(client.listContainers()).rejects.toThrow(/Request failed \(500\)/);
  });
});

describe("container endpoints", () => {
  it("getContainer calls the typed path", async () => {
    const { fn, calls } = capturingFetch([LOGIN_OK, { status: 200, body: {} }]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await client.getContainer("docker", "abc123");
    expect(calls[1].url).toBe(`${API}/container/docker/abc123`);
  });

  it("getContainerLogs calls the docker logs path", async () => {
    const { fn, calls } = capturingFetch([LOGIN_OK, { status: 200, body: "log output" }]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    const result = await client.getContainerLogs("abc123");
    expect(calls[1].url).toBe(`${API}/container/docker/abc123/logs`);
    expect(result).toBe("log output");
  });

  it("start/stop/restart use PUT on the action paths", async () => {
    const { fn, calls } = capturingFetch([LOGIN_OK, { status: 200, body: {} }]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await client.startContainer("docker", "abc123");
    await client.stopContainer("docker", "abc123");
    await client.restartContainer("docker", "abc123");
    expect(calls.slice(1).map((c) => `${c.method} ${c.url}`)).toEqual([
      `PUT ${API}/container/docker/abc123/start`,
      `PUT ${API}/container/docker/abc123/stop`,
      `PUT ${API}/container/docker/abc123/restart`,
    ]);
  });

  it("removeContainer uses DELETE", async () => {
    const { fn, calls } = capturingFetch([LOGIN_OK, { status: 200, body: {} }]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await client.removeContainer("docker", "abc123");
    expect(calls[1].method).toBe("DELETE");
    expect(calls[1].url).toBe(`${API}/container/docker/abc123`);
  });
});

describe("app endpoints", () => {
  it("start/stop/restart use PUT on the app action paths", async () => {
    const { fn, calls } = capturingFetch([LOGIN_OK, { status: 200, body: {} }]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await client.startApp("my-app");
    await client.stopApp("my-app");
    await client.restartApp("my-app");
    expect(calls.slice(1).map((c) => `${c.method} ${c.url}`)).toEqual([
      `PUT ${API}/apps/my-app/start`,
      `PUT ${API}/apps/my-app/stop`,
      `PUT ${API}/apps/my-app/restart`,
    ]);
  });
});

describe("system and network endpoints", () => {
  it("getSystemResource calls /system/resource", async () => {
    const resource = { cpu: 10, memory: { total: 1, used: 1, buffers: 0, cached: 0 } };
    const { fn, calls } = capturingFetch([LOGIN_OK, { status: 200, body: resource }]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await expect(client.getSystemResource()).resolves.toEqual(resource);
    expect(calls[1].url).toBe(`${API}/system/resource`);
  });

  it("listNetworks calls /networks", async () => {
    const networks = [{ Name: "bridge", Id: "n1", Driver: "bridge", Scope: "local", Internal: false, IPAM: {}, Options: {} }];
    const { fn, calls } = capturingFetch([LOGIN_OK, { status: 200, body: networks }]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await expect(client.listNetworks()).resolves.toEqual(networks);
    expect(calls[1].url).toBe(`${API}/networks`);
  });
});

describe("path encoding", () => {
  const API = `${BASE_URL}/container-station/api/v1`;

  function capturingFetch() {
    const urls: string[] = [];
    const fn = vi.fn(async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => "",
      };
    });
    return { fn, urls };
  }

  it("percent-encodes container ids", async () => {
    const { fn, urls } = capturingFetch();
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    (client as any).loggedIn = true;
    await client.getContainer("docker", "a b/c?d");
    expect(urls[0]).toBe(`${API}/container/docker/a%20b%2Fc%3Fd`);
  });

  it("percent-encodes app names", async () => {
    const { fn, urls } = capturingFetch();
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    (client as any).loggedIn = true;
    await client.startApp("my app");
    expect(urls[0]).toBe(`${API}/apps/my%20app/start`);
  });

  it("leaves plain ids untouched", async () => {
    const { fn, urls } = capturingFetch();
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    (client as any).loggedIn = true;
    await client.getContainer("docker", "abc123");
    expect(urls[0]).toBe(`${API}/container/docker/abc123`);
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
