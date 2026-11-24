/**
 * Article provenance: the byline lives in author_name. This module describes
 * how a draft was created and how it was first published — MCP (OAuth client
 * or token identity) or Manual (admin). Pure helpers, unit-tested.
 *
 * Never invent a source for historical rows. Missing data is "Not recorded".
 */
export const IST_ZONE = "Asia/Kolkata";

export type McpAuthKind = "oauth" | "bearer" | "profile-token";

export type PublishSource = {
  via: "mcp" | "manual" | "master";
  /** OAuth client or connector name, when the server actually received one. */
  client?: string | null;
  /** Grok, Claude, Cursor, … only when identified from the client name, origin, or user-agent. */
  product?: string | null;
  /** How the MCP credential was presented. */
  mcpAuth?: McpAuthKind | null;
};

export type ArticleProvenance = {
  created: PublishSource | null;
  published: PublishSource | null;
  publishedAt: string | null;
  status: string;
};

export const MANUAL_ADMIN: PublishSource = { via: "manual" };

/** Values stored in articles.created_via / published_via. */
export type ViaColumn = "manual" | "mcp" | "mcp-oauth" | "mcp-bearer" | "mcp-profile-token" | "master-mcp";

const PRODUCTS: { name: string; nameRe: RegExp; hostRe: RegExp; uaRe: RegExp }[] = [
  { name: "Grok", nameRe: /\bgrok\b/i, hostRe: /(?:^|\.)(grok\.com|x\.ai)$/i, uaRe: /\bgrok\b/i },
  { name: "Claude", nameRe: /\b(claude|anthropic)\b/i, hostRe: /(?:^|\.)claude\.(ai|com)$/i, uaRe: /claude|anthropic/i },
  { name: "ChatGPT", nameRe: /\b(chatgpt|openai)\b/i, hostRe: /(?:^|\.)(chatgpt\.com|openai\.com)$/i, uaRe: /\bchatgpt\b|\bopenai\b/i },
  { name: "Cursor", nameRe: /\bcursor\b/i, hostRe: /(?:^|\.)(cursor\.com|cursor\.sh)$/i, uaRe: /\bcursor\b/i },
  { name: "VS Code", nameRe: /\bvs\s*code\b|\bvscode\b/i, hostRe: /(?:^|\.)vscode\.dev$/i, uaRe: /vscode|visual studio code/i },
  { name: "Gemini", nameRe: /\bgemini\b/i, hostRe: /(?:^|\.)(googleusercontent\.com|vertexaisearch\.cloud\.google\.com|antigravity\.google|gemini\.google\.com)$/i, uaRe: /\bgemini\b/i },
  { name: "Perplexity", nameRe: /\bperplexity\b/i, hostRe: /(?:^|\.)perplexity\.ai$/i, uaRe: /\bperplexity\b/i },
];

export function inferProduct(hints: { clientName?: string | null; origin?: string | null; userAgent?: string | null; redirectUri?: string | null }): string | null {
  const fromName = productFromText(hints.clientName);
  if (fromName) return fromName;
  const host = hostOf(hints.origin) ?? hostOf(hints.redirectUri);
  if (host) {
    const hit = PRODUCTS.find((p) => p.hostRe.test(host));
    if (hit) return hit.name;
  }
  const ua = hints.userAgent?.trim();
  if (ua) {
    const hit = PRODUCTS.find((p) => p.uaRe.test(ua));
    if (hit) return hit.name;
  }
  return null;
}

function productFromText(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  return PRODUCTS.find((p) => p.nameRe.test(text))?.name ?? null;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Parse the compact auth label stored on automation_runs (and passed through
 * MCP tools): `oauth:<client>`, `bearer`, `profile-token`, or `oauth`.
 */
export function sourceFromAuthLabel(auth: string | null | undefined, hints?: { origin?: string | null; userAgent?: string | null }): PublishSource | null {
  const raw = (auth ?? "").trim();
  if (!raw) return null;
  let mcpAuth: McpAuthKind | null = null;
  let client: string | null = null;
  if (raw.startsWith("oauth:")) {
    mcpAuth = "oauth";
    client = raw.slice("oauth:".length).trim() || null;
  } else if (raw === "oauth") {
    mcpAuth = "oauth";
    client = "legacy connector";
  } else if (raw === "bearer") {
    mcpAuth = "bearer";
  } else if (raw === "profile-token") {
    mcpAuth = "profile-token";
  } else {
    // Unknown historical value: keep the raw text as the client, still MCP.
    mcpAuth = "oauth";
    client = raw.slice(0, 80);
  }
  const product = inferProduct({ clientName: client, origin: hints?.origin, userAgent: hints?.userAgent });
  return { via: "mcp", client, product, mcpAuth };
}

export function mcpSourceFromAuth(input: { via: "bearer" | "oauth" | "profile-token"; client?: string | null }, hints?: { origin?: string | null; userAgent?: string | null }): PublishSource {
  const client = input.via === "oauth" ? (input.client?.trim() || null) : null;
  const product = inferProduct({ clientName: input.client, origin: hints?.origin, userAgent: hints?.userAgent });
  return { via: "mcp", client, product, mcpAuth: input.via };
}

/** Compact label still written to automation_runs.auth (unchanged format). */
export function authLabelFrom(auth: { via: "bearer" | "oauth" | "profile-token"; client?: string | null }): string {
  return auth.client ? `oauth:${auth.client}` : auth.via;
}

export function viaColumn(source: PublishSource): ViaColumn {
  if (source.via === "master") return "master-mcp";
  if (source.via === "manual") return "manual";
  if (source.mcpAuth === "bearer") return "mcp-bearer";
  if (source.mcpAuth === "profile-token") return "mcp-profile-token";
  if (source.mcpAuth === "oauth") return "mcp-oauth";
  return "mcp";
}

export function sourceFromRow(via: string | null | undefined, client: string | null | undefined, product: string | null | undefined): PublishSource | null {
  const v = (via ?? "").trim();
  if (v === "manual") return { via: "manual", client: client?.trim() || null, product: product?.trim() || null };
  if (v === "master-mcp") return { via: "master", client: client?.trim() || null, product: product?.trim() || null, mcpAuth: "bearer" };
  if (v === "mcp" || v === "mcp-oauth" || v === "mcp-bearer" || v === "mcp-profile-token") {
    const mcpAuth: McpAuthKind | null = v === "mcp-oauth" ? "oauth" : v === "mcp-bearer" ? "bearer" : v === "mcp-profile-token" ? "profile-token" : null;
    return { via: "mcp", client: client?.trim() || null, product: product?.trim() || null, mcpAuth };
  }
  return null;
}

export function sourceColumns(source: PublishSource): { via: ViaColumn; client: string | null; product: string | null } {
  return {
    via: viaColumn(source),
    client: source.client?.trim() || null,
    product: source.product?.trim() || null,
  };
}

export function formatDateTimeIST(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ms));
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ms));
  return `${date}, ${time} IST`;
}

/**
 * Human-readable MCP / admin channel, without a date.
 * Examples: "Manual (admin)", "Grok MCP", "dypolblog production (main) MCP from Grok", "MCP (master token)".
 */
export function formatSourceLabel(source: PublishSource | null | undefined): string | null {
  if (!source) return null;
  if (source.via === "manual") return "Manual (admin)";
  if (source.via === "master") {
    const client = source.client?.trim() || null;
    const product = source.product?.trim() || null;
    if (client && product && client.toLowerCase() !== product.toLowerCase()) return `Master MCP (${client} from ${product})`;
    if (client) return `Master MCP (${client})`;
    if (product) return `Master MCP from ${product}`;
    return "Master MCP";
  }
  const client = source.client?.trim() || null;
  const product = source.product?.trim() || null;
  const clientIsProduct = Boolean(client && product && client.toLowerCase() === product.toLowerCase());
  if (client && product && !clientIsProduct && !productFromText(client)) {
    return `${client} MCP from ${product}`;
  }
  if (client) return `${client} MCP`;
  if (product) return `${product} MCP`;
  if (source.mcpAuth === "bearer") return "MCP (master token)";
  if (source.mcpAuth === "profile-token") return "MCP (profile API key)";
  return "MCP";
}

/** Read-only desk copy for the Published via field. */
export function formatPublishedVia(provenance: ArticleProvenance): { primary: string; secondary?: string } {
  const when = formatDateTimeIST(provenance.publishedAt);
  const published = provenance.status === "published" || Boolean(provenance.publishedAt);
  if (!published) {
    const created = formatSourceLabel(provenance.created);
    return {
      primary: "Not yet published",
      secondary: created ? `Created via ${created}` : undefined,
    };
  }
  const label = formatSourceLabel(provenance.published);
  if (!label) {
    return { primary: when ? `Not recorded · ${when}` : "Not recorded" };
  }
  return { primary: when ? `${label} · ${when}` : label };
}
