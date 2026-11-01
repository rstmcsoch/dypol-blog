/**
 * t148: ads storage (D1) and sponsor banner files (R2, keys under "ads/").
 * The settings row lives in `ads_settings`; writing it bumps content_version
 * (see content-cache CONTENT_TABLES) so a save goes live on the next request.
 */
import { randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { cachedRead } from "@/lib/content-cache.server";
import { workerEnv } from "@/lib/cf-env.server";
import { probeImage } from "@/lib/image-pipeline";
import { defaultAdsSettings, normalizeAdsSettings, sizeDims, slotDef, AD_SIZES, type AdSize, type AdsSettings, type SlotConfig, type SponsorBanner } from "./model.ts";
import { sponsorTarget } from "./public.ts";

const ROW_ID = "ads";
export const VERSIONS_PER_SLOT = 10;
export const MAX_BANNER_BYTES = 300 * 1024;

async function sqlOrNull(): Promise<Sql | null> {
  try {
    return await getSql();
  } catch {
    return null;
  }
}

async function loadSettings(sql: Sql): Promise<AdsSettings> {
  try {
    const rows = await sql<{ data: string }>`select data from ads_settings where id = ${ROW_ID}`;
    return rows[0] ? normalizeAdsSettings(JSON.parse(rows[0].data)) : defaultAdsSettings();
  } catch {
    // Pre-0025 database: behave as "no ads configured".
    return defaultAdsSettings();
  }
}

/** Public read (cached in-isolate, invalidated by content_version). */
export async function publicAdsSettings(): Promise<AdsSettings> {
  const sql = await sqlOrNull();
  if (!sql) return defaultAdsSettings();
  return cachedRead("ads", sql, () => loadSettings(sql));
}

/** Admin read: always fresh. */
export async function readAdsSettings(): Promise<AdsSettings> {
  const sql = await getSql();
  return loadSettings(sql);
}

export async function adsAudit(action: string, detail: string, actor: string | null): Promise<void> {
  try {
    const sql = await getSql();
    await sql`insert into ads_audit (id, created_at, actor, action, detail) values (${randomUUID()}, ${new Date().toISOString()}, ${actor}, ${action.slice(0, 60)}, ${detail.slice(0, 500)})`;
    await sql`delete from ads_audit where id not in (select id from ads_audit order by created_at desc limit 500)`;
  } catch {
    /* the audit trail must never block a save */
  }
}

function slotJson(s: SlotConfig): string {
  const { updatedAt: _a, updatedBy: _b, ...rest } = s;
  return JSON.stringify(rest);
}

export function changedSlots(before: AdsSettings, after: AdsSettings): SlotConfig[] {
  const prev = new Map(before.slots.map((s) => [s.id, slotJson(s)]));
  return after.slots.filter((s) => prev.get(s.id) !== slotJson(s));
}

export async function saveAdsSettings(raw: unknown, actor: string | null, reason = "save"): Promise<AdsSettings> {
  const sql = await getSql();
  const before = await loadSettings(sql);
  const next = normalizeAdsSettings(raw);
  const now = new Date().toISOString();
  const changed = changedSlots(before, next);
  const changedIds = new Set(changed.map((s) => s.id));
  next.slots = next.slots.map((s) => (changedIds.has(s.id) ? { ...s, updatedAt: now, updatedBy: actor } : { ...s, updatedAt: before.slots.find((b) => b.id === s.id)?.updatedAt ?? s.updatedAt, updatedBy: before.slots.find((b) => b.id === s.id)?.updatedBy ?? s.updatedBy }));
  // History keeps the version being replaced, so "restore" brings it back.
  for (const s of changed) {
    const old = before.slots.find((b) => b.id === s.id);
    if (!old) continue;
    await sql`insert into ads_versions (id, slot_id, data, created_at, actor) values (${randomUUID()}, ${s.id}, ${JSON.stringify(old)}, ${now}, ${actor})`;
    await sql`delete from ads_versions where slot_id = ${s.id} and id not in (select id from ads_versions where slot_id = ${s.id} order by created_at desc limit ${VERSIONS_PER_SLOT})`;
  }
  await sql`insert into ads_settings (id, data, updated_at, updated_by) values (${ROW_ID}, ${JSON.stringify(next)}, ${now}, ${actor}) on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`;
  const parts: string[] = [];
  if (before.master !== next.master) parts.push(`master switch ${next.master ? "on" : "off"}`);
  if (changed.length) parts.push(`slots ${changed.map((s) => s.id).join(", ")}`);
  if (JSON.stringify(before.sponsors) !== JSON.stringify(next.sponsors)) parts.push("sponsors");
  if (JSON.stringify(before.scripts) !== JSON.stringify(next.scripts)) parts.push("global scripts");
  if (before.adsTxt !== next.adsTxt) parts.push("ads.txt");
  if (JSON.stringify(before.rules) !== JSON.stringify(next.rules)) parts.push("ad rules");
  if (JSON.stringify(before.consent) !== JSON.stringify(next.consent)) parts.push("consent banner");
  if (JSON.stringify(before.house) !== JSON.stringify(next.house)) parts.push("house ad");
  if (JSON.stringify(before.sponsoredArticles) !== JSON.stringify(next.sponsoredArticles)) parts.push("sponsored articles");
  if (JSON.stringify(before.networks) !== JSON.stringify(next.networks)) parts.push("network links");
  await adsAudit(reason, parts.length ? `Changed ${parts.join("; ")}` : "Saved with no changes", actor);
  return next;
}

export async function slotVersions(slotId: string): Promise<{ id: string; createdAt: string; actor: string | null; slot: SlotConfig }[]> {
  const def = slotDef(slotId);
  if (!def) return [];
  const sql = await getSql();
  const rows = await sql<{ id: string; data: string; created_at: string; actor: string | null }>`select id, data, created_at, actor from ads_versions where slot_id = ${slotId} order by created_at desc limit ${VERSIONS_PER_SLOT}`.catch(() => []);
  const { normalizeSlot } = await import("./model.ts");
  return rows.map((r) => ({ id: r.id, createdAt: r.created_at, actor: r.actor, slot: normalizeSlot(JSON.parse(r.data), def) }));
}

export async function restoreSlotVersion(versionId: string, actor: string | null): Promise<AdsSettings> {
  const sql = await getSql();
  const rows = await sql<{ slot_id: string; data: string }>`select slot_id, data from ads_versions where id = ${versionId}`;
  const row = rows[0];
  if (!row) throw new Error("That version no longer exists.");
  const current = await loadSettings(sql);
  const restored = JSON.parse(row.data) as SlotConfig;
  const next = { ...current, slots: current.slots.map((s) => (s.id === row.slot_id ? { ...restored, id: s.id } : s)) };
  return saveAdsSettings(next, actor, "restore");
}

export async function auditLog(limit = 100): Promise<{ createdAt: string; actor: string | null; action: string; detail: string }[]> {
  const sql = await getSql();
  const rows = await sql<{ created_at: string; actor: string | null; action: string; detail: string }>`select created_at, actor, action, detail from ads_audit order by created_at desc limit ${limit}`.catch(() => []);
  return rows.map((r) => ({ createdAt: r.created_at, actor: r.actor, action: r.action, detail: r.detail }));
}

// ---------- stats ----------
export type AdEvent = { slot: string; creative: string; sponsor?: string; type: "imp" | "click" };

export function istDay(ms: number): string {
  return new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
}

export async function recordAdEvents(events: AdEvent[]): Promise<number> {
  const settings = await publicAdsSettings();
  const known = new Map<string, Set<string>>();
  for (const s of settings.slots) known.set(s.id, new Set([...s.creatives.map((c) => c.id), "house"]));
  const sql = await getSql();
  const day = istDay(Date.now());
  const counts = new Map<string, { slot: string; creative: string; sponsor: string; imp: number; click: number }>();
  for (const e of events.slice(0, 30)) {
    if (!known.get(e.slot)?.has(e.creative)) continue;
    const creative = settings.slots.find((s) => s.id === e.slot)?.creatives.find((c) => c.id === e.creative);
    const sponsor = creative && creative.kind !== "code" ? creative.sponsorId : "";
    const key = `${e.slot}|${e.creative}`;
    const row = counts.get(key) ?? { slot: e.slot, creative: e.creative, sponsor, imp: 0, click: 0 };
    if (e.type === "click") row.click += 1;
    else row.imp += 1;
    counts.set(key, row);
  }
  for (const r of counts.values()) {
    await sql`insert into ad_stats (day, slot_id, creative_id, sponsor_id, impressions, clicks) values (${day}, ${r.slot}, ${r.creative}, ${r.sponsor}, ${r.imp}, ${r.click}) on conflict (day, slot_id, creative_id) do update set impressions = impressions + excluded.impressions, clicks = clicks + excluded.clicks`;
  }
  return counts.size;
}

/** Resolve a sponsor click: count it and return the target (with UTM). */
export async function resolveAdClick(creativeId: string, slotId: string): Promise<string | null> {
  const settings = await publicAdsSettings();
  const slot = settings.slots.find((s) => s.id === slotId) ?? settings.slots.find((s) => s.creatives.some((c) => c.id === creativeId));
  if (!slot) return null;
  if (creativeId === "house") return settings.house.url || null;
  const creative = slot.creatives.find((c) => c.id === creativeId);
  const sponsor = creative ? settings.sponsors.find((s) => s.id === creative.sponsorId) : undefined;
  if (!creative || !sponsor) return null;
  const target = sponsorTarget(sponsor, slot.id);
  if (target) await recordAdEvents([{ slot: slot.id, creative: creative.id, type: "click" }]).catch(() => 0);
  return target;
}

export type StatRow = { day: string; slot: string; creative: string; sponsor: string; impressions: number; clicks: number };

export async function adStats(days: number): Promise<StatRow[]> {
  const sql = await getSql();
  const since = istDay(Date.now() - (Math.max(1, Math.min(400, days)) - 1) * 86_400_000);
  const rows = await sql<{ day: string; slot_id: string; creative_id: string; sponsor_id: string; impressions: number; clicks: number }>`select day, slot_id, creative_id, sponsor_id, impressions, clicks from ad_stats where day >= ${since} order by day desc, slot_id`.catch(() => []);
  return rows.map((r) => ({ day: r.day, slot: r.slot_id, creative: r.creative_id, sponsor: r.sponsor_id, impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0 }));
}

// ---------- sponsor banner files ----------
type Bucket = {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream | null; httpMetadata?: { contentType?: string }; size?: number; httpEtag?: string } | null>;
};

async function bucket(): Promise<Bucket> {
  const env = (await workerEnv()) as { MEDIA?: Bucket };
  if (!env.MEDIA || typeof env.MEDIA.put !== "function") throw new Error("The MEDIA R2 binding is not available, so banners cannot be stored.");
  return env.MEDIA;
}

const MIME_BY_FORMAT = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as const;
const EXT_BY_MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** Exact size (1×) or exactly double (2×); type and weight checked from the bytes. */
export function validateBanner(bytes: Uint8Array, size: AdSize): { ok: true; mime: string; width: number; height: number; scale: 1 | 2 } | { ok: false; error: string } {
  if (!AD_SIZES.includes(size) || size === "responsive") return { ok: false, error: "Pick a fixed banner size." };
  const info = probeImage(bytes);
  if (!info) return { ok: false, error: "Use a JPG, PNG, WebP or GIF image." };
  if (bytes.byteLength > MAX_BANNER_BYTES) return { ok: false, error: `The file is ${Math.round(bytes.byteLength / 1024)} KB; the limit is 300 KB.` };
  const dims = sizeDims(size)!;
  const scale = info.width === dims.w && info.height === dims.h ? 1 : info.width === dims.w * 2 && info.height === dims.h * 2 ? 2 : 0;
  if (!scale) return { ok: false, error: `This image is ${info.width}×${info.height}. A ${size} banner must be exactly ${dims.w}×${dims.h} (or ${dims.w * 2}×${dims.h * 2} for sharp screens).` };
  return { ok: true, mime: MIME_BY_FORMAT[info.format], width: info.width, height: info.height, scale: scale as 1 | 2 };
}

async function toWebp(bytes: Uint8Array, mime: string): Promise<{ bytes: Uint8Array; mime: string }> {
  if (mime === "image/webp" || mime === "image/gif") return { bytes, mime };
  try {
    const env = (await workerEnv()) as { IMAGES?: { input(s: ReadableStream): { output(o: Record<string, unknown>): Promise<{ response(): Response }> } } };
    if (!env.IMAGES) return { bytes, mime };
    const result = await env.IMAGES.input(new Blob([bytes as BlobPart]).stream()).output({ format: "image/webp", quality: 85 });
    const res = result.response();
    if (!res.ok) return { bytes, mime };
    const out = new Uint8Array(await res.arrayBuffer());
    const check = probeImage(out);
    const orig = probeImage(bytes);
    // Keep the conversion only when it is smaller and pixel-exact.
    if (check && orig && check.width === orig.width && check.height === orig.height && out.byteLength < bytes.byteLength) return { bytes: out, mime: "image/webp" };
  } catch {
    /* fall back to the original file */
  }
  return { bytes, mime };
}

export async function storeBanner(input: { dataBase64: string; size: AdSize; alt: string }): Promise<Omit<SponsorBanner, "key2x"> & { scale: 1 | 2 }> {
  const bytes = Uint8Array.from(Buffer.from(input.dataBase64, "base64"));
  const check = validateBanner(bytes, input.size);
  if (!check.ok) throw new Error(check.error);
  const out = await toWebp(bytes, check.mime);
  const key = `ads/${randomUUID()}.${EXT_BY_MIME[out.mime] ?? "bin"}`;
  await (await bucket()).put(key, out.bytes, { httpMetadata: { contentType: out.mime, cacheControl: "public, max-age=31536000, immutable" } });
  const dims = sizeDims(input.size)!;
  return { size: input.size, key, width: dims.w, height: dims.h, mime: out.mime, bytes: out.bytes.byteLength, alt: input.alt.slice(0, 200), scale: check.scale };
}

const AD_MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as const;

export async function serveAdMedia(name: string): Promise<Response> {
  if (!/^[\w-]+\.(jpg|png|webp|gif)$/.test(name)) return new Response("Not found", { status: 404 });
  const object = await (await bucket()).get(`ads/${name}`);
  if (!object || !object.body) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": AD_MIME[name.split(".").pop() as keyof typeof AD_MIME],
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
