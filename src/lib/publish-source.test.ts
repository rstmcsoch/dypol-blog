import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MANUAL_ADMIN,
  authLabelFrom,
  formatDateTimeIST,
  formatPublishedVia,
  formatSourceLabel,
  inferProduct,
  mcpSourceFromAuth,
  sourceColumns,
  sourceFromAuthLabel,
  sourceFromRow,
  viaColumn,
} from "./publish-source.ts";

test("inferProduct from client name, origin host, or user-agent; never guesses", () => {
  assert.equal(inferProduct({ clientName: "Grok" }), "Grok");
  assert.equal(inferProduct({ clientName: "dypolblog production (main)" }), null);
  assert.equal(inferProduct({ clientName: "dypolblog production (main)", origin: "https://grok.com" }), "Grok");
  assert.equal(inferProduct({ origin: "https://claude.ai" }), "Claude");
  assert.equal(inferProduct({ redirectUri: "https://www.cursor.com/agents/mcp/oauth/callback" }), "Cursor");
  assert.equal(inferProduct({ userAgent: "Cursor/1.0" }), "Cursor");
  assert.equal(inferProduct({ userAgent: "undici" }), null);
  assert.equal(inferProduct({ origin: "https://evil.example" }), null);
  assert.equal(inferProduct({ clientName: "Google Docs Bot" }), null);
});

test("sourceFromAuthLabel parses automation_runs.auth values", () => {
  assert.deepEqual(sourceFromAuthLabel("oauth:Grok"), { via: "mcp", client: "Grok", product: "Grok", mcpAuth: "oauth" });
  assert.deepEqual(sourceFromAuthLabel("oauth:dypolblog production (main)"), {
    via: "mcp",
    client: "dypolblog production (main)",
    product: null,
    mcpAuth: "oauth",
  });
  assert.deepEqual(sourceFromAuthLabel("oauth:dypolblog production (main)", { origin: "https://grok.com" }), {
    via: "mcp",
    client: "dypolblog production (main)",
    product: "Grok",
    mcpAuth: "oauth",
  });
  assert.deepEqual(sourceFromAuthLabel("bearer"), { via: "mcp", client: null, product: null, mcpAuth: "bearer" });
  assert.deepEqual(sourceFromAuthLabel("profile-token"), { via: "mcp", client: null, product: null, mcpAuth: "profile-token" });
  assert.deepEqual(sourceFromAuthLabel("oauth"), { via: "mcp", client: "legacy connector", product: null, mcpAuth: "oauth" });
  assert.equal(sourceFromAuthLabel(""), null);
  assert.equal(sourceFromAuthLabel(null), null);
});

test("mcpSourceFromAuth and authLabelFrom stay compatible with existing run labels", () => {
  assert.equal(authLabelFrom({ via: "oauth", client: "Grok" }), "oauth:Grok");
  assert.equal(authLabelFrom({ via: "bearer" }), "bearer");
  assert.deepEqual(mcpSourceFromAuth({ via: "oauth", client: "Grok" }), { via: "mcp", client: "Grok", product: "Grok", mcpAuth: "oauth" });
  assert.deepEqual(mcpSourceFromAuth({ via: "bearer" }, { userAgent: "Grok/2026" }), { via: "mcp", client: null, product: "Grok", mcpAuth: "bearer" });
});

test("viaColumn round-trips through sourceFromRow", () => {
  assert.equal(viaColumn(MANUAL_ADMIN), "manual");
  assert.equal(viaColumn({ via: "mcp", mcpAuth: "oauth", client: "Grok", product: "Grok" }), "mcp-oauth");
  assert.equal(viaColumn({ via: "mcp", mcpAuth: "bearer" }), "mcp-bearer");
  assert.deepEqual(sourceFromRow("manual", null, null), { via: "manual", client: null, product: null });
  assert.deepEqual(sourceFromRow("mcp-bearer", null, "Grok"), { via: "mcp", client: null, product: "Grok", mcpAuth: "bearer" });
  assert.deepEqual(sourceFromRow("mcp-oauth", "dypolblog production (main)", "Grok"), {
    via: "mcp",
    client: "dypolblog production (main)",
    product: "Grok",
    mcpAuth: "oauth",
  });
  assert.equal(sourceFromRow(null, "Grok", "Grok"), null);
  assert.equal(sourceFromRow("something-else", "x", "y"), null);
  assert.deepEqual(sourceColumns({ via: "mcp", client: "  Grok  ", product: "Grok", mcpAuth: "oauth" }), {
    via: "mcp-oauth",
    client: "Grok",
    product: "Grok",
  });
});

test("formatSourceLabel covers MCP client + product and manual", () => {
  assert.equal(formatSourceLabel(MANUAL_ADMIN), "Manual (admin)");
  assert.equal(formatSourceLabel({ via: "mcp", client: "Grok", product: "Grok", mcpAuth: "oauth" }), "Grok MCP");
  assert.equal(formatSourceLabel({ via: "mcp", client: "dypolblog production (main)", product: "Grok", mcpAuth: "oauth" }), "dypolblog production (main) MCP from Grok");
  assert.equal(formatSourceLabel({ via: "mcp", client: "dypolblog production (main)", mcpAuth: "oauth" }), "dypolblog production (main) MCP");
  assert.equal(formatSourceLabel({ via: "mcp", mcpAuth: "bearer" }), "MCP (master token)");
  assert.equal(formatSourceLabel({ via: "mcp", mcpAuth: "profile-token" }), "MCP (profile API key)");
  assert.equal(formatSourceLabel({ via: "mcp" }), "MCP");
  assert.equal(formatSourceLabel(null), null);
});

test("formatDateTimeIST renders Asia/Kolkata with an IST label", () => {
  // 23 Nov 2026 09:00 UTC = 23 Nov 2026, 2:30 pm IST
  assert.equal(formatDateTimeIST("2026-11-23T09:00:00.000Z"), "23 Nov 2026, 2:30 pm IST");
  assert.equal(formatDateTimeIST("2026-11-22T18:30:00.000Z"), "23 Nov 2026, 12:00 am IST");
  assert.equal(formatDateTimeIST(null), null);
  assert.equal(formatDateTimeIST("not-a-date"), null);
});

test("formatPublishedVia: not recorded unless a source exists; drafts show created via", () => {
  assert.deepEqual(formatPublishedVia({ created: null, published: null, publishedAt: null, status: "draft" }), {
    primary: "Not yet published",
    secondary: undefined,
  });
  assert.deepEqual(
    formatPublishedVia({ created: sourceFromAuthLabel("oauth:Grok"), published: null, publishedAt: null, status: "draft" }),
    { primary: "Not yet published", secondary: "Created via Grok MCP" },
  );
  assert.deepEqual(
    formatPublishedVia({ created: null, published: null, publishedAt: "2026-11-23T09:00:00.000Z", status: "published" }),
    { primary: "Not recorded · 23 Nov 2026, 2:30 pm IST" },
  );
  assert.deepEqual(
    formatPublishedVia({
      created: { via: "mcp", client: "Grok", product: "Grok", mcpAuth: "oauth" },
      published: MANUAL_ADMIN,
      publishedAt: "2026-11-23T09:00:00.000Z",
      status: "published",
    }),
    { primary: "Manual (admin) · 23 Nov 2026, 2:30 pm IST" },
  );
  assert.deepEqual(
    formatPublishedVia({
      created: sourceFromAuthLabel("oauth:dypolblog production (main)", { origin: "https://grok.com" }),
      published: sourceFromAuthLabel("oauth:dypolblog production (main)", { origin: "https://grok.com" }),
      publishedAt: "2026-11-23T09:00:00.000Z",
      status: "published",
    }),
    { primary: "dypolblog production (main) MCP from Grok · 23 Nov 2026, 2:30 pm IST" },
  );
});
