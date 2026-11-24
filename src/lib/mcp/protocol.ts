/**
 * Stateless MCP server over Streamable HTTP. Dual-era:
 *   - Legacy handshake: initialize, notifications/*, ping, tools/list, tools/call
 *     (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05).
 *   - Modern per-request metadata (2026-07-28): server/discover, tools/list,
 *     tools/call, ping. No session, no initialize required.
 * Spec: https://modelcontextprotocol.io/specification
 */
export const MODERN_PROTOCOL_VERSION = "2026-07-28";
export const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
export const SUPPORTED_PROTOCOL_VERSIONS = [
  MODERN_PROTOCOL_VERSION,
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];
export const PROTOCOL_VERSION_META = "io.modelcontextprotocol/protocolVersion";
export const SERVER_INFO_META = "io.modelcontextprotocol/serverInfo";
export const LIST_CACHE_TTL_MS = 300_000;
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

export const RPC = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  HEADER_MISMATCH: -32020,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
};

export function isModernProtocol(version: string | undefined): boolean {
  return version === MODERN_PROTOCOL_VERSION;
}

export function protocolVersionOf(message: unknown, headerVersion?: string): string | undefined {
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const params = (message as { params?: { _meta?: Record<string, unknown> } }).params;
    const fromMeta = params?._meta?.[PROTOCOL_VERSION_META];
    if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim();
  }
  const header = headerVersion?.trim();
  return header || undefined;
}

export function rpcHttpStatus(reply: object | object[] | null, protocolVersion?: string): number {
  if (reply === null) return 202;
  if (!isModernProtocol(protocolVersion) || Array.isArray(reply)) return 200;
  const code = (reply as { error?: { code?: number } }).error?.code;
  if (code === RPC.UNSUPPORTED_PROTOCOL_VERSION || code === RPC.HEADER_MISMATCH) return 400;
  if (code === RPC.METHOD_NOT_FOUND) return 404;
  return 200;
}

function serverInfoMeta(info: { name: string; title: string; version: string }) {
  return { [SERVER_INFO_META]: { name: info.name, title: info.title, version: info.version } };
}

function cacheable(value: Record<string, unknown>, info: { name: string; title: string; version: string }, cacheScope: "public" | "private" = "private") {
  return {
    ...value,
    resultType: "complete" as const,
    ttlMs: LIST_CACHE_TTL_MS,
    cacheScope,
    _meta: serverInfoMeta(info),
  };
}


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
  "If nothing is good enough, call record_run_result with outcome 'skipped'. " +
  "Social media embeds: follow get_blog_settings.socialEmbedInstructions (post URL alone on its own line, at most 1–2, never HTML/scripts, never invented URLs).";


export type RpcOptions = {
  instructions?: string;
  serverInfo?: { name: string; title: string; version: string };
  /** Value of the MCP-Protocol-Version header, when present. */
  protocolVersion?: string;
};

export const MASTER_SERVER_INFO = { name: "dypol-blog-master", title: "DYPOL Blog Master MCP", version: "1.0.0" };

export const MASTER_SERVER_INSTRUCTIONS =
  "You are the website owner's Master MCP for DYPOL Blog: an operations manager, not a writer profile. " +
  "Use get_master_overview and get_master_permissions first. You can manage content, publishing, existing " +
  "automation profiles, analytics, media, events, pages and permitted website settings. " +
  "You cannot access Security, administrator login, Worker secrets, or create or delete automation profiles " +
  "or credentials. You cannot run arbitrary SQL or JavaScript. " +
  "Deleting published content requires preview_article_deletion and then delete_article with the confirmation token. " +
  "Pausing a profile blocks its further website operations; it does not terminate any external AI process. " +
  "A queued agent task is not complete until the target profile reports completion. " +
  "Daily publishing caps are counted per UTC calendar day. Analytics date presets use Asia/Kolkata (IST).";

async function handleOne(message: unknown, tools: ToolDefinition[], options?: RpcOptions): Promise<object | null> {
  if (!isRequest(message)) return error(null, RPC.INVALID_REQUEST, "Invalid JSON-RPC request.");
  const id = message.id ?? null;
  const isNotification = message.id === undefined;
  if (isNotification) return null; // notifications/initialized, cancelled, ... -> no response

  const requestedVersion = protocolVersionOf(message, options?.protocolVersion);
  const info = options?.serverInfo ?? SERVER_INFO;
  const instructions = options?.instructions ?? SERVER_INSTRUCTIONS;
  const modern = isModernProtocol(requestedVersion);

  if (
    message.method !== "server/discover" &&
    message.method !== "initialize" &&
    requestedVersion &&
    !SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
  ) {
    return {
      jsonrpc: "2.0" as const,
      id,
      error: {
        code: RPC.UNSUPPORTED_PROTOCOL_VERSION,
        message: "Unsupported protocol version",
        data: { supported: SUPPORTED_PROTOCOL_VERSIONS, requested: requestedVersion },
      },
    };
  }

  const listedTools = tools.map(({ name, title, description, inputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema,
    ...(annotations ? { annotations } : {}),
  }));

  switch (message.method) {
    case "server/discover":
      return result(id, cacheable({
        supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
        capabilities: { tools: { listChanged: false } },
        instructions,
      }, info, "private"));
    case "initialize": {
      const requested = String(message.params?.protocolVersion ?? "");
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
      return result(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: info,
        instructions,
      });
    }
    case "ping":
      return result(id, modern ? { resultType: "complete", _meta: serverInfoMeta(info) } : {});
    case "tools/list": {
      const payload = { tools: listedTools };
      return result(id, modern ? cacheable(payload, info, "private") : payload);
    }
    case "tools/call": {
      const name = message.params?.name;
      const tool = tools.find((t) => t.name === name);
      if (!tool) return error(id, RPC.INVALID_PARAMS, `Unknown tool: ${String(name)}`);
      const args = message.params?.arguments ?? {};
      try {
        const outcome = await tool.run(args);
        const payload = outcome.ok ? outcome.data : { error: outcome.error, ...(outcome.data ? { details: outcome.data } : {}) };
        return result(id, {
          ...(modern ? { resultType: "complete" as const } : {}),
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
          isError: !outcome.ok,
        });
      } catch (caught) {
        console.error(`[mcp] tool ${tool.name} failed`, caught instanceof Error ? caught.message : "unknown error");
        return result(id, {
          ...(modern ? { resultType: "complete" as const } : {}),
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
export async function handleRpc(body: unknown, tools: ToolDefinition[], options?: RpcOptions): Promise<object | object[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) return error(null, RPC.INVALID_REQUEST, "Batch must have 1-20 messages.");
    const replies = (await Promise.all(body.map((m) => handleOne(m, tools, options)))).filter((r): r is object => r !== null);
    return replies.length ? replies : null;
  }
  return handleOne(body, tools, options);
}
