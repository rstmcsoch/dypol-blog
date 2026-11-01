import { createServerFn } from "@tanstack/react-start";

/** t148: admin ads endpoints. Code fields are admin-only and stored as-is. */
async function guard() {
  const { requireAdmin } = await import("@/lib/auth/admin.server");
  const admin = await requireAdmin();
  return admin.email ?? "editor";
}
async function writeGuard() {
  const { requireWriter } = await import("@/lib/auth/admin.server");
  const admin = await requireWriter();
  return admin.email ?? "editor";
}

export const adminAds = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { readAdsSettings, auditLog } = await import("@/lib/ads/ads.server");
  const settings = await readAdsSettings();
  return { settings, audit: await auditLog(60), now: Date.now() };
});

export const adminSaveAds = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { settings: unknown; reason?: string })
  .handler(async ({ data }) => {
    const actor = await writeGuard();
    const { saveAdsSettings } = await import("@/lib/ads/ads.server");
    const reason = typeof data?.reason === "string" ? data.reason.slice(0, 60) : "save";
    const settings = await saveAdsSettings(data?.settings, actor, reason);
    const { logAdminAction } = await import("./repository.server");
    await logAdminAction("ads.save", `Updated ads settings (${reason})`);
    return { settings };
  });

export const adminAdVersions = createServerFn({ method: "GET" })
  .validator((input: { slotId: string }) => input)
  .handler(async ({ data }) => {
    await guard();
    const { slotVersions } = await import("@/lib/ads/ads.server");
    return slotVersions(String(data.slotId));
  });

export const adminRestoreAdVersion = createServerFn({ method: "POST" })
  .validator((input: { versionId: string }) => input)
  .handler(async ({ data }) => {
    const actor = await writeGuard();
    const { restoreSlotVersion } = await import("@/lib/ads/ads.server");
    return { settings: await restoreSlotVersion(String(data.versionId), actor) };
  });

export const adminUploadBanner = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { dataBase64: string; size: string; alt: string })
  .handler(async ({ data }) => {
    const actor = await writeGuard();
    const { storeBanner, adsAudit } = await import("@/lib/ads/ads.server");
    if (typeof data?.dataBase64 !== "string" || data.dataBase64.length > 600_000) throw new Error("The file is too large (limit 300 KB).");
    if (typeof data.alt !== "string" || !data.alt.trim()) throw new Error("Alt text is required.");
    const out = await storeBanner({ dataBase64: data.dataBase64, size: data.size as never, alt: data.alt });
    await adsAudit("banner.upload", `Uploaded ${out.size} banner ${out.key} (${Math.round(out.bytes / 1024)} KB)`, actor);
    return out;
  });

export const adminAdStats = createServerFn({ method: "GET" })
  .validator((input: { days: number }) => input)
  .handler(async ({ data }) => {
    await guard();
    const { adStats } = await import("@/lib/ads/ads.server");
    return adStats(Number(data.days) || 7);
  });

/** Admin-only placement preview on the public site (?adpreview=1). */
export const adPreviewAllowed = createServerFn({ method: "GET" }).handler(async () => {
  try {
    await guard();
    return true;
  } catch {
    return false;
  }
});
