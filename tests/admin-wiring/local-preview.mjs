/** Destructive only to a temporary settings value in LOCAL D1, restored in finally.
 * Never accepts a remote target. Run a current built Worker locally first.
 * This bypasses admin forms: it is a storage→HTML integration test, not UI proof.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const origin = "http://127.0.0.1:8080";
const sql = (command) => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", command, "--json"], { encoding: "utf8" }));
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
await fetch(origin); // Allow the existing local content initialiser to run.
const initial = sql("select data from site_settings where id = 'site'")[0].results[0]?.data;
assert.ok(initial, "Local site settings must exist before this test");
const changed = JSON.parse(initial);
Object.assign(changed, { name: "Wiring Preview Journal", title: "Wiring Preview Tab", description: "Preview description for the settings wiring test.", publisher: "Preview Publisher" });
changed.footer = { note: "Preview footer {year}", links: [{ id: "preview-link", label: "Preview extra link", href: "/about" }], columns: [{ heading: "Preview column", links: [{ label: "Preview custom link", href: "/articles", newTab: true }] }] };
changed.appearance = { ...changed.appearance, whiteness: 90, darkness: 98 };
const write = (text) => sql(`update site_settings set data = ${quote(text)} where id = 'site'`);
try {
  write(JSON.stringify(changed));
  const response = await fetch(origin);
  const home = await response.text();
  assert.match(home, /Wiring Preview Journal/);
  assert.match(home, /<title>Wiring Preview Tab<\/title>/);
  assert.match(home, /Preview column/);
  assert.match(home, /Preview custom link/);
  assert.match(home, /Preview extra link/);
  assert.match(home, new RegExp(`Preview footer ${new Date().getFullYear()}`));
  assert.doesNotMatch(home, /<script[^>]+src="https:\/\/www.googletagmanager.com/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const page = await (await fetch(`${origin}/about`)).text();
  assert.match(page, /<p class="kicker">Wiring Preview Journal<\/p>/);
  const manifest = await (await fetch(`${origin}/manifest.webmanifest`)).json();
  assert.equal(manifest.name, changed.name);
  assert.equal(manifest.background_color, "#e6e6e6");
  console.log("PASS: local settings change reached home, footer, About and manifest without redeploy.");
} finally {
  write(initial);
  assert.equal(sql("select data from site_settings where id = 'site'")[0].results[0].data, initial);
  console.log("Restored original local settings exactly.");
}
