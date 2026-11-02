import { createServerFn } from "@tanstack/react-start";
import type { DatePreset } from "@/lib/analytics-dates";
import { parseAdminRedirects } from "@/lib/automation/oauth-client";

async function guard() {
  const { requireAdmin } = await import("@/lib/auth/admin.server");
  return requireAdmin();
}

/** Every write: valid desk session, same-origin request, writable deployment. */
async function writeGuard() {
  const { requireWriter } = await import("@/lib/auth/admin.server");
  return requireWriter();
}

export const adminSession = createServerFn({ method: "GET" })
  .handler(async () => {
    const admin = await guard();
    const { listGrants } = await import("@/lib/auth/admin.server");
    return { email: admin.email, mode: admin.mode, grants: admin.mode === "account" ? await listGrants() : [] };
  });

export const adminDashboard = createServerFn({ method: "GET" })
  .handler(async () => {
    await guard();
    const { adminOverview } = await import("./repository.server");
    return adminOverview();
  });

export const adminArticles = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await guard();
    const { adminList } = await import("./repository.server");
    const { articleListSchema } = await import("./validate");
    return adminList(articleListSchema.parse(data));
  });

export const adminEditorData = createServerFn({ method: "GET" })
  .validator((input: { id: string | null }) => input)
  .handler(async ({ data }) => {
    await guard();
    const { adminEditor } = await import("./repository.server");
    return adminEditor(data.id);
  });

export const adminSaveArticle = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { saveArticle, logAdminAction } = await import("./repository.server");
    const out = await saveArticle(data);
    await logAdminAction("article.save", `Saved article ${out.slug} (${out.status})`);
    return out;
  });

/* ---------- t173: special articles (admin only; R2 body + D1 metadata) ---------- */

export const adminSpecialEditorData = createServerFn({ method: "GET" })
  .validator((input: { id: string | null }) => ({ id: input?.id ? String(input.id).slice(0, 80) : null }))
  .handler(async ({ data }) => {
    await guard();
    const { adminEditor, articleTypeOf } = await import("./repository.server");
    const base = await adminEditor(data.id);
    if (data.id) {
      const type = await articleTypeOf(data.id);
      if (type === null) return { ...base, article: null, special: null, notSpecial: false };
      if (type !== "special") return { ...base, article: null, special: null, notSpecial: true };
      const { specialEditorBody } = await import("./special.server");
      return { ...base, special: await specialEditorBody(data.id), notSpecial: false };
    }
    return { ...base, special: null, notSpecial: false };
  });

export const adminSaveSpecialArticle = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { saveSpecialArticle } = await import("./special.server");
    const { logAdminAction } = await import("./repository.server");
    const out = await saveSpecialArticle(data, "admin");
    await logAdminAction("special.save", `Saved special article ${out.slug} v${out.version} (${out.status})`);
    return out;
  });

export const adminAutosaveSpecial = createServerFn({ method: "POST" })
  .validator((input: { id: string; content: unknown }) => ({ id: String(input?.id ?? "").slice(0, 80), content: input?.content }))
  .handler(async ({ data }) => {
    await writeGuard();
    const { autosaveSpecial } = await import("./special.server");
    return autosaveSpecial(data.id, data.content);
  });

export const adminRestoreSpecialVersion = createServerFn({ method: "POST" })
  .validator((input: { id: string; version: number }) => ({ id: String(input?.id ?? "").slice(0, 80), version: Math.max(1, Math.floor(Number(input?.version) || 0)) }))
  .handler(async ({ data }) => {
    await writeGuard();
    const { restoreSpecialVersion } = await import("./special.server");
    const { logAdminAction } = await import("./repository.server");
    const out = await restoreSpecialVersion(data.id, data.version, "admin");
    await logAdminAction("special.restore", `Restored special article version v${data.version} as v${out?.version}`);
    return out;
  });

export const adminSpecialVersionBody = createServerFn({ method: "GET" })
  .validator((input: { id: string; version: number }) => ({ id: String(input?.id ?? "").slice(0, 80), version: Math.max(1, Math.floor(Number(input?.version) || 0)) }))
  .handler(async ({ data }) => {
    await guard();
    const { readSpecialVersion } = await import("./special.server");
    return readSpecialVersion(data.id, data.version);
  });

export const adminPublishSpecial = createServerFn({ method: "POST" })
  .validator((input: { id: string; publish: boolean }) => ({ id: String(input?.id ?? "").slice(0, 80), publish: input?.publish !== false }))
  .handler(async ({ data }) => {
    await writeGuard();
    const { publishSpecialArticle, unpublishSpecialArticle } = await import("./special.server");
    const { logAdminAction } = await import("./repository.server");
    if (data.publish) await publishSpecialArticle(data.id);
    else await unpublishSpecialArticle(data.id);
    await logAdminAction("special.status", `${data.publish ? "Published" : "Unpublished"} special article ${data.id}`);
    return { ok: true as const };
  });

/** Special research notebook for an article (sources / claims / reports) — never public. */
export const adminSpecialResearch = createServerFn({ method: "GET" })
  .validator((input: { id: string }) => ({ id: String(input?.id ?? "").slice(0, 80) }))
  .handler(async ({ data }) => {
    await guard();
    const { readResearch } = await import("@/lib/special/research.server");
    return readResearch(`article:${data.id}`);
  });

/** t173: Automation → Special settings (admin only). */
export const adminSpecialSettings = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { readSpecialSettings } = await import("./special-settings.server");
  const { listProfiles } = await import("./automation.server");
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const categories = await sql<{ id: string; slug: string; label: string }>`select id, slug, label from categories order by label`;
  const profiles = (await listProfiles().catch(() => [])).map((p: { id: string; name?: string; label?: string }) => ({ id: p.id, name: String(p.name ?? p.label ?? p.id) }));
  const env = (await (await import("@/lib/cf-env.server")).workerEnv()) as Record<string, unknown>;
  const keys = { xai: Boolean(env.XAI_API_KEY), openai: Boolean(env.OPENAI_API_KEY), brave: Boolean(env.BRAVE_SEARCH_API_KEY) };
  const publishUsage = await (await import("./automation.server")).combinedPublishUsage();
  return { settings: await readSpecialSettings(), categories, profiles, keys, publishUsage };
});

export const adminSaveSpecialSettings = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { readSpecialSettings, saveSpecialSettings } = await import("./special-settings.server");
    const { logAdminAction } = await import("./repository.server");
    try {
      // t178: profile assignments change only through the "section" profile action (one
      // source of truth, with its own confirmation); a settings save keeps the stored list.
      const stored = await readSpecialSettings();
      const payload = data && typeof data === "object" ? { ...(data as Record<string, unknown>), profileIds: stored.profileIds, profileAssignment: "exclusive" } : data;
      const saved = await saveSpecialSettings(payload);
      await logAdminAction("special.settings", `Special automation ${saved.enabled ? "on" : "off"}: ${saved.eligibleCategoryIds.length} categories, ${saved.publishBehaviour}`).catch(() => undefined);
      return { ok: true as const, settings: saved };
    } catch (error) {
      const { ZodError } = await import("zod");
      if (error instanceof ZodError) return { ok: false as const, error: error.issues.slice(0, 6).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
      throw error;
    }
  });

/** t173: cloud connectors (admin only). Tokens never leave the server; statuses are honest. */
export const adminCloudStatus = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { cloudStatuses } = await import("./cloud.server");
  return cloudStatuses();
});

export const adminCloudConnect = createServerFn({ method: "POST" })
  .validator((input: { provider: string; share?: boolean; upload?: boolean }) => ({ provider: String(input?.provider ?? ""), share: Boolean(input?.share), upload: Boolean(input?.upload) }))
  .handler(async ({ data }) => {
    await writeGuard();
    const cloud = await import("./cloud.server");
    if (!cloud.isOAuthCloud(data.provider)) return { ok: false as const, error: "Unknown provider." };
    const { getRequest } = await import("@tanstack/react-start/server");
    const origin = new URL(getRequest().url).origin;
    try {
      const caps = [...(data.share ? (["share"] as const) : []), ...(data.upload ? (["upload"] as const) : [])];
      return { ok: true as const, url: await cloud.startCloudConnect(data.provider, origin, caps) };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Could not start the connection." };
    }
  });

export const adminCloudAction = createServerFn({ method: "POST" })
  .validator((input: { provider: string; action: "disconnect" | "test" | "folders" | "browse" | "proton-add" | "proton-remove"; folderId?: string | null; folders?: Array<{ id: string; name: string; path?: string | null }>; title?: string; url?: string; id?: string }) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const cloud = await import("./cloud.server");
    const p = String(data.provider ?? "");
    try {
      if (data.action === "proton-add") return { ok: true as const, links: await cloud.addProtonLink(String(data.title ?? ""), String(data.url ?? "")) };
      if (data.action === "proton-remove") return { ok: true as const, links: await cloud.removeProtonLink(String(data.id ?? "")) };
      if (p !== "proton-drive" && !cloud.isOAuthCloud(p)) return { ok: false as const, error: "Unknown provider." };
      if (data.action === "disconnect") {
        await cloud.disconnectCloud(p as "proton-drive");
        const { logAdminAction } = await import("./repository.server");
        await logAdminAction("cloud.disconnect", `Disconnected ${p}`).catch(() => undefined);
        return { ok: true as const };
      }
      if (data.action === "test") return { ok: true as const, test: await cloud.testCloud(p as "proton-drive") };
      if (!cloud.isOAuthCloud(p)) return { ok: false as const, error: "Folders are not available for this provider." };
      if (data.action === "folders") {
        await cloud.setCloudFolders(p, Array.isArray(data.folders) ? data.folders : []);
        return { ok: true as const };
      }
      const { api } = await cloud.cloudClient(p);
      const items = (await api.list(data.folderId ?? null)).filter((f) => f.kind === "folder").slice(0, 100).map((f) => ({ id: f.id, name: f.name, path: f.path }));
      return { ok: true as const, items };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "The cloud action failed." };
    }
  });

export const adminDeleteDraft = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { deleteDraft, logAdminAction } = await import("./repository.server");
    await deleteDraft(data.id);
    await logAdminAction("article.delete", `Deleted draft ${data.id}`);
    return { ok: true };
  });

export const adminDeleteArticle = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { id?: unknown; deleteCover?: unknown };
    if (typeof v.id !== "string" || v.id.length === 0 || v.id.length > 80) throw new Error("A valid article id is required.");
    return { id: v.id, deleteCover: v.deleteCover === true };
  })
  .handler(async ({ data }) => {
    await writeGuard();
    const { deleteArticle } = await import("./repository.server");
    return deleteArticle(data.id, { deleteCover: data.deleteCover });
  });

export const adminSetAiEditAllowed = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { id?: unknown; allowed?: unknown };
    if (typeof v.id !== "string" || v.id.length === 0 || v.id.length > 80) throw new Error("A valid article id is required.");
    return { id: v.id, allowed: v.allowed === true };
  })
  .handler(async ({ data }) => {
    await writeGuard();
    const { setAiEditAllowed } = await import("./repository.server");
    await setAiEditAllowed(data.id, data.allowed);
    return { ok: true, aiEditAllowed: data.allowed };
  });

export const adminOldArticlesPreview = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await guard();
    const { parseOldArticleQuery } = await import("@/lib/old-articles");
    const { previewOldArticles } = await import("./repository.server");
    return previewOldArticles(parseOldArticleQuery(data));
  });

export const adminDeleteOldArticles = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { parseOldArticleQuery } = await import("@/lib/old-articles");
    const { deleteOldArticles } = await import("./repository.server");
    return deleteOldArticles(parseOldArticleQuery(data));
  });

export const adminPreview = createServerFn({ method: "GET" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await guard();
    const { readPreview, readShell } = await import("./repository.server");
    const preview = await readPreview(data.id);
    const shell = await readShell();
    return preview ? { ...preview, site: shell.site } : null;
  });

/** t173: admin preview of a special article (any status). */
export const adminSpecialPreview = createServerFn({ method: "GET" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await guard();
    const { readSpecialPreview } = await import("./special.server");
    const { readShell } = await import("./repository.server");
    const preview = await readSpecialPreview(data.id);
    const shell = await readShell();
    return preview ? { ...preview, site: shell.site } : null;
  });

export const adminTaxonomy = createServerFn({ method: "GET" })
  .handler(async () => {
    await guard();
    const { adminList } = await import("./repository.server");
    const list = await adminList({});
    return { categories: list.categories, tags: list.tags, articles: list.articles };
  });

export const adminSaveCategory = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { saveCategory } = await import("./repository.server");
    return saveCategory(data);
  });

export const adminDeleteCategory = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { deleteCategory } = await import("./repository.server");
    await deleteCategory(data.id);
    return { ok: true };
  });

export const adminSaveTag = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { saveTag } = await import("./repository.server");
    return saveTag(data);
  });

export const adminDeleteTag = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { deleteTag } = await import("./repository.server");
    await deleteTag(data.id);
    return { ok: true };
  });

export const adminSettings = createServerFn({ method: "GET" })
  .handler(async () => {
    const session = await guard();
    const { readSettings, listMedia } = await import("./repository.server");
    const { listGrants } = await import("@/lib/auth/admin.server");
    const { MediaBindingError } = await import("./media-store.server");
    const settings = await readSettings();
    const { readHeadNames } = await import("./head-code.server");
    const headNames = await readHeadNames();
    let media: Awaited<ReturnType<typeof listMedia>> = [];
    let mediaNotice: string | null = null;
    try {
      media = await listMedia();
    } catch (error) {
      if (!(error instanceof MediaBindingError)) throw error;
      mediaNotice = error.message;
    }
    return {
      ...settings,
      headNames,
      media,
      mediaNotice,
      mode: session.mode,
      email: session.email,
      grants: await listGrants(),
    };
  });

export const adminSaveSettings = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { saveSettings } = await import("./repository.server");
    await saveSettings(data);
    return { ok: true };
  });

/** t183: save Settings → Custom head code entries (add / edit / delete / reorder) at once. */
export const adminSaveHeadCode = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { code?: unknown; expected?: unknown; names?: unknown };
    if (typeof v.code !== "string" || typeof v.expected !== "string") throw new Error("Invalid head code request.");
    if (v.code.length > 20000) throw new Error("Custom head code is limited to 20,000 characters.");
    return { code: v.code, expected: v.expected, names: v.names };
  })
  .handler(async ({ data }) => {
    await writeGuard();
    const { saveHeadCode } = await import("./head-code.server");
    return saveHeadCode(data);
  });

/** t189: rename Settings → Custom head code entries without touching the head code itself. */
export const adminSaveHeadNames = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { expected?: unknown; names?: unknown };
    if (typeof v.expected !== "string") throw new Error("Invalid head code request.");
    return { expected: v.expected, names: v.names };
  })
  .handler(async ({ data }) => {
    await writeGuard();
    const { saveHeadNames } = await import("./head-code.server");
    return saveHeadNames(data);
  });

export const adminMedia = createServerFn({ method: "GET" })
  .handler(async () => {
    await guard();
    const { listMedia } = await import("./repository.server");
    const { MediaBindingError } = await import("./media-store.server");
    try {
      return { media: await listMedia(), notice: null as string | null };
    } catch (error) {
      if (error instanceof MediaBindingError) return { media: [], notice: error.message };
      throw error;
    }
  });

export const adminUploadMedia = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { uploadMedia } = await import("./repository.server");
    return uploadMedia(data);
  });

/** t60 legacy backfill: dry-run report (apply:false) or one bounded batch. */
export const adminBackfillMedia = createServerFn({ method: "POST" })
  .validator((input: { apply: boolean; limit?: number }) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { backfillMediaVariants } = await import("./repository.server");
    return backfillMediaVariants({ apply: data.apply === true, limit: data.limit });
  });

export const adminDuplicateArticle = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { duplicateArticle, logAdminAction } = await import("./repository.server");
    const out = await duplicateArticle(data.id);
    await logAdminAction("article.duplicate", `Duplicated article as ${out.slug} (draft)`);
    return out;
  });

export const adminHealth = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { siteHealth } = await import("./repository.server");
  return siteHealth();
});

export const adminImportSettings = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const payload = (data ?? {}) as { site?: unknown; automation?: unknown };
    if (!payload.site && !payload.automation) throw new Error("That backup has no site or automation settings.");
    const result: { site: boolean; automation: boolean } = { site: false, automation: false };
    if (payload.site) {
      const { saveSettings } = await import("./repository.server");
      await saveSettings(payload.site);
      result.site = true;
    }
    if (payload.automation) {
      const { saveAutomationSettings } = await import("./automation.server");
      await saveAutomationSettings(payload.automation);
      result.automation = true;
    }
    return result;
  });

export const adminDeleteMedia = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { deleteMedia, logAdminAction } = await import("./repository.server");
    await deleteMedia(data.id);
    await logAdminAction("media.delete", `Deleted media ${data.id}`);
    return { ok: true };
  });

export const adminAddGrant = createServerFn({ method: "POST" })
  .validator((input: { email: string }) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { addGrant } = await import("@/lib/auth/admin.server");
    await addGrant(data.email);
    return { ok: true };
  });

export const adminRemoveGrant = createServerFn({ method: "POST" })
  .validator((input: { email: string }) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { removeGrant } = await import("@/lib/auth/admin.server");
    await removeGrant(data.email);
    return { ok: true };
  });

export const adminSignIn = createServerFn({ method: "POST" })
  .validator((input: { token: string }) => ({ token: String(input?.token ?? "").slice(0, 512) }))
  .handler(async ({ data }) => {
    const { assertSameOrigin } = await import("@/lib/write-guard.server");
    assertSameOrigin();
    const { signInDesk, signInAllowed, deskConfigured } = await import("@/lib/auth/admin.server");
    // Rate limit first, on every attempt, so the limiter can't reveal token validity.
    const gate = await signInAllowed();
    if (!gate.allowed) {
      // A thrown Response is sent as-is, so the 429 keeps its Retry-After header.
      throw new Response(JSON.stringify({ ok: false, reason: "limited", retryAfter: gate.retryAfter }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(gate.retryAfter),
          "Cache-Control": "no-store",
          // Hand the Response to the client unchanged (TanStack raw response).
          "x-tss-raw": "true",
        },
      });
    }
    if (!(await deskConfigured())) return { ok: false, reason: "locked" as const, retryAfter: 0 };
    const ok = await signInDesk(data.token);
    return ok ? { ok: true, reason: null, retryAfter: 0 } : { ok: false, reason: "wrong" as const, retryAfter: 0 };
  });

export const adminSignOut = createServerFn({ method: "POST" }).handler(async () => {
  const { signOutDesk } = await import("@/lib/auth/admin.server");
  await signOutDesk();
  return { ok: true };
});

/* ---------- t80: username + password + TOTP admin login ---------- */

async function signInGateOrThrow(): Promise<void> {
  const { signInAllowed } = await import("@/lib/auth/admin.server");
  const gate = await signInAllowed();
  if (!gate.allowed) {
    throw new Response(JSON.stringify({ ok: false, reason: "limited", retryAfter: gate.retryAfter }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(gate.retryAfter), "Cache-Control": "no-store", "x-tss-raw": "true" },
    });
  }
}

export const adminLoginStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { deskConfigured, passwordSetupStateSafe } = await import("@/lib/auth/admin.server");
  const { resolveLoginMode } = await import("@/lib/auth/login-mode");
  const configured = await deskConfigured();
  // t83: the root login is decided here, from the real credential state in
  // D1 - "active" (totp_enabled=1) means username+password+TOTP, anything
  // else keeps the lockout-safe token bootstrap, with "pending" surfaced
  // so a half-finished setup no longer looks like a missing feature.
  const setup = configured ? await passwordSetupStateSafe() : ("none" as const);
  const { mode, setupPending } = resolveLoginMode({ configured, setup });
  return { configured, mode, setup, setupPending };
});

export const adminLoginStart = createServerFn({ method: "POST" })
  .validator((input: { username: string; password: string }) => ({
    username: String(input?.username ?? "").slice(0, 64),
    password: String(input?.password ?? "").slice(0, 256),
  }))
  .handler(async ({ data }) => {
    const { assertSameOrigin } = await import("@/lib/write-guard.server");
    assertSameOrigin();
    await signInGateOrThrow();
    const { deskConfigured, deskKeyMaterial, setPendingChallenge } = await import("@/lib/auth/admin.server");
    if (!(await deskConfigured())) return { ok: false, stage: "locked" as const };
    const keyMaterial = await deskKeyMaterial();
    if (!keyMaterial) return { ok: false, stage: "locked" as const };
    const { getSql } = await import("@/lib/db");
    const users = await import("@/lib/auth/admin-users.server");
    const { normalizeUsername } = await import("@/lib/auth/admin-credentials");
    const sql = await getSql();
    await users.ensureAdminTables(sql);
    const enabled = await users.getEnabledUser(sql);
    if (!enabled) return { ok: false, stage: "token" as const };
    const user = await users.getUserByUsername(sql, normalizeUsername(data.username));
    const ok = await users.verifyPasswordForUser(user && user.totp_enabled === 1 ? user : null, data.password);
    if (!ok || !user) return { ok: false, stage: "credentials" as const };
    await setPendingChallenge(user.id);
    return { ok: true, stage: "totp" as const };
  });

export const adminLoginVerify = createServerFn({ method: "POST" })
  .validator((input: { code: string }) => ({ code: String(input?.code ?? "").slice(0, 64) }))
  .handler(async ({ data }) => {
    const { assertSameOrigin } = await import("@/lib/write-guard.server");
    assertSameOrigin();
    await signInGateOrThrow();
    const auth = await import("@/lib/auth/admin.server");
    const userId = await auth.readPendingChallenge();
    if (userId === null) return { ok: false, stage: "expired" as const };
    const keyMaterial = await auth.deskKeyMaterial();
    if (!keyMaterial) return { ok: false, stage: "expired" as const };
    const { getSql } = await import("@/lib/db");
    const users = await import("@/lib/auth/admin-users.server");
    const sql = await getSql();
    await users.ensureAdminTables(sql);
    const user = await users.getUserById(sql, userId);
    if (!user || user.totp_enabled !== 1) return { ok: false, stage: "expired" as const };
    const factor = await users.checkSecondFactor(sql, keyMaterial, user, data.code);
    if (!factor) return { ok: false, stage: "code" as const };
    auth.clearPendingChallenge();
    const issued = await auth.issueDeskSession();
    return issued ? { ok: true, stage: "done" as const, via: factor } : { ok: false, stage: "expired" as const };
  });

/* ---------- t80: admin Security page (setup / password / 2FA management) ---------- */

async function securityContext() {
  const auth = await import("@/lib/auth/admin.server");
  const keyMaterial = await auth.deskKeyMaterial();
  if (!keyMaterial) throw new Error("Admin secrets are not configured on this deployment.");
  const { getSql } = await import("@/lib/db");
  const users = await import("@/lib/auth/admin-users.server");
  const sql = await getSql();
  await users.ensureAdminTables(sql);
  return { auth, keyMaterial, sql, users };
}

export const adminSecurityStatus = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { sql, users } = await securityContext();
  const user = await users.getAnyUser(sql);
  return {
    active: Boolean(user && user.totp_enabled === 1),
    pending: Boolean(user && user.totp_enabled !== 1 && user.totp_pending_enc),
    username: user?.username ?? null,
    recoveryRemaining: user ? await users.countUnusedRecoveryCodes(sql, user.id) : 0,
  };
});

export const adminSecuritySetupStart = createServerFn({ method: "POST" })
  .validator((input: { username: string; password: string }) => ({
    username: String(input?.username ?? "").slice(0, 64),
    password: String(input?.password ?? "").slice(0, 256),
  }))
  .handler(async ({ data }) => {
    await writeGuard();
    const { sql, users, keyMaterial } = await securityContext();
    if (await users.passwordLoginActive(sql)) throw new Error("Password login is already set up. Use the change options below.");
    const creds = await import("@/lib/auth/admin-credentials");
    const { qrSvg } = await import("@/lib/auth/qr");
    // Restart path (t82): credentials already saved, enrolment not finished —
    // just issue a FRESH pending secret/QR (any earlier QR or typed secret
    // stops working), keeping the username/password from the first attempt.
    const existing = await users.getAnyUser(sql);
    if (existing) {
      const { secret } = await users.startTotpEnrolment(sql, keyMaterial, {});
      const uri = creds.otpauthUri(secret, existing.username);
      return { username: existing.username, secret, otpauthUri: uri, qrSvg: qrSvg(uri), restarted: true };
    }
    const username = creds.normalizeUsername(data.username);
    if (!creds.validUsername(username)) throw new Error("Username needs 3–32 characters: lowercase letters, numbers, dot, dash or underscore.");
    if (!creds.validPassword(data.password)) throw new Error(`Password needs at least ${creds.PASSWORD_MIN_LENGTH} characters.`);
    const { user, secret } = await users.startTotpEnrolment(sql, keyMaterial, { username, password: data.password });
    const uri = creds.otpauthUri(secret, user.username);
    return { username: user.username, secret, otpauthUri: uri, qrSvg: qrSvg(uri), restarted: false };
  });

export const adminSecuritySetupConfirm = createServerFn({ method: "POST" })
  .validator((input: { code: string }) => ({ code: String(input?.code ?? "").slice(0, 64) }))
  .handler(async ({ data }) => {
    await writeGuard();
    const { sql, users, keyMaterial } = await securityContext();
    const user = await users.getAnyUser(sql);
    if (!user) return { ok: false as const, reason: "no-pending" as const, message: "Setup was not started. Create your credentials first." };
    const outcome = await users.confirmTotp(sql, keyMaterial, user, data.code);
    if (outcome.status !== "ok") {
      const { confirmMismatchMessage } = await import("@/lib/auth/admin-credentials");
      // Reason + step diagnosis are logged server-side (never the code or
      // any secret) so a recurring failure is provable from Worker logs:
      // matchedStep non-null = right entry, phone clock off; null = the
      // code came from a different authenticator entry (t84).
      const pendingAgeSec = Math.max(0, Math.floor(Date.now() / 1000) - user.updated_at);
      console.error(`[security] setup confirm failed: ${outcome.status} matchedStep=${outcome.matchedStep} pendingAgeSec=${pendingAgeSec}`);
      return {
        ok: false as const,
        reason: outcome.status,
        message:
          outcome.status === "code-mismatch"
            ? confirmMismatchMessage(outcome.matchedStep)
            : "This enrolment can no longer be confirmed. Use “Show a fresh QR code” below and scan the new one.",
      };
    }
    const recoveryCodes = await users.replaceRecoveryCodes(sql, user.id);
    return { ok: true as const, recoveryCodes };
  });

export const adminSecurityChangePassword = createServerFn({ method: "POST" })
  .validator((input: { currentPassword: string; currentCode: string; newPassword: string }) => ({
    currentPassword: String(input?.currentPassword ?? "").slice(0, 256),
    currentCode: String(input?.currentCode ?? "").slice(0, 64),
    newPassword: String(input?.newPassword ?? "").slice(0, 256),
  }))
  .handler(async ({ data }) => {
    await writeGuard();
    const { sql, users, keyMaterial } = await securityContext();
    const user = await users.getEnabledUser(sql);
    if (!user) throw new Error("Password login is not set up yet.");
    if (!(await users.verifyPasswordForUser(user, data.currentPassword))) throw new Error("Current password or code is not right.");
    if (!(await users.checkSecondFactor(sql, keyMaterial, user, data.currentCode))) throw new Error("Current password or code is not right.");
    const creds = await import("@/lib/auth/admin-credentials");
    if (!creds.validPassword(data.newPassword)) throw new Error(`New password needs at least ${creds.PASSWORD_MIN_LENGTH} characters.`);
    await users.updatePassword(sql, user.id, data.newPassword);
    return { ok: true };
  });

export const adminSecurityResetTotpStart = createServerFn({ method: "POST" })
  .validator((input: { currentPassword: string; currentCode: string }) => ({
    currentPassword: String(input?.currentPassword ?? "").slice(0, 256),
    currentCode: String(input?.currentCode ?? "").slice(0, 64),
  }))
  .handler(async ({ data }) => {
    await writeGuard();
    const { sql, users, keyMaterial } = await securityContext();
    const user = await users.getEnabledUser(sql);
    if (!user) throw new Error("Password login is not set up yet.");
    if (!(await users.verifyPasswordForUser(user, data.currentPassword))) throw new Error("Current password or code is not right.");
    if (!(await users.checkSecondFactor(sql, keyMaterial, user, data.currentCode))) throw new Error("Current password or code is not right.");
    const { secret } = await users.startTotpEnrolment(sql, keyMaterial, {});
    const creds = await import("@/lib/auth/admin-credentials");
    const { qrSvg } = await import("@/lib/auth/qr");
    const uri = creds.otpauthUri(secret, user.username);
    return { secret, otpauthUri: uri, qrSvg: qrSvg(uri) };
  });

export const adminSecurityResetTotpConfirm = createServerFn({ method: "POST" })
  .validator((input: { code: string }) => ({ code: String(input?.code ?? "").slice(0, 64) }))
  .handler(async ({ data }) => {
    await writeGuard();
    const { sql, users, keyMaterial } = await securityContext();
    const user = await users.getEnabledUser(sql);
    if (!user) throw new Error("Password login is not set up yet.");
    const outcome = await users.confirmTotp(sql, keyMaterial, user, data.code);
    if (outcome.status !== "ok") {
      const { confirmMismatchMessage } = await import("@/lib/auth/admin-credentials");
      console.error(`[security] totp reset confirm failed: ${outcome.status} matchedStep=${outcome.matchedStep}`);
      throw new Error(
        outcome.status === "code-mismatch"
          ? confirmMismatchMessage(outcome.matchedStep)
          : "That code did not match the new QR code. Your previous authenticator entry still works until a new one is confirmed — check the code and try again, or generate another fresh QR.",
      );
    }
    const recoveryCodes = await users.replaceRecoveryCodes(sql, user.id);
    return { ok: true, recoveryCodes };
  });

export const adminSecurityRegenRecovery = createServerFn({ method: "POST" })
  .validator((input: { currentPassword: string; currentCode: string }) => ({
    currentPassword: String(input?.currentPassword ?? "").slice(0, 256),
    currentCode: String(input?.currentCode ?? "").slice(0, 64),
  }))
  .handler(async ({ data }) => {
    await writeGuard();
    const { sql, users, keyMaterial } = await securityContext();
    const user = await users.getEnabledUser(sql);
    if (!user) throw new Error("Password login is not set up yet.");
    if (!(await users.verifyPasswordForUser(user, data.currentPassword))) throw new Error("Current password or code is not right.");
    if (!(await users.checkSecondFactor(sql, keyMaterial, user, data.currentCode))) throw new Error("Current password or code is not right.");
    const recoveryCodes = await users.replaceRecoveryCodes(sql, user.id);
    return { ok: true, recoveryCodes };
  });


function profileIdOf(input: unknown): string {
  const id = (input as { profileId?: unknown } | null)?.profileId;
  if (id === undefined || id === null || id === "") return "default";
  if (typeof id !== "string" || !/^(default|p[0-9a-f]{8})$/.test(id)) throw new Error("Unknown automation profile.");
  return id;
}

export const adminAutomation = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({ profileId: profileIdOf(input) }))
  .handler(async ({ data }) => {
    await guard();
    const { readProfileSettings, recentRuns, listProfiles, readTopicCursor } = await import("./automation.server");
    const { computeTopicSelection } = await import("@/lib/automation/topic-selection");
    const { adminList } = await import("./repository.server");
    const { providerStatus } = await import("@/lib/automation/provider");
    const { mcpConfigured } = await import("@/lib/mcp/auth");
    const { workerEnv } = await import("@/lib/cf-env.server");
    const env = await workerEnv();
    const profiles = await listProfiles();
    const profileId = profiles.some((p) => p.id === data.profileId) ? data.profileId : "default";
    const settings = await readProfileSettings(profileId);
    const list = await adminList({});
    return {
      profileId,
      profiles,
      settings,
      selection: computeTopicSelection(settings.topicSelection, settings.topicIdeas, await readTopicCursor(profileId)),
      topicCursor: await readTopicCursor(profileId),
      runs: await recentRuns(25),
      categories: list.categories.map((c) => ({ id: c.id, label: c.label })),
      provider: providerStatus(settings, env),
      // Only whether it is set; the value never leaves the server.
      mcpTokenConfigured: mcpConfigured(env.MCP_TOKEN),
      // t177: the website daily cap is one global cap over Normal + Special.
      publishUsage: await (await import("./automation.server")).combinedPublishUsage(),
      // t178: exclusive Normal/Special assignment (for the tabs, pills and profile table).
      special: await (await import("./special-settings.server")).readSpecialSettings().then((sp) => ({ enabled: sp.enabled, profileIds: sp.profileIds })),
    };
  });

export const adminSaveAutomation = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { profileId?: unknown; settings?: unknown };
    // Older callers posted the settings object directly (default profile).
    return "settings" in v ? { profileId: profileIdOf(v), settings: v.settings } : { profileId: "default", settings: input };
  })
  .handler(async ({ data }) => {
    await writeGuard();
    const { saveProfileSettings } = await import("./automation.server");
    await saveProfileSettings(data.profileId, data.settings);
    return { ok: true };
  });

type ProfileAction =
  | { action: "create"; name: string; connect?: "api-key" | "oauth"; redirectUris?: string[]; authorName?: string; section: "normal" | "special" }
  | { action: "section"; profileId: string; section: "normal" | "special" }
  | { action: "rename"; profileId: string; name: string }
  | { action: "author"; profileId: string; authorName: string }
  | { action: "authors"; profileId: string; names: string[]; reset: boolean }
  | { action: "delete" | "token" | "revoke" | "oauth-revoke"; profileId: string }
  | { action: "oauth-create" | "oauth-redirects"; profileId: string; redirectUris: string[] };

/** Create / rename / delete profiles and issue / revoke API keys or OAuth clients. A new secret is returned once. */
export const adminProfileAction = createServerFn({ method: "POST" })
  .validator((input: unknown): ProfileAction => {
    const v = (input ?? {}) as Record<string, unknown>;
    const name = typeof v.name === "string" ? v.name.slice(0, 200) : "";
    const connect = v.connect === "oauth" || v.connect === "api-key" ? v.connect : undefined;
    // t178/t179: Normal (default, the legacy behaviour) or Special. Anything else is rejected.
    const section = v.section === undefined || v.section === "normal" ? "normal" : v.section === "special" ? "special" : null;
    if (v.action === "create") {
      if (!section) throw new Error("Section must be 'normal' or 'special'.");
      const authorName = typeof v.authorName === "string" ? v.authorName.slice(0, 200) : "";
      if (connect === "oauth") return { action: "create", name, connect, redirectUris: parseAdminRedirects(v.redirectUris), authorName, section };
      return { action: "create", name, connect, authorName, section };
    }
    if (v.action === "section") {
      if (!section || v.section === undefined) throw new Error("Section must be 'normal' or 'special'.");
      return { action: "section", profileId: profileIdOf(v), section };
    }
    if (v.action === "rename") return { action: "rename", profileId: profileIdOf(v), name };
    if (v.action === "authors") {
      const names = Array.isArray(v.names) ? v.names.slice(0, 100).map((n) => (typeof n === "string" ? n.slice(0, 200) : "")) : [];
      return { action: "authors", profileId: profileIdOf(v), names, reset: v.reset === true };
    }
    if (v.action === "author") return { action: "author", profileId: profileIdOf(v), authorName: typeof v.authorName === "string" ? v.authorName.slice(0, 200) : "" };
    if (v.action === "delete" || v.action === "token" || v.action === "revoke" || v.action === "oauth-revoke") return { action: v.action, profileId: profileIdOf(v) };
    if (v.action === "oauth-create" || v.action === "oauth-redirects") {
      return { action: v.action, profileId: profileIdOf(v), redirectUris: parseAdminRedirects(v.redirectUris) };
    }
    throw new Error("Unknown action.");
  })
  .handler(async ({ data }) => {
    await writeGuard();
    const store = await import("./automation.server");
    try {
      if (data.action === "create") {
        if (data.authorName?.trim()) {
          const { checkAuthorName } = await import("@/lib/author-name");
          const checked = checkAuthorName(data.authorName);
          if (!checked.ok) throw new store.ProfileError(checked.error);
        }
        const created = await store.createProfile(data.name);
        let profile = created;
        try {
          if (data.authorName?.trim()) profile = { ...created, authorName: await store.setProfileAuthor(created.id, data.authorName) };
          if (data.section === "special") await (await import("./special-settings.server")).setProfileAssignment(created.id, "special");
          if (data.connect === "api-key") {
            const issued = await store.issueProfileToken(profile.id);
            return { ok: true as const, profile: { ...profile, hasToken: true, tokenHint: issued.hint }, token: issued.token, hint: issued.hint };
          }
          if (data.connect === "oauth") {
            const issued = await store.issueOauthClient(profile.id, data.redirectUris, data.name);
            return {
              ok: true as const,
              profile: { ...profile, oauth: { clientId: issued.clientId, secretHint: issued.secretHint, redirectUris: issued.redirectUris, createdAt: new Date().toISOString() } },
              oauth: { clientId: issued.clientId, clientSecret: issued.clientSecret, secretHint: issued.secretHint, redirectUris: issued.redirectUris },
            };
          }
        } catch (error) {
          await store.deleteProfile(profile.id).catch(() => undefined);
          throw error;
        }
        return { ok: true as const, profile };
      }
      if (data.action === "section") {
        const profiles = await store.listProfiles();
        const target = profiles.find((p) => p.id === data.profileId);
        if (!target) throw new Error("Unknown profile.");
        const saved = await (await import("./special-settings.server")).setProfileAssignment(data.profileId, data.section);
        const { logAdminAction } = await import("./repository.server");
        await logAdminAction("special.assignment", `Profile ${target.name} assigned to ${data.section === "special" ? "Special" : "Normal"} articles`).catch(() => undefined);
        return { ok: true as const, section: data.section, specialProfileIds: saved.profileIds };
      }
      if (data.action === "rename") await store.renameProfile(data.profileId, data.name);
      if (data.action === "authors") return { ok: true as const, rotation: await store.saveAuthorList(data.profileId, data.names, { reset: data.reset }) };
      if (data.action === "author") return { ok: true as const, authorName: await store.setProfileAuthor(data.profileId, data.authorName) };
      if (data.action === "delete") {
        await store.deleteProfile(data.profileId);
        await (await import("./special-settings.server")).setProfileAssignment(data.profileId, "normal").catch(() => undefined);
      }
      if (data.action === "revoke") await store.revokeProfileToken(data.profileId);
      if (data.action === "token") return { ok: true as const, ...(await store.issueProfileToken(data.profileId)) };
      if (data.action === "oauth-revoke") await store.revokeOauthClient(data.profileId);
      if (data.action === "oauth-redirects") return { ok: true as const, redirectUris: await store.updateOauthRedirects(data.profileId, data.redirectUris) };
      if (data.action === "oauth-create") {
        const profiles = await store.listProfiles();
        const name = profiles.find((p) => p.id === data.profileId)?.name ?? "MCP client";
        const issued = await store.issueOauthClient(data.profileId, data.redirectUris, name);
        return { ok: true as const, oauth: { clientId: issued.clientId, clientSecret: issued.clientSecret, secretHint: issued.secretHint, redirectUris: issued.redirectUris } };
      }
      return { ok: true as const };
    } catch (error) {
      if (error instanceof store.ProfileError) throw new Error(error.message);
      throw error;
    }
  });

/** Data for the homepage builder's live preview (uses the unsaved draft settings). */
export const adminHomePreview = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await guard();
    const { readHome, readSettings } = await import("./repository.server");
    const { normalizeSite } = await import("./validate");
    const { site } = await readSettings();
    const draft = normalizeSite({ ...site, ...((data ?? {}) as object) });
    return { ...(await readHome(draft)), site: draft };
  });

// ---------- pages (t52; admin-only, deliberately no MCP equivalent) -------
export const adminPages = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { adminListPages } = await import("./repository.server");
  return adminListPages();
});

export const adminSavePageFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const admin = await writeGuard();
    const { pageWriteSchema, checkPageSlug } = await import("@/lib/pages");
    const page = pageWriteSchema.parse(data);
    const slugError = checkPageSlug(page.slug);
    if (slugError) throw new Error(slugError);
    const { adminSavePage } = await import("./repository.server");
    return adminSavePage({ ...page, actor: admin.email ?? "admin" });
  });

export const adminDeletePageFn = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { adminDeletePage } = await import("./repository.server");
    return adminDeletePage({ id: data.id, actor: "admin" });
  });

export const adminRevisions = createServerFn({ method: "GET" })
  .validator((input: { articleId: string }) => input)
  .handler(async ({ data }) => {
    await guard();
    const { listRevisions } = await import("./repository.server");
    return listRevisions(data.articleId);
  });

export const adminRestoreRevision = createServerFn({ method: "POST" })
  .validator((input: { revisionId: string }) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { restoreRevision, logAdminAction } = await import("./repository.server");
    const out = await restoreRevision(data.revisionId);
    await logAdminAction("article.restore", `Restored an older version of ${out.slug}`);
    return out;
  });

/** t115: contact form submissions, newest first. */
export const adminMessages = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { listContactMessages } = await import("./contact.server");
  return { messages: await listContactMessages(200) };
});

export const adminActivity = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { activityFeed, listNotFounds } = await import("./repository.server");
  return { entries: await activityFeed(), notFounds: await listNotFounds(15) };
});

/** Stats dashboard payload for one reporting period (all queries in one call). */
export const adminStats = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await guard();
    const {
      analyticsOverview,
      analyticsLeaderboard,
      analyticsTopics,
      analyticsSources,
      analyticsDevices,
      analyticsEngagementDistribution,
      analyticsRecirculation,
      analyticsPublishing,
      analyticsExtras,
    } = await import("./analytics.server");
    type PeriodInput = Parameters<typeof analyticsOverview>[0];
    type LeaderboardSort = Parameters<typeof analyticsLeaderboard>[0]["sort"];
    const inputData = (data ?? {}) as {
      preset?: string;
      from?: string;
      to?: string;
      sort?: string;
      categoryId?: string | null;
      tagId?: string | null;
      q?: string | null;
      page?: number;
      pageSize?: number;
      articleId?: string | null;
    };
    const periodInput: PeriodInput = {
      preset: (inputData.preset ?? "last-28") as DatePreset,
      from: inputData.from ?? "",
      to: inputData.to ?? "",
    };
    const [overview, leaderboard, topics, sources, devices, distribution, recirculation, publishing, extras] =
      await Promise.all([
        analyticsOverview(periodInput),
        analyticsLeaderboard({
          period: periodInput,
          sort: (inputData.sort ?? "views") as LeaderboardSort,
          categoryId: inputData.categoryId,
          tagId: inputData.tagId,
          q: inputData.q,
          page: inputData.page,
          pageSize: inputData.pageSize,
        }),
        analyticsTopics({ period: periodInput }),
        analyticsSources({ period: periodInput }),
        analyticsDevices({ period: periodInput }),
        analyticsEngagementDistribution({ period: periodInput, articleId: inputData.articleId ?? null }),
        analyticsRecirculation({ period: periodInput }),
        analyticsPublishing({ period: periodInput }),
        analyticsExtras({ period: periodInput }),
      ]);
    return { overview, leaderboard, topics, sources, devices, distribution, recirculation, publishing, extras };
  });

/** Per-article stats drill-down. */
export const adminArticleStats = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { id: string; preset?: string; from?: string; to?: string })
  .handler(async ({ data }) => {
    await guard();
    const { analyticsArticle } = await import("./analytics.server");
    return analyticsArticle({
      id: String(data.id ?? ""),
      period: { preset: (data.preset ?? "last-28") as DatePreset, from: data.from ?? "", to: data.to ?? "" },
    });
  });

/** Add or delete a manual chart annotation. */
export const adminStatsAnnotation = createServerFn({ method: "POST" })
  .validator((input: unknown) => input as { action: "add" | "delete"; id?: string; date?: string; note?: string })
  .handler(async ({ data }) => {
    await writeGuard();
    const { addAnnotation, deleteAnnotation } = await import("./analytics.server");
    if (data.action === "delete" && data.id) await deleteAnnotation(String(data.id));
    else if (data.action === "add") await addAnnotation(String(data.date ?? ""), String(data.note ?? ""));
    return { ok: true };
  });
