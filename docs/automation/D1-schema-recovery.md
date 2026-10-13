# Automation D1 schema recovery

## Symptom and repository-level cause

The admin Automations/History routes and the scheduler need the durable schedule table `automation_schedule`, created by `migrations/d1/0004_automations.sql`. The reported `D1_ERROR: no such table: automation_schedule` proves that the database reached by the failing request does not contain that table.

The versioned migration is already present and additive. The repository-level deployment gap was that the old `deploy` command built and deployed the Worker without applying D1 migrations. The corrected production deploy command applies pending migrations from the checked-in `migrations/d1` directory before deploying. The Wrangler config binds `DB` to database `dypol-blog-db` (`78708341-8467-4140-bfa7-0531f14a7aee`) and the preview binding is separate.

That identifies the likely code/deployment cause, but it does **not** prove which database the current production Worker is actually bound to or whether Wrangler's migration tracker records `0004` as applied. There is no checked-in GitHub deploy workflow, and the external Workers Builds dashboard command is not available here; verify that it runs the migration-first deployment path rather than invoking raw `wrangler deploy`. Cloudflare credentials are not available in this workspace, so live bindings, migration history and Worker logs remain unverified. Do not infer that a missing table should be recreated until those read-only checks identify the intended D1 database and migration state.

## Safe production verification

1. Confirm Wrangler is authenticated (`npx wrangler whoami`). This workspace currently reports that it is not.
2. Verify the Worker binding in Cloudflare matches the production `DB` binding in `wrangler.jsonc`.
3. Inspect migration history without changing data:

   ```sh
   npx wrangler d1 migrations list DB --remote --config wrangler.jsonc
   ```

4. If the correct database has pending migrations, run the production-only deployment path (`npm run deploy`), which builds, applies pending migrations and deploys the Worker. `npm run db:migrate:remote` is also available as the explicit migration-only command. If Workers Builds separates build and deploy steps, its **production deploy command** must apply pending migrations before `wrangler deploy -c dist/server/wrangler.json`; do not run the production migration command for preview builds.
5. If `0004_automations.sql` is recorded as applied while `automation_schedule` is missing, stop. Verify the binding and schema drift; do not rerun non-idempotent `ALTER TABLE` statements and do not reset, drop or recreate the database. Only add a forward-only, version-controlled repair migration after the actual state is understood.

Preview/local work uses `npm run db:migrate` against Wrangler's local D1. The preview D1 binding is separate in `wrangler.jsonc`; never point a preview at production to get past a schema error.

## Runtime behavior

- The admin Automations and History loaders read the `sqlite_master` catalog and fixed allow-listed `PRAGMA table_info` schemas before issuing automation queries. The preflight is read-only.
- A schema mismatch returns an authorized-admin diagnostic with the detected `DYPOL_ENV`, exact missing tables/columns and suggested migration names. It asks operators to verify the binding/tracker before applying only pending migrations.
- Save, delete, duplicate, test, run and History-query actions perform the same preflight before any automation mutation/query. They do not treat a failed query as an empty run list or zero failures.
- The protected `/api/automation/tick` route reports the diagnostic with a non-success response; the Cloudflare cron handler writes the reason to Worker logs. Public article routes are not made dependent on the automation schema.
- The check makes no D1 changes and the UI explicitly advises against resets/recreation.

## Local verification in this change

- `npm run db:migrate` applied the checked-in migrations to Wrangler's **local** D1 only; no remote migration was attempted.
- Schema-preflight unit tests cover ready state, missing schedule table, missing run-history columns, migration suggestions and safe error text.
- `npm run test:e2e:automation` (with local `ADMIN_TOKEN`/`CRON_SECRET`) exercises both admin pages, the authorized dry-run server action, History query, and the anonymous/authorized tick route against local D1.
- Production migration status, bindings, logs and deployment are unverified until Cloudflare access is restored.
