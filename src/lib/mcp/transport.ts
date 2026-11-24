/**
 * Streamable HTTP response helpers. Clients MUST advertise
 * Accept: application/json, text/event-stream. Both media types are valid
 * responses. Prefer JSON whenever the client accepts it: known-good servers
 * (and the official examples) do this, and some agents (including Wabi/Yomi)
 * advertise both but only parse JSON, then show "no actions" if the body is SSE.
 * SSE is used only when the client asks for event-stream and not JSON.
 */
export function acceptPrefersSse(accept: string | null | undefined): boolean {
  const a = (accept ?? "").toLowerCase();
  if (!a.includes("text/event-stream")) return false;
  if (a.includes("application/json")) return false;
  return true;
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
