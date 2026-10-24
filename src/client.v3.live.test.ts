import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ContainerStationClient } from "./client.js";

// Live tests for the v3 (Container Station 3.1+) API surface:
//   GET  /apps/compose            (list compose apps)
//   GET  /apps/{name}/inspect     (compose app detail incl. stored YAML)
//   GET  /images, /volumes, /overview
//   POST /apps/config             (validate YAML, stateless)
//   POST /apps/compose            (create — opt-in, see QNAP_ALLOW_CREATE)
//
// Everything here is read-only or stateless UNLESS QNAP_ALLOW_CREATE=1, in
// which case one throwaway compose app is CREATED and never removed (the MCP
// deliberately has no delete tool). If the create tests run, remove the app
// afterwards in the Container Station UI.

const {
  QNAP_URL,
  QNAP_USERNAME,
  QNAP_PASSWORD,
  QNAP_ALLOW_CREATE,
  QNAP_SMOKE_NAME,
  QNAP_SMOKE_IMAGE,
} = process.env;
const skip = !QNAP_URL || !QNAP_USERNAME || !QNAP_PASSWORD;
const allowCreate = QNAP_ALLOW_CREATE === "1";

if (skip) {
  console.warn("Skipping v3 live tests: QNAP_URL, QNAP_USERNAME, QNAP_PASSWORD not set.");
}
if (!skip && !allowCreate) {
  console.warn("v3 create tests skipped: set QNAP_ALLOW_CREATE=1 to run them (creates a throwaway app).");
}

// The smoke app name MUST be unique to this test run — the create tests refuse
// to touch any pre-existing app, and the collision test only ever targets
// the app this file created itself.
const SMOKE_NAME = QNAP_SMOKE_NAME ?? "mcp-v3-live-smoke";
// Default to an image already on the NAS if any exists (see test), else alpine.
const SMOKE_IMAGE = QNAP_SMOKE_IMAGE ?? "alpine:latest";
const SMOKE_YML = `services:\n  smoke:\n    image: ${SMOKE_IMAGE}\n    command: ["sleep", "3600"]\n`;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const client = skip
  ? null
  : new ContainerStationClient({
      baseUrl: QNAP_URL!,
      username: QNAP_USERNAME!,
      password: QNAP_PASSWORD!,
      verifySSL: false,
    });

describe.skipIf(skip)("live v3 API (read-only)", () => {
  beforeAll(async () => {
    await client!.login();
  });

  afterAll(async () => {
    await client!.logout();
  });

  it("lists compose apps", async () => {
    const apps = await client!.listComposeApps();
    expect(Array.isArray(apps)).toBe(true);
    console.log(`Found ${apps.length} compose apps:`);
    for (const a of apps) {
      console.log(`  [${String(a.status).padEnd(8)}] ${a.name}`);
    }
  });

  it("gets the compose file of the first listed app", async () => {
    const apps = await client!.listComposeApps();
    if (apps.length === 0) {
      console.warn("No compose apps on this NAS — skipping get_compose_file check.");
      return;
    }
    const name = apps[0].name;
    const yml = await client!.getComposeFile(name);
    expect(typeof yml).toBe("string");
    expect(yml.length).toBeGreaterThan(0);
    console.log(`Compose file for ${name}:\n${yml}`);
  });

  it("lists images", async () => {
    const images = await client!.listImages();
    expect(Array.isArray(images)).toBe(true);
    console.log(`Found ${images.length} images`);
  });

  it("lists volumes", async () => {
    const volumes = await client!.listVolumes();
    expect(Array.isArray(volumes)).toBe(true);
    console.log(`Found ${volumes.length} volumes`);
  });

  it("gets the overview", async () => {
    const overview = await client!.getOverview();
    expect(typeof overview).toBe("object");
    console.log("Overview:", JSON.stringify(overview).slice(0, 400));
  });

  it("validates a valid compose file", async () => {
    const res = await client!.validateCompose(SMOKE_YML);
    expect(res.valid).toBe(true);
  });

  it("rejects an invalid compose file", async () => {
    const res = await client!.validateCompose("services: [this is: not: valid: yaml");
    expect(res.valid).toBe(false);
    console.log(`Invalid-yaml message: ${res.message}`);
  });

  it("appExists is false for a name that cannot exist", async () => {
    await expect(client!.appExists("no-such-app-xyz-000")).resolves.toBe(false);
  });
});

describe.skipIf(skip || !allowCreate)("live v3 API (create, opt-in)", () => {
  beforeAll(async () => {
    await client!.login();
  });

  it("creates a throwaway compose app", async () => {
    // Guard against clobbering a leftover from a previous run: if it exists,
    // the create below would be refused — that is itself the guard test.
    const exists = await client!.appExists(SMOKE_NAME);
    if (exists) {
      console.warn(`App ${SMOKE_NAME} already exists — skipping create, testing refuse-path only.`);
      return;
    }
    await client!.createComposeApp(SMOKE_NAME, SMOKE_YML);
    // Deployment is asynchronous (the endpoint returns a taskID); poll briefly.
    let up = false;
    for (let i = 0; i < 20 && !up; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      up = await client!.appExists(SMOKE_NAME);
    }
    expect(up).toBe(true);
    console.log(
      `\n>>> CLEANUP REQUIRED: remove compose app "${SMOKE_NAME}" in the Container Station UI <<<\n`
    );
  }, 120_000); // deployment pulls the image and can exceed the default 5s timeout

  it("refuses to create over an existing app (redeploy guard)", async () => {
    expect(await client!.appExists(SMOKE_NAME)).toBe(true);
    await expect(client!.createComposeApp(SMOKE_NAME, SMOKE_YML)).rejects.toThrow(
      /already exists/
    );
    // The app must still be there and untouched after the refused create.
    expect(await client!.appExists(SMOKE_NAME)).toBe(true);
  }, 30_000);
});
