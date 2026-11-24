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
  const [store, profilesStore, perms] = await Promise.all([
    import("./master-mcp.server"),
    import("./master-mcp-profiles.server"),
    import("@/lib/mcp/master/permissions"),
  ]);
  const [connection, profiles, usage, audit] = await Promise.all([
    store.getMasterConnection(),
    profilesStore.listMasterProfiles(),
    store.masterUsageStats(),
    store.listMasterAudit(30),
  ]);
  return { connection, profiles, usage, audit, permissions: perms.MASTER_PERMISSION_SUMMARY };
});

export const adminCreateMasterCredential = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { name?: string })
  .handler(async ({ data }) => {
    await writeGuard();
    const profilesStore = await import("./master-mcp-profiles.server");
    return await profilesStore.createMasterProfile(data?.name);
  });

export const adminRenameMasterCredential = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { id: string; name: string })
  .handler(async ({ data }) => {
    await writeGuard();
    const profilesStore = await import("./master-mcp-profiles.server");
    return await profilesStore.renameMasterProfile(data.id, data.name);
  });

export const adminRotateMasterCredential = createServerFn({ method: "POST" })
  .validator((data: unknown) => (data ?? {}) as { id?: string })
  .handler(async ({ data }) => {
    await writeGuard();
    const profilesStore = await import("./master-mcp-profiles.server");
    return await profilesStore.rotateMasterProfile(data?.id);
  });

export const adminDeactivateMasterCredential = createServerFn({ method: "POST" })
  .validator((data: unknown) => (data ?? {}) as { id?: string })
  .handler(async ({ data }) => {
    await writeGuard();
    const profilesStore = await import("./master-mcp-profiles.server");
    await profilesStore.deactivateMasterProfile(data?.id);
    return { ok: true };
  });

export const adminReactivateMasterCredential = createServerFn({ method: "POST" })
  .validator((data: unknown) => (data ?? {}) as { id?: string })
  .handler(async ({ data }) => {
    await writeGuard();
    const profilesStore = await import("./master-mcp-profiles.server");
    await profilesStore.reactivateMasterProfile(data?.id);
    return { ok: true };
  });

export const adminRevokeMasterCredential = createServerFn({ method: "POST" })
  .validator((data: unknown) => (data ?? {}) as { id?: string })
  .handler(async ({ data }) => {
    await writeGuard();
    const profilesStore = await import("./master-mcp-profiles.server");
    await profilesStore.revokeMasterProfile(data?.id);
    return { ok: true };
  });

export const adminDeleteMasterCredential = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    await writeGuard();
    const profilesStore = await import("./master-mcp-profiles.server");
    await profilesStore.deleteMasterProfile(data.id);
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
