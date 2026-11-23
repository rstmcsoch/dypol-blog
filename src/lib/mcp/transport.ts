/**
 * Streamable HTTP response helpers. Clients send
 * Accept: application/json, text/event-stream. JSON is allowed by the spec,
 * but several agents (including ones that only complete initialize) only
 * reliably parse SSE events when that media type is accepted.
 */
export function acceptPrefersSse(accept: string | null | undefined): boolean {
  return (accept ?? "").toLowerCase().includes("text/event-stream");
}

/** Encode one or more JSON-RPC messages as SSE `message` events. */
export function encodeSseMessage(payload: unknown): string {
  const items = Array.isArray(payload) ? payload : [payload];
  return items.map((item) => `event: message\ndata: ${JSON.stringify(item)}\n\n`).join("");
}

export function rpcMethodOf(body: unknown): { method: string; toolName?: string } {
  if (Array.isArray(body)) return { method: "batch" };
  if (!body || typeof body !== "object" || !("method" in body) || typeof (body as { method?: unknown }).method !== "string") {
    return { method: "unknown" };
  }
  const method = (body as { method: string }).method;
  if (method === "tools/call") {
    const name = (body as { params?: { name?: unknown } }).params?.name;
    return { method, toolName: typeof name === "string" ? name.slice(0, 80) : undefined };
  }
  return { method };
}
