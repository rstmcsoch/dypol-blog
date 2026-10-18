#!/usr/bin/env node
/**
 * Legacy image-variant backfill reporter (t60).
 *
 * Dry-run by default. This script only READS D1 (via wrangler) and
 * reports how many legacy media rows still lack hero/thumb variants,
 * what they will cost in Images transforms, and how to apply.
 *
 * Why doesn't --apply write from here? Variants must be produced by
 * the same Cloudflare IMAGES pipeline as live uploads (identical
 * specs, quota accounting, cleanup). That binding only exists inside
 * the Worker, so applying happens in Admin -> Media -> "Run backfill
 * batch" (server function adminBackfillMedia), which is batched,
 * idempotent, and reports per-item failures. Encoding locally with a
 * different encoder would silently create inconsistent variants.
 *
 * Usage:
 *   node scripts/backfill-image-variants.mjs [--remote] [--apply]
 *   --remote   query production D1 (default: local D1)
 *   --apply    print the apply instructions (still writes nothing)
 */
import { execFileSync } from "node:child_process";

const remote = process.argv.includes("--remote");
const apply = process.argv.includes("--apply");

const sql =
  "select count(*) as legacy_files, coalesce(sum(byte_size),0) as legacy_bytes, " +
  "(select count(*) from media) as total_files from media where hero_key is null";

const args = ["wrangler", "d1", "execute", "DB", remote ? "--remote" : "--local", "--json", "--command", sql];
let out;
try {
  out = execFileSync("npx", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (error) {
  console.error("Could not query D1 via wrangler. Run inside the repo with wrangler authenticated.");
  console.error(String(error.stderr ?? error.message ?? error));
  process.exit(1);
}
const parsed = JSON.parse(out);
const row = parsed?.[0]?.results?.[0] ?? { legacy_files: 0, legacy_bytes: 0, total_files: 0 };
const legacyFiles = Number(row.legacy_files ?? 0);
const legacyBytes = Number(row.legacy_bytes ?? 0);

console.log(`Target: ${remote ? "production" : "local"} D1 (dypol-blog-db)`);
console.log(`Media rows total: ${row.total_files}`);
console.log(`Legacy rows without variants: ${legacyFiles} (${(legacyBytes / 1024).toFixed(1)} KB of originals)`);
console.log(`Transforms needed if all are processed: ~${legacyFiles * 2} (hero + thumb; retries may add more)`);
console.log("Cloudflare Images free quota: 5,000 unique transformations/month; stored variants keep serving past it.");
if (legacyFiles === 0) {
  console.log("Nothing to backfill.");
} else if (!apply) {
  console.log("\nDry-run only — nothing was changed. Re-run with --apply for apply instructions.");
} else {
  console.log("\nTo apply (uses the exact upload pipeline inside the Worker):");
  console.log("1. Deploy this branch after review/merge (migration 0009 must be applied to prod D1 first).");
  console.log("2. Open Admin -> Media, click 'Preview backfill' to confirm the batch size.");
  console.log("3. Click 'Run backfill batch (10)' repeatedly until the preview reports 0.");
  console.log("   Each batch is idempotent; failures are reported per image and stop early on quota errors.");
}
