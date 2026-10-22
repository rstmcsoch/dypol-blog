/** Sanitized fields a public beacon is allowed to send. Nothing here is stored raw. */
export type ClientFields = {
  refHost: string;
  inboundArticle: boolean;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
};

export type EngageBody = ClientFields & {
  engagedMs: number;
  scrollPct: number;
  internalClicks: number;
};

function asObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export function parseClientFields(input: unknown): ClientFields {
  const o = asObject(input) ?? {};
  return {
    refHost: clip(o.refHost, 200),
    inboundArticle: o.inboundArticle === true,
    utmSource: clip(o.utmSource, 80),
    utmMedium: clip(o.utmMedium, 80),
    utmCampaign: clip(o.utmCampaign, 80),
  };
}

function bounded(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.min(max, Math.max(min, value)));
}

export function parseEngageBody(input: unknown): EngageBody | null {
  const o = asObject(input);
  if (!o) return null;
  const engagedMs = bounded(o.engagedMs, 0, 1_200_000);
  const scrollPct = bounded(o.scrollPct, 0, 100);
  const internalClicks = bounded(o.internalClicks, 0, 30);
  if (engagedMs == null || scrollPct == null || internalClicks == null) return null;
  return { ...parseClientFields(o), engagedMs, scrollPct, internalClicks };
}

export async function readJsonLimited(request: Request, maxChars = 2000): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  if (text.length > maxChars) throw new Error("payload too large");
  return JSON.parse(text) as unknown;
}
