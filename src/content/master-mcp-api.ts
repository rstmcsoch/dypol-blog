import { createServerFn } from "@tanstack/react-start";
import { parseAdminRedirects } from "@/lib/automation/oauth-client";

async function guard() {
  const { requireAdmin } = await import("@/lib/auth/admin.server");
  return requireAdmin();
}

async function writeGuard() {
  const { requireWriter } = await import("@/lib/auth/admin.server");
  return requireWriter();
}

export const adminMasterMcp = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const store = await import("./master-mcp.server");
  const { MASTER_PERMISSION_SUMMARY } = await import("@/lib/mcp/master/permissions");
  const [connection, usage, audit] = await Promise.all([
    store.getMasterConnection(),
    store.masterUsageStats(),
    store.listMasterAudit(30),
  ]);
  return { connection, usage, audit, permissions: MASTER_PERMISSION_SUMMARY };
});

export const adminCreateMasterCredential = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { name?: string })
  .handler(async ({ data }) => {
    await writeGuard();
    const store = await import("./master-mcp.server");
    return await store.createMasterCredential(data?.name);
  });

export const adminRotateMasterCredential = createServerFn({ method: "POST" }).handler(async () => {
  await writeGuard();
  const store = await import("./master-mcp.server");
  return await store.rotateMasterCredential();
});

export const adminDeactivateMasterCredential = createServerFn({ method: "POST" }).handler(async () => {
  await writeGuard();
  const store = await import("./master-mcp.server");
  await store.deactivateMasterCredential();
  return { ok: true };
});

export const adminReactivateMasterCredential = createServerFn({ method: "POST" }).handler(async () => {
  await writeGuard();
  const store = await import("./master-mcp.server");
  await store.reactivateMasterCredential();
  return { ok: true };
});

export const adminRevokeMasterCredential = createServerFn({ method: "POST" }).handler(async () => {
  await writeGuard();
  const store = await import("./master-mcp.server");
  await store.revokeMasterCredential();
  return { ok: true };
});

export const adminIssueMasterOauth = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { name?: string; redirects?: unknown })
  .handler(async ({ data }) => {
    await writeGuard();
    const redirects = parseAdminRedirects(data?.redirects);
    const store = await import("./master-mcp.server");
    return await store.issueMasterOauthClient({ name: data?.name ?? "Master MCP OAuth", redirectUris: redirects });
  });

export const adminRevokeMasterOauth = createServerFn({ method: "POST" }).handler(async () => {
  await writeGuard();
  const store = await import("./master-mcp.server");
  await store.revokeMasterOauthClient();
  return { ok: true };
});
