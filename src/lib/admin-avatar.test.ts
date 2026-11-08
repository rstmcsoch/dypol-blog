import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
const root = new URL("../../", import.meta.url);
const shell = readFileSync(new URL("src/components/admin/shell.tsx", root), "utf8");

test("t219 admin account avatar uses the local image in the button and the menu, labels/actions unchanged", () => {
  assert.match(shell, /className="adm-avatar"\s+aria-label="Account menu"[\s\S]*?setMenu\(menu === "profile" \? null : "profile"\)\}\s*>\s*<img className="adm-avatar__img" src="\/admin-avatar-96\.webp" srcSet="\/admin-avatar-96\.webp 1x, \/admin-avatar-192\.webp 2x" width=\{38\} height=\{38\} alt=""/);
  assert.match(shell, /adm-avatar--lg" aria-hidden="true"><img className="adm-avatar__img" src="\/admin-avatar-192\.webp" width=\{64\} height=\{64\}/);
  for (const n of [96, 192]) {
    const b = readFileSync(new URL(`public/admin-avatar-${n}.webp`, root));
    assert.equal(b.subarray(0, 4).toString(), "RIFF");
    assert.equal(b.subarray(8, 12).toString(), "WEBP");
    assert.ok(statSync(new URL(`public/admin-avatar-${n}.webp`, root)).size < 20000);
  }
});
