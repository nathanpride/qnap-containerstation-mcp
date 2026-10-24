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
}
