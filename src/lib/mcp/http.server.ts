import { workerEnv } from "@/lib/cf-env.server";
import { authenticate } from "./auth";
import { MCP_CORS_BASE, originAllowed, withHeaders } from "./cors";
import { handleRpc, RPC } from "./protocol";
import { buildTools } from "./tools.server";

/**
 * POST /mcp — Streamable HTTP transport, stateless, JSON responses.
 * Order of checks: method -> origin -> rate limit -> auth -> size -> JSON-RPC.
 */
export const MAX_REQUEST_BYTES = 2_500_000;
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

export function resourceMetadataUrl(request: Request): string {
  return `${new URL(request.url).origin}/.well-known/oauth-protected-resource/mcp`;
}

export async function handleMcp(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const env = (await workerEnv()) as { MCP_TOKEN?: string; MCP_LIMITER?: Limiter; MCP_OAUTH_REDIRECT_HOSTS?: string };
  // DNS-rebinding / browser protection: a browser Origin must be allow-listed.
  const origin = request.headers.get("origin");
  if (origin && !originAllowed(origin, url.origin, env.MCP_OAUTH_REDIRECT_HOSTS)) {
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

  const auth = await authenticate(request.headers.get("authorization"), env.MCP_TOKEN);
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
  const reply = await handleRpc(body, buildTools({ auth: auth.via }));
  if (reply === null) return new Response(null, { status: 202 });
  return json(reply);
}
