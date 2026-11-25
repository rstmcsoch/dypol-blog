import { createServerFn } from "@tanstack/react-start";
import { parseAdminRedirects } from "@/lib/automation/oauth-client";
import type { MasterAuthMethod } from "./master-mcp-profiles.server";
import type { MasterPermissionKey } from "@/lib/mcp/master/permissions";

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
  const [connection, profiles, permissionToggles] = await Promise.all([
    store.getMasterConnection(),
    profilesStore.listMasterProfiles(),
    store.getMasterPermissions(),
  ]);
  return {
    connection,
    profiles,
    permissionToggles,
    toggleablePermissions: perms.MASTER_TOGGLEABLE_PERMISSIONS,
    lockedPermissions: perms.MASTER_LOCKED_PERMISSIONS,
  };
});

export const adminCreateMasterCredential = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { name?: string; authMethod?: MasterAuthMethod; redirects?: unknown })
  .handler(async ({ data }) => {
    await writeGuard();
    const name = (data?.name ?? "").trim();
    if (!name) throw new Error("Profile name is required.");
    const authMethod: MasterAuthMethod = data?.authMethod === "oauth" ? "oauth" : "api_key";
    const rawRedirects = typeof data?.redirects === "string" ? data.redirects.trim() : "";
    const redirectUris = authMethod === "oauth" && rawRedirects ? parseAdminRedirects(rawRedirects) : [];
    const profilesStore = await import("./master-mcp-profiles.server");
    return await profilesStore.createMasterProfile({ name, authMethod, redirectUris });
  });

export const adminRenameMasterCredential = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { id: string; name: string })
  .handler(async ({ data }) => {
    await writeGuard();
    const profilesStore = await import("./master-mcp-profiles.server");
    return await profilesStore.renameMasterProfile(data.id, data.name);
  });

export const adminRotateMasterCredential = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    await writeGuard();
    const profilesStore = await import("./master-mcp-profiles.server");
    return await profilesStore.rotateMasterProfile(data.id);
  });

export const adminDeactivateMasterCredential = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    await writeGuard();
    const profilesStore = await import("./master-mcp-profiles.server");
    await profilesStore.deactivateMasterProfile(data.id);
    return { ok: true };
  });

export const adminReactivateMasterCredential = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    await writeGuard();
    const profilesStore = await import("./master-mcp-profiles.server");
    await profilesStore.reactivateMasterProfile(data.id);
    return { ok: true };
  });

export const adminRevokeMasterCredential = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    await writeGuard();
    const profilesStore = await import("./master-mcp-profiles.server");
    await profilesStore.revokeMasterProfile(data.id);
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

export const adminUpdateMasterPermissions = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { key: MasterPermissionKey; enabled: boolean })
  .handler(async ({ data }) => {
    await writeGuard();
    const store = await import("./master-mcp.server");
    const permissionToggles = await store.setMasterPermission(data.key, Boolean(data.enabled));
    return { permissionToggles };
  });

export const adminIssueMasterOauth = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { name?: string; redirects?: unknown })
  .handler(async ({ data }) => {
    await writeGuard();
    const name = (data?.name ?? "").trim();
    if (!name) throw new Error("Profile name is required.");
    const rawRedirects = typeof data?.redirects === "string" ? data.redirects.trim() : "";
    const redirectUris = rawRedirects ? parseAdminRedirects(rawRedirects) : [];
    const profilesStore = await import("./master-mcp-profiles.server");
    return await profilesStore.createMasterProfile({ name, authMethod: "oauth", redirectUris });
  });

export const adminRevokeMasterOauth = createServerFn({ method: "POST" }).handler(async () => {
  await writeGuard();
  const store = await import("./master-mcp.server");
  await store.revokeMasterOauthClient();
  return { ok: true };
});
