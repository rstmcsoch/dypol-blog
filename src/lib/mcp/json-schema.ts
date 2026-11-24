import { z } from "zod";

/**
 * Convert a Zod input schema into the JSON Schema object MCP tool listings
 * require: root `type` is `"object"`, `properties` is always present, and
 * `$schema` is omitted (clients default to JSON Schema 2020-12).
 */
export function zodToMcpInputSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  if (json.type !== "object") json.type = "object";
  if (!json.properties || typeof json.properties !== "object" || Array.isArray(json.properties)) {
    json.properties = {};
  }
  // `additionalProperties: {}` is valid 2020-12 ("any") but some clients treat
  // an empty schema object as invalid. `true` is the equivalent and widely accepted.
  if (json.additionalProperties && typeof json.additionalProperties === "object" && !Array.isArray(json.additionalProperties) && Object.keys(json.additionalProperties as object).length === 0) {
    json.additionalProperties = true;
  }
  return json;
}

/** MCP tool names: 1–64 chars, letters, digits, underscore, hyphen. */
export const MCP_TOOL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
