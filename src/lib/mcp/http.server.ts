import { workerEnv } from "@/lib/cf-env.server";
import { authenticate } from "./auth";
import { extraClientHosts } from "./hosts.server";
import { MCP_CORS_BASE, originAllowed, withHeaders } from "./cors";
import { handleRpc, RPC, MASTER_SERVER_INFO, MASTER_SERVER_INSTRUCTIONS, SUPPORTED_PROTOCOL_VERSIONS, protocolVersionOf, rpcHttpStatus } from "./protocol";
import { acceptPrefersSse, encodeSseMessage, rpcMethodOf } from "./transport";
import { buildTools } from "./tools.server";
import { authLabelFrom, mcpSourceFromAuth } from "@/lib/publish-source";

/**
 * POST /mcp — Streamable HTTP transport, stateless. JSON unless the client
 * accepts only text/event-stream. Dual-era: initialize (legacy) and
 * server/discover (2026-07-28). Order of checks: origin -> rate limit -> auth
 * -> size -> JSON-RPC.
 */
export const MAX_REQUEST_BYTES = 15_000_000; // room for a 10 MB base64 cover image
export const MCP_RATE = { limit: 30, periodSeconds: 60 };

type Limiter = { limit(o: { key: string }): Promise<{ success: boolean }> };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

function rpcError(status: number, code: number, message: string, headers: Record<string, string> = {}) {
  return json({ jsonrpc: "2.0", id: null, error: { code, message } }, status, headers);
}

async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_REQUEST_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}


function protocolHeader(request: Request): Record<string, string> {
  const version = (request.headers.get("mcp-protocol-version") ?? "").trim();
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version) ? { "mcp-protocol-version": version } : {};
}

/** JSON-RPC body: SSE when the client accepts event-stream, otherwise JSON. */
function rpcReply(body: unknown, request: Request, status = 200, headers: Record<string, string> = {}): Response {
  const extra = { "cache-control": "no-store", ...protocolHeader(request), ...headers };
  if (acceptPrefersSse(request.headers.get("accept"))) {
    return new Response(encodeSseMessage(body), { status, headers: { "content-type": "text/event-stream", ...extra } });
  }
  return json(body, status, extra);
}

function logMcp(fields: Record<string, unknown>) {
  console.info("[mcp]", JSON.stringify(fields));
}

export function resourceMetadataUrl(request: Request): string {
  return `${new URL(request.url).origin}/.well-known/oauth-protected-resource/mcp`;
}

export async function handleMcp(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const env = (await workerEnv()) as { MCP_TOKEN?: string; MCP_LIMITER?: Limiter; MCP_OAUTH_REDIRECT_HOSTS?: string };
  // DNS-rebinding / browser protection: a browser Origin must be allow-listed.
  const origin = request.headers.get("origin");
  if (origin && !originAllowed(origin, url.origin) && !originAllowed(origin, url.origin, await extraClientHosts(env))) {
    return rpcError(403, RPC.INVALID_REQUEST, "Origin not allowed.");
  }
  const cors = origin ? { ...MCP_CORS_BASE, "access-control-allow-origin": origin } : {};
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  return withHeaders(await handleMcpInner(request, env), cors);
}

async function handleMcpInner(request: Request, env: { MCP_TOKEN?: string; MCP_LIMITER?: Limiter }): Promise<Response> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!env.MCP_LIMITER) return rpcError(503, RPC.INTERNAL, "Rate limiter not configured.");
  const { success } = await env.MCP_LIMITER.limit({ key: `mcp:${ip}` });
  if (!success) {
    return rpcError(429, RPC.INTERNAL, "Too many requests.", { "retry-after": String(MCP_RATE.periodSeconds) });
  }

  const { profileResolver } = await import("@/content/automation.server");
  const { masterResolver, touchMasterConnection } = await import("@/content/master-mcp.server");
  const auth = await authenticate(request.headers.get("authorization"), env.MCP_TOKEN, undefined, profileResolver, masterResolver());
  if (!auth.ok) {
    if (auth.reason === "disabled") return rpcError(503, RPC.INTERNAL, "The MCP endpoint is not enabled on this deployment.");
    return rpcError(401, RPC.INVALID_REQUEST, "Unauthorized.", {
      "www-authenticate": `Bearer realm="dypol-blog", resource_metadata="${resourceMetadataUrl(request)}", scope="blog:automation"${
        auth.reason === "invalid" ? ', error="invalid_token"' : ""
      }`,
    });
  }

  // Authenticated GET/DELETE: this stateless server offers no SSE stream or sessions (spec: 405).
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST, OPTIONS" } });
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return rpcError(415, RPC.INVALID_REQUEST, "Content-Type must be application/json.");
  }
  const text = await readCapped(request);
  if (text === null) return rpcError(413, RPC.INVALID_REQUEST, `Request body exceeds ${MAX_REQUEST_BYTES} bytes.`, { connection: "close" });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return rpcError(400, RPC.PARSE, "Parse error.");
  }
  const hints = { origin: request.headers.get("origin"), userAgent: request.headers.get("user-agent") };
  const started = Date.now();
  const { method, toolName } = rpcMethodOf(body);
  const protocolVersion = protocolVersionOf(body, request.headers.get("mcp-protocol-version") ?? undefined);
  const logAndReply = (reply: object | object[] | null, role: string) => {
    const status = rpcHttpStatus(reply, protocolVersion);
    logMcp({ role, via: auth.via, method, toolName, durationMs: Date.now() - started, status });
    if (reply === null) return new Response(null, { status: 202, headers: protocolHeader(request) });
    return rpcReply(reply, request, status);
  };
  if (auth.role === "master") {
    const connectionId = auth.connectionId ?? "master";
    await touchMasterConnection(connectionId, auth.client ?? null);
    const { buildMasterTools } = await import("./master-tools.server");
    const actor = { kind: "master" as const, connectionId, clientName: auth.client ?? null, via: auth.via === "oauth" ? "oauth" as const : "bearer" as const };
    const product = (await import("@/lib/publish-source")).inferProduct({ clientName: auth.client, origin: hints.origin, userAgent: hints.userAgent });
    const source = { via: "master" as const, client: auth.client ?? null, product, mcpAuth: auth.via === "oauth" ? "oauth" as const : "bearer" as const };
    const reply = await handleRpc(body, buildMasterTools({ actor, source }), { instructions: MASTER_SERVER_INSTRUCTIONS, serverInfo: MASTER_SERVER_INFO, protocolVersion });
    return logAndReply(reply, "master");
  }
  // t173: special mode is resolved once per request (buildTools stays synchronous).
  // t178: plus the profile's exclusive Normal/Special assignment (Normal if unreadable).
  // Master requests skip this — it is a publishing-profile concern and added a D1 round trip
  // on the initialize handshake.
  const { special, assignment } = await import("@/lib/special/special-tools.server")
    .then((m) => m.specialRequestContext(auth.profile.id))
    .catch(() => ({ special: null, assignment: "normal" as const }));
  const source = mcpSourceFromAuth(auth, hints);
  const reply = await handleRpc(body, buildTools({ auth: authLabelFrom(auth), profileId: auth.profile.id, special, assignment, source }), { protocolVersion });
  return logAndReply(reply, auth.via === "profile-token" ? "profile" : auth.via === "oauth" ? "oauth" : "publisher");
}
