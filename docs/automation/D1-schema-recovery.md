# Automation D1 schema recovery & deployment separation

## Symptom and repository-level cause

The admin Automations/History routes and the scheduler need the durable schedule table `automation_schedule`, created by `migrations/d1/0004_automations.sql`. The reported `D1_ERROR: no such table: automation_schedule` proves that the database reached by the failing request does not contain that table.

The versioned migration is already present and additive (`migrations/d1/0004_automations.sql`). Two deployment hazards existed in earlier revisions:

1. **Pre-PR #8**: `npm run deploy` built and deployed the Worker without applying remote D1 migrations.
2. **PR #8 (`1a4fc3bd44`)**: `db:migrate:remote` ran `wrangler d1 migrations apply DB --remote --config wrangler.jsonc` unconditionally against the top-level production `dypol-blog-db` (`78708341-8467-4140-bfa7-0531f14a7aee`) with no branch, environment, or Worker-name guard, and `wrangler.jsonc` lacked an `--env preview` target for `dypol-blog-db-preview` (`c9030fb4-8657-47d9-bf6f-e8c11650bdd5`). In addition, a duplicate Cloudflare Worker (`dypol-blog`, with a hyphen) was connected to the repository alongside canonical Worker `dypolblog`.

## Fail-closed environment separation

`scripts/deploy-target.mjs`, `package.json`, and `wrangler.jsonc` now enforce strict, fail-closed separation between local development, preview builds/migrations, and production migrations/deployments:

| Environment | Migration Command | Deploy / Upload Command | Target Worker | Target D1 Database | Target R2 Bucket |
| --- | --- | --- | --- | --- | --- |
| **Local dev** | `npm run db:migrate` (`--local`) | `npm run dev` / `npm run preview` | local Miniflare | local SQLite | local R2 |
| **Preview** (non-`main` branches) | `DYPOL_DEPLOY_TARGET=preview npm run db:migrate:preview` (`--remote --env preview`) | `DYPOL_DEPLOY_TARGET=preview npm run deploy:preview` (`wrangler versions upload`) | `dypolblog` (preview) | `dypol-blog-db-preview` (`c9030fb4-8657-47d9-bf6f-e8c11650bdd5`) | `dypol-blog-media-preview` |
| **Production** (`main` branch only) | `DYPOL_DEPLOY_TARGET=production npm run db:migrate:prod` (`--remote`) | `DYPOL_DEPLOY_TARGET=production npm run deploy:prod` (or `npm run deploy`) | `dypolblog` | `dypol-blog-db` (`78708341-8467-4140-bfa7-0531f14a7aee`) | `dypol-blog-media` |

Safeguards enforced by `scripts/deploy-target.mjs`:
- `assert-prod` fails closed if `DYPOL_DEPLOY_TARGET` is not `"production"` (unless `WORKERS_CI_BRANCH=main`), if `WORKERS_CI_BRANCH` is any non-`main` branch, if `DYPOL_ENV=preview`, or if `CF_WORKER_NAME` is anything other than `"dypolblog"` (specifically blocking the duplicate `"dypol-blog"` Worker).
- `assert-preview` fails closed if `DYPOL_DEPLOY_TARGET=production`, `DYPOL_ENV=production`, or `WORKERS_CI_BRANCH=main` (without explicit `DYPOL_DEPLOY_TARGET=preview`), and targets only `--env preview` (`dypol-blog-db-preview`).

## Safe production verification & release procedure

1. Confirm Wrangler is authenticated (`npx wrangler whoami`) and you have access to Cloudflare account `b006dbecdf366ee0b2c21b378049d50a`.
2. Verify in the Cloudflare dashboard that canonical Worker `dypolblog` serves `https://dypolblog.rstmcsoch.workers.dev` and is bound to `dypol-blog-db` (`78708341-8467-4140-bfa7-0531f14a7aee`), and check whether legacy/duplicate Worker `dypol-blog` serves any traffic before disabling its Workers Builds trigger.
3. Export a backup of `dypol-blog-db` before any schema change:
   ```sh
   npx wrangler d1 export dypol-blog-db --remote --output=backup-dypol-blog-db-$(date -u +%Y%m%dT%H%M%SZ).sql --config wrangler.jsonc
   ```
4. Inspect remote migration history and live schema without changing data:
   ```sh
   npx wrangler d1 migrations list DB --remote --config wrangler.jsonc
   npx wrangler d1 execute dypol-blog-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" --config wrangler.jsonc
   ```
5. If `0004_automations.sql` is pending on `dypol-blog-db`, run the guarded production release from `main`:
   ```sh
   DYPOL_DEPLOY_TARGET=production npm run deploy:prod
   ```
6. If `0004_automations.sql` is already marked applied in `d1_migrations` while `automation_schedule` or `automations` is absent from `sqlite_master`, **stop**. Do not reset, drop, or recreate the database, and do not re-run non-idempotent `ALTER TABLE` statements; author a forward-only `0005_*.sql` migration creating only the missing objects identified from `sqlite_master` and `PRAGMA table_info(...)`.

## Runtime behavior

- The admin Automations and History loaders inspect `sqlite_master` and allow-listed `PRAGMA table_info` schemas before issuing automation queries. The preflight is read-only.
- On read-only deployments (`writesAllowed() === false`), `listAutomations()` never mutates D1 when the table is empty.
- The protected `/api/automation/tick` route returns HTTP `503` with structured `code`, `environment`, and `schema` diagnostics when `AutomationSchemaNotReadyError` is raised, and refuses non-dry-run mutations on read-only deployments with HTTP `403`.
