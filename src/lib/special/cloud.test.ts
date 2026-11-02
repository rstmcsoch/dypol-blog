import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDERS, authorizeUrl, cloudApi, grantedCaps, insideFolders, isOAuthCloud, openTokens, pkceChallenge, protonLinkProblem,
  providerOfUrl, randomToken, scopesFor, sealTokens, type CloudFile,
} from "./cloud.ts";
import { cloudTools } from "./cloud-tools.server.ts";
import { DEFAULT_SPECIAL_SETTINGS } from "./settings.ts";

const file = (o: Partial<CloudFile>): CloudFile => ({ id: "f1", name: "a.txt", kind: "file", mime: "text/plain", size: 1, modified: null, webUrl: null, path: null, parents: [], ...o });

test("PKCE: verifier is url-safe and the S256 challenge matches RFC 7636 appendix B", async () => {
  const v = randomToken();
  assert.match(v, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(v, randomToken());
  assert.equal(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("seal/open round-trips and rejects tampering, wrong key and wrong provider", async () => {
  const tokens = { access_token: "at-secret", refresh_token: "rt-secret", expires_at: 123, scope: "x" };
  const sealed = await sealTokens("k".repeat(32), tokens, "dropbox");
  assert.ok(!sealed.ciphertext.includes("secret"));
  assert.deepEqual(await openTokens("k".repeat(32), sealed, "dropbox"), tokens);
  await assert.rejects(openTokens("j".repeat(32), sealed, "dropbox"));
  await assert.rejects(openTokens("k".repeat(32), sealed, "onedrive"));
  const flipped = sealed.ciphertext.slice(0, 4) + (sealed.ciphertext[4] === "A" ? "B" : "A") + sealed.ciphertext.slice(5);
  await assert.rejects(openTokens("k".repeat(32), { ...sealed, ciphertext: flipped }, "dropbox"));
});

test("least privilege: read-only scopes by default, write scopes only when asked", () => {
  assert.deepEqual(scopesFor("google-drive", []).filter((s) => !/openid|email|profile/.test(s)).map((s) => s.split("/").pop()), ["drive.readonly"]);
  assert.ok(!scopesFor("onedrive", []).some((s) => /ReadWrite/.test(s)));
  assert.ok(scopesFor("onedrive", ["upload"]).some((s) => /Files\.ReadWrite/.test(s)));
  assert.ok(!scopesFor("dropbox", []).some((s) => /write/.test(s)));
  assert.ok(scopesFor("dropbox", ["share"]).includes("sharing.write"));
  assert.deepEqual(grantedCaps("dropbox", "files.metadata.read files.content.read"), ["read"]);
  assert.ok(grantedCaps("dropbox", "files.metadata.read files.content.read sharing.write").includes("share"));
  assert.ok(isOAuthCloud("onedrive") && !isOAuthCloud("proton-drive") && !isOAuthCloud("x"));
  for (const p of ["google-drive", "onedrive", "dropbox"] as const) assert.ok(PROVIDERS[p].env.id && PROVIDERS[p].env.secret);
});

test("authorize URL carries state, PKCE S256, redirect and only the requested scopes", async () => {
  for (const p of ["google-drive", "onedrive", "dropbox"] as const) {
    const u = new URL(await authorizeUrl(p, { clientId: "cid", redirectUri: "https://blog.example/admin/api/cloud/callback/" + p, state: "st8", verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", caps: [] }));
    assert.equal(u.protocol, "https:");
    assert.equal(u.searchParams.get("client_id"), "cid");
    assert.equal(u.searchParams.get("state"), "st8");
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.equal(u.searchParams.get("code_challenge"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    assert.equal(u.searchParams.get("response_type"), "code");
    assert.ok(!/ReadWrite|write|drive\.file/.test(u.searchParams.get("scope") ?? ""), `${p} read-only scope`);
    assert.ok(!u.toString().includes("secret"));
  }
});

test("Proton accepts only public share links; provider detection from URLs", () => {
  assert.equal(protonLinkProblem("https://drive.proton.me/urls/ABCDEF123#key"), null);
  assert.ok(protonLinkProblem("http://drive.proton.me/urls/ABCDEF123"));
  assert.ok(protonLinkProblem("https://evil.example/urls/ABCDEF123"));
  assert.ok(protonLinkProblem("https://drive.proton.me/u/0/folder"));
  assert.ok(protonLinkProblem("not a url"));
  assert.equal(providerOfUrl("https://docs.google.com/document/d/x"), "google-drive");
  assert.equal(providerOfUrl("https://1drv.ms/x"), "onedrive");
  assert.equal(providerOfUrl("https://www.dropbox.com/s/x"), "dropbox");
  assert.equal(providerOfUrl("https://drive.proton.me/urls/x"), "proton-drive");
  assert.equal(providerOfUrl("https://example.com"), "link");
});

test("folder restriction: id, direct parent, ancestors and path prefixes", () => {
  assert.equal(insideFolders(file({}), []), true);
  assert.equal(insideFolders(file({ parents: ["F"] }), [{ id: "F" }]), true);
  assert.equal(insideFolders(file({ parents: ["G"] }), [{ id: "F" }]), false);
  assert.equal(insideFolders(file({ parents: ["G"] }), [{ id: "F" }], ["F"]), true);
  assert.equal(insideFolders(file({ path: "/Research/2026/a.txt" }), [{ id: "x", path: "/research" }]), true);
  assert.equal(insideFolders(file({ path: "/Researchers/a.txt" }), [{ id: "x", path: "/Research" }]), false);
});

type Call = { url: string; init?: RequestInit };
const fake = (handler: (url: string, init?: RequestInit) => Response) => {
  const calls: Call[] = [];
  return { calls, fetcher: async (url: string, init?: RequestInit) => { calls.push({ url, init }); return handler(url, init); } };
};
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const bearer = (c: Call) => new Headers(c.init?.headers).get("authorization");

test("OneDrive download follows the 302 WITHOUT sending the bearer token", async () => {
  const f = fake((url) => {
    if (url.includes("/content")) return new Response(null, { status: 302, headers: { location: "https://cdn.example/pre-auth?x=1" } });
    if (url.startsWith("https://cdn.example")) return new Response("hello");
    return json({ id: "i1", name: "n.txt", size: 5, file: { mimeType: "text/plain" }, parentReference: { id: "p" } });
  });
  const out = await cloudApi("onedrive", "TOKEN", f.fetcher).download("i1", 1000);
  assert.equal(new TextDecoder().decode(out.bytes), "hello");
  const cdn = f.calls.find((c) => c.url.startsWith("https://cdn.example"))!;
  assert.equal(bearer(cdn), null);
  assert.equal(bearer(f.calls.find((c) => c.url.includes("/content"))!), "Bearer TOKEN");
});

test("Google list/search map files; download is size-capped; API errors surface", async () => {
  const f = fake((url) => {
    if (url.includes("/files?")) return json({ files: [{ id: "a", name: "Doc", mimeType: "application/vnd.google-apps.folder", parents: ["root"] }, { id: "b", name: "x.csv", mimeType: "text/csv", size: "10", parents: ["a"] }] });
    if (url.includes("alt=media")) return new Response("x".repeat(5000));
    if (url.includes("/files/b")) return json({ id: "b", name: "x.csv", mimeType: "text/csv", size: "5000", parents: ["a"] });
    return json({ error: { message: "nope" } }, 403);
  });
  const api = cloudApi("google-drive", "T", f.fetcher);
  const listed = await api.list(null);
  assert.deepEqual(listed.map((x) => [x.id, x.kind]), [["a", "folder"], ["b", "file"]]);
  await assert.rejects(api.download("b", 100));
  await assert.rejects(api.metadata("zzz"));
  assert.ok(f.calls.every((c) => bearer(c) === "Bearer T"));
});

test("Dropbox share link reuses an existing link", async () => {
  const f = fake(() => json({ error: { shared_link_already_exists: { metadata: { url: "https://www.dropbox.com/s/existing" } } } }, 409));
  assert.equal(await cloudApi("dropbox", "T", f.fetcher).shareLink("/a.pdf"), "https://www.dropbox.com/s/existing");
});

const deps = { profileId: "default", auth: "api-key" as const, loadSettings: async () => DEFAULT_SPECIAL_SETTINGS, attemptAutoPublish: async () => null };
const names = (cloud: Parameters<typeof cloudTools>[0]["cloud"], c: Partial<typeof DEFAULT_SPECIAL_SETTINGS.cloud> = {}) =>
  cloudTools({ settings: { ...DEFAULT_SPECIAL_SETTINGS, enabled: true, cloud: { ...DEFAULT_SPECIAL_SETTINGS.cloud, ...c } }, cloud }, deps as never).map((t) => t.name).sort();

test("cloud tools: read tools only by default; share/upload need the owner's switches", () => {
  const read = ["attach_cloud_resource", "get_cloud_file_metadata", "list_connected_cloud_folder", "read_cloud_file", "search_connected_cloud_files"];
  assert.deepEqual(names(["google-drive"]), read);
  assert.deepEqual(names(["google-drive"], { allowShareLinks: true }), [...read, "create_cloud_share_link"].sort());
  assert.deepEqual(names(["dropbox"], { allowUpload: true }), [...read, "upload_generated_document"].sort());
  // Proton is links-only: never share/upload even when switched on.
  assert.ok(!names(["proton-drive"], { allowShareLinks: true, allowUpload: true }).some((n) => n === "create_cloud_share_link" || n === "upload_generated_document"));
});

test("create_cloud_share_link refuses without confirm:true", async () => {
  const t = cloudTools({ settings: { ...DEFAULT_SPECIAL_SETTINGS, enabled: true, cloud: { ...DEFAULT_SPECIAL_SETTINGS.cloud, allowShareLinks: true } }, cloud: ["dropbox"] }, deps as never).find((x) => x.name === "create_cloud_share_link")!;
  const r = await t.run({ provider: "dropbox", file_id: "/a" });
  assert.equal(r.ok, false);
  const schema = JSON.stringify(t.inputSchema);
  assert.ok(schema.includes("confirm"));
});
