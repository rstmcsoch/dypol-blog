# Admin wiring regression coverage (partial)

- `npm run test:admin-wiring`: settings validation/round-trip, footer safe URLs,
  pagination window regression, placeholder socials, publisher/logo JSON-LD,
  source-level identity and consent guard checks.
- `npm run test:admin-wiring:local`: storage-to-render integration against a
  **locally running current built Worker** and local Wrangler D1. Changes name,
  title, description, footer and appearance, checks HTML/manifest immediately,
  then restores the exact original settings JSON in `finally`.

For matching local storage, launch the built preview with an explicit state path:

```sh
npx wrangler dev --config dist/server/wrangler.json --persist-to "$PWD/.wrangler/state" --ip 0.0.0.0 --port 8080 --local
```

The local script cannot target production or a remote D1 database. It bypasses
admin forms; it does **not** prove authenticated UI control behaviour, browser
navigation cache behaviour, or the full section D acceptance criteria.

Not yet covered: authenticated change/revert of every control; GA accept/reject
network assertions in a real browser; Lighthouse; live Turnstile; remote preview.
See AUDIT-REPORT.md for remaining work and release blockers.
