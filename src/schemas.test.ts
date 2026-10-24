import { describe, it, expect } from "vitest";
import { appNameSchema, containerIdSchema, containerTypeSchema } from "./schemas.js";

describe("containerTypeSchema", () => {
  it("accepts the container types supported by the API", () => {
    for (const type of ["docker", "lxc", "lxd"]) {
      expect(containerTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects unknown types", () => {
    expect(containerTypeSchema.safeParse("podman").success).toBe(false);
    expect(containerTypeSchema.safeParse("").success).toBe(false);
    expect(containerTypeSchema.safeParse("DOCKER").success).toBe(false);
  });
});

describe("containerIdSchema", () => {
  it("accepts a non-empty id", () => {
    expect(containerIdSchema.safeParse("abc123").success).toBe(true);
  });

  it("rejects an empty id", () => {
    expect(containerIdSchema.safeParse("").success).toBe(false);
  });
});

describe("appNameSchema", () => {
  it("accepts a non-empty name", () => {
    expect(appNameSchema.safeParse("my-app").success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(appNameSchema.safeParse("").success).toBe(false);
  });
});
