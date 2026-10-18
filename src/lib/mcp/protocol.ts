/**
 * Minimal stateless MCP server over Streamable HTTP (JSON responses, no SSE).
 * Implements: initialize, notifications/*, ping, tools/list, tools/call.
 * Spec: https://modelcontextprotocol.io/specification (2025-06-18; also
 * answers 2025-03-26 and 2024-11-05 clients).
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "dypol-blog", title: "DYPOL Blog automation", version: "1.0.0" };

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string; data?: unknown };

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: unknown) => Promise<ToolResult>;
};

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: Record<string, unknown> };

export const RPC = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603 };

function error(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

function result(id: JsonRpcId, value: unknown) {
  return { jsonrpc: "2.0" as const, id, result: value };
}

function isRequest(value: unknown): value is JsonRpcRequest {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (value as { method?: unknown }).method === "string"
  );
}

export const SERVER_INSTRUCTIONS =
  "Tools for drafting DYPOL Blog articles. Call get_blog_settings first, then list_recent_articles to avoid " +
  "repeating topics. Submit with submit_article_draft (always include source_urls you actually read and a stable " +
  "idempotency_key). Pick one run_id per execution and pass it on submit/publish calls: the owner's per-run " +
  "and whole-website daily publish caps count every publish (automatic or explicit). Publishing only happens " +
  "through publish_article_if_allowed when the owner's policy allows it; otherwise the piece stays a draft. " +
  "If nothing is good enough, call record_run_result with outcome 'skipped'.";

async function handleOne(message: unknown, tools: ToolDefinition[]): Promise<object | null> {
  if (!isRequest(message)) return error(null, RPC.INVALID_REQUEST, "Invalid JSON-RPC request.");
  const id = message.id ?? null;
  const isNotification = message.id === undefined;
  if (isNotification) return null; // notifications/initialized, cancelled, ... -> no response

  switch (message.method) {
    case "initialize": {
      const requested = String(message.params?.protocolVersion ?? "");
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
      return result(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, {
        tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          ...(annotations ? { annotations } : {}),
        })),
      });
    case "tools/call": {
      const name = message.params?.name;
      const tool = tools.find((t) => t.name === name);
      if (!tool) return error(id, RPC.INVALID_PARAMS, `Unknown tool: ${String(name)}`);
      const args = message.params?.arguments ?? {};
      try {
        const outcome = await tool.run(args);
        const payload = outcome.ok ? outcome.data : { error: outcome.error, ...(outcome.data ? { details: outcome.data } : {}) };
        return result(id, {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
          isError: !outcome.ok,
        });
      } catch (caught) {
        console.error(`[mcp] tool ${tool.name} failed`, caught instanceof Error ? caught.message : "unknown error");
        return result(id, {
          content: [{ type: "text", text: JSON.stringify({ error: "The tool failed on the server. Nothing was published." }) }],
          isError: true,
        });
      }
    }
    default:
      return error(id, RPC.METHOD_NOT_FOUND, `Method not found: ${message.method}`);
  }
}

/** Returns the JSON body to send, or null when only notifications were received (HTTP 202). */
export async function handleRpc(body: unknown, tools: ToolDefinition[]): Promise<object | object[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) return error(null, RPC.INVALID_REQUEST, "Batch must have 1-20 messages.");
    const replies = (await Promise.all(body.map((m) => handleOne(m, tools)))).filter((r): r is object => r !== null);
    return replies.length ? replies : null;
  }
  return handleOne(body, tools);
}
