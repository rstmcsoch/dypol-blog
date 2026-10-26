/**
 * Cloudflare Worker bindings (server-only).
 *
 * The Worker runtime exposes bindings on the `cloudflare:workers` module. The
 * specifier is built at runtime so node-based tests and type tooling never try
 * to resolve it. Outside the Worker this returns an empty object.
 */
export type D1Result<T> = { results?: T[] };
export type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
};
export type D1Database = {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
};

export type WorkerBindings = {
  DB?: D1Database;
  MEDIA?: unknown;
  ADMIN_TOKEN?: string;
  ADMIN_SESSION_SECRET?: string;
  MCP_TOKEN?: string;
  MCP_OAUTH_REDIRECT_HOSTS?: string;
  /** Server-api provider keys (names only ever shown). See src/lib/automation/provider.ts. */
  AI_API_KEY?: string;
  XAI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  /** Cloudflare Images binding (t60 image pipeline). */
  IMAGES?: unknown;
  /** t115 contact form: Cloudflare Turnstile keys (site key may be a plain var; secret via `wrangler secret put`). */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  MCP_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  SIGNIN_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Bound article bucket. Production: dypol-blog-media. Preview overrides this. */
  MEDIA_BUCKET_NAME?: string;
  /** Decimal bytes of the fixed allowance. Unset means the included 10 GB. */
  R2_STORAGE_QUOTA_BYTES?: string;
  /** Optional. Together with CLOUDFLARE_API_TOKEN, stamps the daily count against R2 analytics. */
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
};

// No promise is cached across requests: workerd hangs a request that awaits a
// promise created by another request. The module import itself is cached.
export async function workerEnv(): Promise<WorkerBindings> {
  try {
    const specifier = ["cloudflare", "workers"].join(":");
    const mod = (await import(/* @vite-ignore */ specifier)) as { env?: WorkerBindings };
    return mod.env ?? {};
  } catch {
    return {};
  }
}
