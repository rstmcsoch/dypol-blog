/**
 * t173: private research notebook for special articles (sources, claims, quality
 * reports, datasets). Rows live in D1 `special_research`; nothing here is public.
 */
import { getSql } from "@/lib/db";

export type ResearchKind = "source" | "resource" | "claim" | "report" | "dataset";
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type ResearchRow = { id: string; kind: ResearchKind; data: { [key: string]: Json }; createdAt: string; profileId: string };

const MAX_ROWS = 400;

export function collectionKey(raw: string): string {
  const key = String(raw ?? "").trim().slice(0, 120);
  if (!/^[A-Za-z0-9_.:-]+$/.test(key)) throw new Error("Invalid research collection key.");
  return key;
}

export async function readResearch(key: string, kind?: ResearchKind): Promise<ResearchRow[]> {
  const sql = await getSql();
  const k = collectionKey(key);
  const rows = kind
    ? await sql<{ id: string; kind: ResearchKind; data: string; created_at: string; profile_id: string }>`select id, kind, data, created_at, profile_id from special_research where collection_key = ${k} and kind = ${kind} order by created_at limit ${MAX_ROWS}`
    : await sql<{ id: string; kind: ResearchKind; data: string; created_at: string; profile_id: string }>`select id, kind, data, created_at, profile_id from special_research where collection_key = ${k} order by created_at limit ${MAX_ROWS}`;
  return rows.map((r) => {
    let data: { [key: string]: Json } = {};
    try { data = JSON.parse(r.data) as { [key: string]: Json }; } catch { /* keep empty */ }
    return { id: r.id, kind: r.kind, data, createdAt: r.created_at, profileId: r.profile_id };
  });
}

export async function addResearch(key: string, kind: ResearchKind, data: Record<string, unknown>, profileId = "default", id?: string): Promise<string> {
  const sql = await getSql();
  const k = collectionKey(key);
  const count = await sql<{ n: number }>`select count(*) as n from special_research where collection_key = ${k}`;
  if (Number(count[0]?.n ?? 0) >= MAX_ROWS) throw new Error(`This research collection is full (${MAX_ROWS} items).`);
  const rowId = id ?? `res_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const json = JSON.stringify(data).slice(0, 60_000);
  await sql`insert into special_research (id, collection_key, profile_id, kind, data, created_at) values (${rowId}, ${k}, ${profileId}, ${kind}, ${json}, ${new Date().toISOString()})
    on conflict (id) do update set data = excluded.data`;
  return rowId;
}

export async function removeResearch(key: string, id: string): Promise<void> {
  const sql = await getSql();
  await sql`delete from special_research where collection_key = ${collectionKey(key)} and id = ${id}`;
}
