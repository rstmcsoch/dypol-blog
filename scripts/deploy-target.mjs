import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const CANONICAL_WORKER_NAME = "dypolblog";
export const PRODUCTION_BRANCH = "main";
export const PRODUCTION_DB_NAME = "dypol-blog-db";
export const PRODUCTION_DB_ID = "78708341-8467-4140-bfa7-0531f14a7aee";
export const PREVIEW_DB_NAME = "dypol-blog-db-preview";
export const PREVIEW_DB_ID = "c9030fb4-8657-47d9-bf6f-e8c11650bdd5";
export const PRODUCTION_MEDIA_BUCKET = "dypol-blog-media";
export const PREVIEW_MEDIA_BUCKET = "dypol-blog-media-preview";

/** Strip // line comments outside JSON string literals so wrangler.jsonc can be parsed safely. */
export function parseJsonc(raw) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    out += ch;
  }
  return JSON.parse(out);
}

export function loadWranglerConfig(root = ROOT) {
  const raw = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  const main = parseJsonc(raw);
  const previewPath = join(root, "wrangler.preview.jsonc");
  const previewConfig = existsSync(previewPath) ? parseJsonc(readFileSync(previewPath, "utf8")) : null;
  return { ...main, _previewConfig: previewConfig };
}

export function validateWranglerConfig(config) {
  const errors = [];
  if (config?.name !== CANONICAL_WORKER_NAME) {
    errors.push(`Expected canonical Worker name "${CANONICAL_WORKER_NAME}", got "${config?.name ?? ""}".`);
  }
  if (config?.vars?.DYPOL_ENV !== "production") {
    errors.push(`Expected top-level vars.DYPOL_ENV="production", got "${config?.vars?.DYPOL_ENV ?? ""}".`);
  }
  const prodDb = config?.d1_databases?.[0];
  if (prodDb?.binding !== "DB" || prodDb?.database_name !== PRODUCTION_DB_NAME || prodDb?.database_id !== PRODUCTION_DB_ID) {
    errors.push(`Production D1 binding must target ${PRODUCTION_DB_NAME} (${PRODUCTION_DB_ID}).`);
  }
  const prodMedia = config?.r2_buckets?.[0];
  if (prodMedia?.binding !== "MEDIA" || prodMedia?.bucket_name !== PRODUCTION_MEDIA_BUCKET) {
    errors.push(`Production R2 binding must target ${PRODUCTION_MEDIA_BUCKET}.`);
  }

  const sections = [["previews", config?.previews]];
  if (config?._previewConfig !== undefined) {
    sections.push(["wrangler.preview.jsonc", config._previewConfig]);
  }
  for (const [label, section] of sections) {
    if (!section) {
      errors.push(`Missing "${label}" configuration for isolated preview builds/migrations.`);
      continue;
    }
    if (section?.vars?.DYPOL_ENV !== "preview") {
      errors.push(`Expected ${label}.vars.DYPOL_ENV="preview", got "${section?.vars?.DYPOL_ENV ?? ""}".`);
    }
    const prevDb = section?.d1_databases?.[0];
    if (prevDb?.binding !== "DB" || prevDb?.database_name !== PREVIEW_DB_NAME || prevDb?.database_id !== PREVIEW_DB_ID) {
      errors.push(`${label} D1 binding must target ${PREVIEW_DB_NAME} (${PREVIEW_DB_ID}).`);
    }
    if (prevDb?.database_id === prodDb?.database_id) {
      errors.push(`${label} D1 database_id must never equal the production database_id.`);
    }
    const prevMedia = section?.r2_buckets?.[0];
    if (prevMedia?.binding !== "MEDIA" || prevMedia?.bucket_name !== PREVIEW_MEDIA_BUCKET) {
      errors.push(`${label} R2 binding must target ${PREVIEW_MEDIA_BUCKET}.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function detectedBranch(env) {
  return String(
    env.WORKERS_CI_BRANCH ??
      env.CF_PAGES_BRANCH ??
      env.GITHUB_HEAD_REF ??
      env.GITHUB_REF_NAME ??
      "",
  ).trim();
}

function detectedWorker(env) {
  return String(env.CF_WORKER_NAME ?? env.WRANGLER_WORKER_NAME ?? "").trim();
}

export function verifyDeployTarget(mode, env = process.env, config = loadWranglerConfig()) {
  const configCheck = validateWranglerConfig(config);
  if (!configCheck.ok) {
    return { ok: false, mode, reason: configCheck.errors.join(" ") };
  }

  const worker = detectedWorker(env);
  if (worker && worker !== CANONICAL_WORKER_NAME) {
    return {
      ok: false,
      mode,
      reason: `Refusing to run against Worker "${worker}". Only canonical Worker "${CANONICAL_WORKER_NAME}" is supported by this repository.`,
    };
  }

  const explicitTarget = String(env.DYPOL_DEPLOY_TARGET ?? "").trim().toLowerCase();
  const dypolEnv = String(env.DYPOL_ENV ?? "").trim().toLowerCase();
  const branch = detectedBranch(env);

  if (mode === "local") {
    if (explicitTarget === "production" || explicitTarget === "preview") {
      return { ok: false, mode, reason: `Refusing local command when DYPOL_DEPLOY_TARGET="${explicitTarget}".` };
    }
    return { ok: true, mode, worker: CANONICAL_WORKER_NAME, database: "local" };
  }

  if (mode === "preview") {
    if (explicitTarget === "production" || dypolEnv === "production") {
      return {
        ok: false,
        mode,
        reason: "Refusing preview operation when DYPOL_DEPLOY_TARGET or DYPOL_ENV is set to production.",
      };
    }
    if (branch === PRODUCTION_BRANCH && explicitTarget !== "preview") {
      return {
        ok: false,
        mode,
        reason: `Refusing preview operation on branch "${PRODUCTION_BRANCH}" unless DYPOL_DEPLOY_TARGET=preview is explicitly set.`,
      };
    }
    if (explicitTarget !== "preview" && !branch) {
      return {
        ok: false,
        mode,
        reason: "Ambiguous preview context: set DYPOL_DEPLOY_TARGET=preview or run from a non-main branch in Workers Builds.",
      };
    }
    return {
      ok: true,
      mode: "preview",
      worker: CANONICAL_WORKER_NAME,
      branch: branch || "preview",
      database: PREVIEW_DB_NAME,
      databaseId: PREVIEW_DB_ID,
      mediaBucket: PREVIEW_MEDIA_BUCKET,
    };
  }

  if (mode === "production") {
    if (explicitTarget === "preview" || dypolEnv === "preview") {
      return {
        ok: false,
        mode,
        reason: "Refusing production migration/deployment when DYPOL_DEPLOY_TARGET or DYPOL_ENV is preview.",
      };
    }
    if (branch && branch !== PRODUCTION_BRANCH) {
      return {
        ok: false,
        mode,
        reason: `Refusing production migration/deployment from non-production branch "${branch}". Expected "${PRODUCTION_BRANCH}".`,
      };
    }
    const verifiedProd = explicitTarget === "production" || branch === PRODUCTION_BRANCH;
    if (!verifiedProd) {
      return {
        ok: false,
        mode,
        reason:
          "Ambiguous deployment context: refusing to touch production D1 or deploy production Worker without DYPOL_DEPLOY_TARGET=production (or WORKERS_CI_BRANCH=main).",
      };
    }
    return {
      ok: true,
      mode: "production",
      worker: CANONICAL_WORKER_NAME,
      branch: branch || PRODUCTION_BRANCH,
      database: PRODUCTION_DB_NAME,
      databaseId: PRODUCTION_DB_ID,
      mediaBucket: PRODUCTION_MEDIA_BUCKET,
    };
  }

  return { ok: false, mode, reason: `Unknown deploy verification mode "${mode}".` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sub = process.argv[2] ?? "";
  const mode =
    sub === "assert-prod"
      ? "production"
      : sub === "assert-preview"
        ? "preview"
        : sub === "assert-local"
          ? "local"
          : "";
  if (!mode) {
    console.error("Usage: node scripts/deploy-target.mjs <assert-prod|assert-preview|assert-local>");
    process.exit(1);
  }
  const outcome = verifyDeployTarget(mode);
  if (!outcome.ok) {
    console.error(`[deploy-target] BLOCKED (${mode}): ${outcome.reason}`);
    process.exit(1);
  }
  console.log(
    `[deploy-target] VERIFIED (${outcome.mode}): worker=${outcome.worker} db=${outcome.database}${outcome.databaseId ? ` (${outcome.databaseId})` : ""}`,
  );
}
