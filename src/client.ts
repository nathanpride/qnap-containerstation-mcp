import { CookieJar } from "tough-cookie";

export interface Container {
  id: string;
  name: string;
  image: string;
  imageID: string;
  type: string;
  runtime: string;
  project: string;
  projectPath: string;
  privileged: boolean;
  networkMode: string;
  state: string;
  externalIP: string;
  tcpPort: unknown[];
}

export interface App {
  [name: string]: {
    container: string[];
    yml: boolean;
    creating: boolean;
  };
}

export interface SystemResource {
  cpu: number;
  memory: {
    total: number;
    used: number;
    buffers: number;
    cached: number;
  };
}

export interface Network {
  Name: string;
  Id: string;
  Driver: string;
  Scope: string;
  Internal: boolean;
  IPAM: unknown;
  Options: unknown;
}

export interface LogEntry {
  id: string;
  category: string;
  level: string;
  message: string;
  timestamp: string;
  user: string;
}

export interface ComposeAppSummary {
  name: string;
  status: string;
  type: string;
  containers: number;
  defaultURL: string;
  created: string;
  [key: string]: unknown;
}

export interface ComposeAppInspect {
  yml?: string;
  containers?: unknown[];
  [key: string]: unknown;
}

export interface V3Image {
  id: string;
  type?: string;
  tags?: string[];
  repoDigests?: string[];
  size?: number;
  created?: string | number;
  [key: string]: unknown;
}

export interface V3Volume {
  name: string;
  driver?: string;
  mountPoint?: string;
  project?: string;
  used?: boolean;
  size?: number;
  created?: string;
  [key: string]: unknown;
}

export interface ContainerStationClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  verifySSL?: boolean;
}

export class ContainerStationClient {
  private baseUrl: string;
  private v3BaseUrl: string;
  private username: string;
  private password: string;
  private verifySSL: boolean;
  private cookieJar: CookieJar;
  private loggedIn = false;

  constructor(options: ContainerStationClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "") + "/container-station/api/v1";
    // Container Station 3.1+ also exposes an undocumented v3 API, used by its
    // own web UI. It shares the session established by the v1 login: the v1
    // session cookie value is accepted as a Bearer token on v3 endpoints.
    this.v3BaseUrl = this.baseUrl.replace(/\/v1$/, "/v3");
    this.username = options.username;
    this.password = options.password;
    this.verifySSL = options.verifySSL ?? true;
    this.cookieJar = new CookieJar();
  }

  private async fetch(path: string, init: RequestInit = {}, base: string = this.baseUrl): Promise<Response> {
    const url = `${base}${path}`;
    const cookieString = await this.cookieJar.getCookieString(url);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> ?? {}),
    };
    if (cookieString) headers["Cookie"] = cookieString;

    if (!this.verifySSL) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }

    const response = await fetch(url, { ...init, headers });

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      await this.cookieJar.setCookie(setCookie, url);
    }

    return response;
  }

  async login(): Promise<void> {
    const response = await this.fetch("/login", {
      method: "POST",
      body: JSON.stringify({ username: this.username, password: this.password }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Login failed (${response.status}): ${body}`);
    }

    this.loggedIn = true;
  }

  async logout(): Promise<void> {
    await this.fetch("/logout", { method: "PUT" });
    this.loggedIn = false;
    this.cookieJar = new CookieJar();
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.loggedIn) await this.login();

    let response = await this.fetch(path, init);

    if (response.status === 401) {
      this.loggedIn = false;
      await this.login();
      response = await this.fetch(path, init);
    }

    if (response.status === 404) {
      throw new Error(`Endpoint not found (404): ${path} — this may not be supported by your Container Station version`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Request failed (${response.status}): ${body}`);
    }

    return response.json() as Promise<T>;
  }

  private async sessionToken(): Promise<string> {
    const cookies = await this.cookieJar.getCookies(this.baseUrl);
    const session = cookies.find((c) => c.key === "CS_SESS_ID") ?? cookies[0];
    if (!session) {
      throw new Error("Container Station login did not return a session cookie");
    }
    return session.value;
  }

  // Same semantics as request(), but against the v3 API: the v1 session id
  // is sent as a Bearer token instead of a cookie.
  private async requestV3<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.loggedIn) await this.login();

    const send = async () => {
      const token = await this.sessionToken();
      return this.fetch(path, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> ?? {}) },
      }, this.v3BaseUrl);
    };

    let response = await send();

    if (response.status === 401) {
      this.loggedIn = false;
      await this.login();
      response = await send();
    }

    if (response.status === 404) {
      throw new Error(`Endpoint not found (404): ${path} — this may not be supported by your Container Station version`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Request failed (${response.status}): ${body}`);
    }

    return response.json() as Promise<T>;
  }

  async listContainers(): Promise<Container[]> {
    return this.request<Container[]>("/container");
  }

  async getContainer(type: string, id: string): Promise<Container> {
    return this.request<Container>(`/container/${type}/${id}`);
  }

  async getContainerLogs(id: string): Promise<string> {
    return this.request<string>(`/container/docker/${id}/logs`);
  }

  async startContainer(type: string, id: string): Promise<void> {
    await this.request(`/container/${type}/${id}/start`, { method: "PUT" });
  }

  async stopContainer(type: string, id: string): Promise<void> {
    await this.request(`/container/${type}/${id}/stop`, { method: "PUT" });
  }

  async restartContainer(type: string, id: string): Promise<void> {
    await this.request(`/container/${type}/${id}/restart`, { method: "PUT" });
  }

  async removeContainer(type: string, id: string): Promise<void> {
    await this.request(`/container/${type}/${id}`, { method: "DELETE" });
  }

  async listApps(): Promise<App> {
    return this.request<App>("/apps");
  }

  async startApp(name: string): Promise<void> {
    await this.request(`/apps/${name}/start`, { method: "PUT" });
  }

  async stopApp(name: string): Promise<void> {
    await this.request(`/apps/${name}/stop`, { method: "PUT" });
  }

  async restartApp(name: string): Promise<void> {
    await this.request(`/apps/${name}/restart`, { method: "PUT" });
  }

  async getSystemResource(): Promise<SystemResource> {
    return this.request<SystemResource>("/system/resource");
  }

  async listNetworks(): Promise<Network[]> {
    return this.request<Network[]>("/networks");
  }

  async getLogs(params?: {
    limit?: number;
    offset?: number;
    level?: "INFO" | "WARN" | "ERROR";
    category?: string;
  }): Promise<LogEntry[]> {
    const qs = new URLSearchParams();
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    if (params?.offset !== undefined) qs.set("offset", String(params.offset));
    if (params?.level) qs.set("level", params.level);
    if (params?.category) qs.set("category", params.category);
    const query = qs.toString() ? `?${qs}` : "";
    return this.request<LogEntry[]>(`/log${query}`);
  }

  // The two methods below use the v3 API (Container Station 3.1+). The
  // endpoints are not documented and may differ between versions.

  async listComposeApps(): Promise<ComposeAppSummary[]> {
    const res = await this.requestV3<{ data?: { items?: ComposeAppSummary[] } }>("/apps/compose");
    return res.data?.items ?? [];
  }

  async getComposeFile(name: string): Promise<string> {
    const res = await this.requestV3<{ data?: ComposeAppInspect }>(`/apps/${encodeURIComponent(name)}/inspect`);
    const yml = res.data?.yml;
    if (!yml) {
      throw new Error(`No compose YAML available for application "${name}"`);
    }
    return yml;
  }

  async listImages(): Promise<V3Image[]> {
    const res = await this.requestV3<{ data?: { items?: V3Image[] } }>("/images");
    return res.data?.items ?? [];
  }

  async listVolumes(): Promise<V3Volume[]> {
    const res = await this.requestV3<{ data?: { items?: V3Volume[] } }>("/volumes");
    return res.data?.items ?? [];
  }

  async getOverview(): Promise<Record<string, unknown>> {
    const res = await this.requestV3<{ data?: Record<string, unknown> }>("/overview");
    return res.data ?? {};
  }

  // POST /apps/config is the validator the Container Station UI itself uses:
  // 200 means the YAML is deployable; an invalid document comes back as
  // 500 with {code, message}. The message is returned, not thrown, so the
  // caller can show it to the user as feedback rather than an error.
  async validateCompose(yml: string): Promise<{ valid: boolean; message?: string }> {
    try {
      await this.requestV3("/apps/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yml }),
      });
      return { valid: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const m = msg.match(/^Request failed \(\d+\): (.*)$/s);
      if (m) {
        try {
          const parsed = JSON.parse(m[1]);
          if (typeof parsed?.message === "string") {
            return { valid: false, message: parsed.message.trim() };
          }
        } catch {
          // body was not the expected JSON — surface the original error
        }
      }
      throw err;
    }
  }

  // GET /apps/{name}/inspect answers 200 for an existing compose app and
  // 404 {code:1009,"cannot find compose"} for a missing one — a clean
  // existence signal. A 404 here can also mean the endpoint is absent on
  // older Container Station versions; callers treat that as "not found"
  // and let the subsequent request surface the real error.
  async appExists(name: string): Promise<boolean> {
    try {
      await this.requestV3<{ data?: ComposeAppInspect }>(`/apps/${encodeURIComponent(name)}/inspect`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Endpoint not found (404)")) return false;
      throw err;
    }
  }

  // operation:"create" is what the UI sends; the same endpoint also accepts
  // "recreate"/"duplicate", which this client deliberately never sends.
  // Verified live: POST /apps/compose with an EXISTING name does not fail —
  // it runs compose-up again, i.e. it would redeploy the running app. The
  // existence check below makes this method strictly create-only.
  async createComposeApp(name: string, yml: string): Promise<void> {
    if (await this.appExists(name)) {
      throw new Error(
        `Compose app "${name}" already exists — refusing to redeploy it (create is non-destructive)`
      );
    }
    await this.requestV3("/apps/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, yml, operation: "create" }),
    });
  }
}
