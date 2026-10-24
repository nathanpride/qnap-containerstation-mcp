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

describe("compose apps (v3)", () => {
  const V3 = `${BASE_URL}/container-station/api/v3`;
  const LOGIN = { status: 200, body: { username: "user" }, headers: { "set-cookie": "CS_SESS_ID=xyz789; Path=/" } };

  it("listComposeApps unwraps data.items", async () => {
    const fetchMock = mockFetch([
      LOGIN,
      { status: 200, body: { data: { items: [{ name: "monitoring", status: "running" }] } } },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient();
    const apps = await client.listComposeApps();
    expect(apps).toHaveLength(1);
    expect(apps[0].name).toBe("monitoring");
    expect(fetchMock.mock.calls[1][0]).toBe(`${V3}/apps/compose`);
  });

  it("listComposeApps returns an empty list when the response has no items", async () => {
    const fetchMock = mockFetch([LOGIN, { status: 200, body: {} }]);
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient();
    await expect(client.listComposeApps()).resolves.toEqual([]);
  });

  it("getComposeFile returns the yml field and encodes the app name", async () => {
    const fetchMock = mockFetch([
      LOGIN,
      { status: 200, body: { data: { yml: "services: {}" } } },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient();
    await expect(client.getComposeFile("my app")).resolves.toBe("services: {}");
    expect(fetchMock.mock.calls[1][0]).toBe(`${V3}/apps/my%20app/inspect`);
  });

  it("getComposeFile throws when the response has no yml", async () => {
    const fetchMock = mockFetch([LOGIN, { status: 200, body: { data: {} } }]);
    vi.stubGlobal("fetch", fetchMock);
    const client = makeClient();
    await expect(client.getComposeFile("monitoring")).rejects.toThrow(/No compose YAML available/);
  });
});

describe("v3 read-only + create/validate", () => {
  const V3 = `${BASE_URL}/container-station/api/v3`;
  const LOGIN = { status: 200, body: { username: "user" }, headers: { "set-cookie": "CS_SESS_ID=xyz789; Path=/" } };

  function recordingFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    let call = 0;
    const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body as string | undefined });
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

  it("listImages GETs /images and unwraps items", async () => {
    const { fn, calls } = recordingFetch([LOGIN, { status: 200, body: { data: { items: [{ id: "sha256:abc", tags: ["nginx"] }] } } }]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    const imgs = await client.listImages();
    expect(calls[1].url).toBe(`${V3}/images`);
    expect(imgs).toEqual([{ id: "sha256:abc", tags: ["nginx"] }]);
  });

  it("listVolumes GETs /volumes and unwraps items", async () => {
    const { fn, calls } = recordingFetch([LOGIN, { status: 200, body: { data: { items: [{ name: "gitea_data", driver: "local" }] } } }]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    const vols = await client.listVolumes();
    expect(calls[1].url).toBe(`${V3}/volumes`);
    expect(vols[0].name).toBe("gitea_data");
  });

  it("getOverview GETs /overview", async () => {
    const { fn, calls } = recordingFetch([LOGIN, { status: 200, body: { data: { apps: [{ name: "gitea", status: "running" }] } } }]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    const ov = await client.getOverview();
    expect(calls[1].url).toBe(`${V3}/overview`);
    expect(ov).toEqual({ apps: [{ name: "gitea", status: "running" }] });
  });

  it("validateCompose POSTs {yml} to /apps/config and returns valid on 200", async () => {
    const { fn, calls } = recordingFetch([LOGIN, { status: 200, body: { data: {} } }]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    const res = await client.validateCompose("services: {}");
    expect(calls[1].method).toBe("POST");
    expect(calls[1].url).toBe(`${V3}/apps/config`);
    expect(JSON.parse(calls[1].body!)).toEqual({ yml: "services: {}" });
    expect(res).toEqual({ valid: true });
  });

  it("validateCompose returns the server message on an invalid document", async () => {
    const { fn } = recordingFetch([
      LOGIN,
      { status: 500, body: { code: 1004, message: "validate compose config failed: yaml: line 2: bad" } },
    ]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    const res = await client.validateCompose("bad: [");
    expect(res.valid).toBe(false);
    expect(res.message).toMatch(/yaml: line 2/);
  });

  it("createComposeApp POSTs name, yml and operation:create to /apps/compose", async () => {
    const { fn, calls } = recordingFetch([
      LOGIN,
      { status: 404, body: { code: 1009, message: "cannot find compose" } },
      { status: 200, body: { data: {} } },
    ]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await client.createComposeApp("myapp", "services: {}");
    expect(calls[1].url).toBe(`${V3}/apps/myapp/inspect`);
    expect(calls[2].method).toBe("POST");
    expect(calls[2].url).toBe(`${V3}/apps/compose`);
    expect(JSON.parse(calls[2].body!)).toEqual({ name: "myapp", yml: "services: {}", operation: "create" });
  });

  it("createComposeApp refuses to redeploy an existing app", async () => {
    const { fn, calls } = recordingFetch([
      LOGIN,
      { status: 200, body: { data: { yml: "services: {}" } } },
    ]);
    vi.stubGlobal("fetch", fn);
    const client = makeClient();
    await expect(client.createComposeApp("myapp", "services: {}")).rejects.toThrow(/already exists/);
    // only the existence check ran — no POST was sent
    expect(calls).toHaveLength(2);
    expect(calls[1].method).toBe("GET");
  });

  it("appExists returns true on 200 and false on 404", async () => {
    vi.stubGlobal("fetch", mockFetch([LOGIN, { status: 200, body: { data: { yml: "x" } } }]));
    await expect(makeClient().appExists("a")).resolves.toBe(true);
    vi.stubGlobal("fetch", mockFetch([LOGIN, { status: 404, body: { code: 1009 } }]));
    await expect(makeClient().appExists("b")).resolves.toBe(false);
  });

  it("createComposeApp surfaces a server error (e.g. invalid yaml)", async () => {
    vi.stubGlobal("fetch", mockFetch([
      LOGIN,
      { status: 404, body: { code: 1009, message: "cannot find compose" } },
      { status: 400, body: { code: 2001, message: "invalid compose config" } },
    ]));
    const client = makeClient();
    await expect(client.createComposeApp("app", "bad")).rejects.toThrow(/invalid compose config/);
  });
});
