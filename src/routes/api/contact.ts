import { createFileRoute } from "@tanstack/react-router";

/** t115: contact form endpoint (same-origin JSON POST, rate-limited, Turnstile-verified). */
async function handle(request: Request): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return json({ ok: false, error: "Forbidden." }, 403);
  try {
    const { workerEnv } = await import("@/lib/cf-env.server");
    const env = await workerEnv();
    const ip = request.headers.get("cf-connecting-ip") ?? "local";
    if (env.MCP_LIMITER && !(await env.MCP_LIMITER.limit({ key: `contact:${ip}` })).success) {
      return json({ ok: false, error: "Too many messages. Please wait a minute and try again." }, 429);
    }
  } catch { /* limiter unavailable: Turnstile still applies */ }
  const body = await request.json().catch(() => null);
  const { submitContact } = await import("@/content/contact.server");
  const result = await submitContact(body, request);
  return result.ok ? json({ ok: true }) : json({ ok: false, error: result.error }, result.status);
}

export const Route = createFileRoute("/api/contact")({
  server: { handlers: { POST: async ({ request }) => handle(request) } },
});
