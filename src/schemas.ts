import { z } from "zod";

// Shared input schemas for the MCP tools. Container types accepted by the
// Container Station API; anything else is rejected before a request is made.
export const containerTypeSchema = z
  .enum(["docker", "lxc", "lxd"])
  .describe("Container type: docker, lxc, or lxd");

export const containerIdSchema = z
  .string()
  .min(1)
  .describe("Container ID");

export const appNameSchema = z
  .string()
  .min(1)
  .describe("Application name");
