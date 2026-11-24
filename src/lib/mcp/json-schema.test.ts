import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { MCP_TOOL_NAME_RE, zodToMcpInputSchema } from "./json-schema.ts";
import { MASTER_TOOL_NAMES } from "./master/catalog.ts";

test("zodToMcpInputSchema emits a root object with properties and no $schema", () => {
  const empty = zodToMcpInputSchema(z.object({}).passthrough());
  assert.equal(empty.type, "object");
  assert.deepEqual(empty.properties, {});
  assert.equal(empty.$schema, undefined);
  assert.equal(empty.additionalProperties, true);

  const filled = zodToMcpInputSchema(z.object({ q: z.string(), n: z.number().int().optional() }));
  assert.equal(filled.type, "object");
  assert.ok(filled.properties && typeof filled.properties === "object");
  assert.deepEqual(Object.keys(filled.properties as object).sort(), ["n", "q"]);
  assert.deepEqual(filled.required, ["q"]);
});

test("every Master catalog name is a legal MCP tool name, and both tool registries use zodToMcpInputSchema", () => {
  for (const name of MASTER_TOOL_NAMES) assert.match(name, MCP_TOOL_NAME_RE, name);
  const master = readFileSync(new URL("./master-tools.server.ts", import.meta.url), "utf8");
  const publisher = readFileSync(new URL("./tools.server.ts", import.meta.url), "utf8");
  const schemaOf = /function schemaOf\(schema: z\.ZodType\): Record<string, unknown> \{\s*return zodToMcpInputSchema\(schema\);\s*\}/;
  assert.match(master, schemaOf);
  assert.match(publisher, schemaOf);
  assert.doesNotMatch(master, /See tool description for fields/);
});
