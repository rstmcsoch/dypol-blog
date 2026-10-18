import { createServerFn } from "@tanstack/react-start";

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

type ProfileAction = { action: "create"; name: string } | { action: "rename"; profileId: string; name: string } | { action: "delete" | "token" | "revoke"; profileId: string };

/** Create / rename / delete profiles and issue / revoke their tokens. A new token is returned once. */
export const adminProfileAction = createServerFn({ method: "POST" })
  .validator((input: unknown): ProfileAction => {
    const v = (input ?? {}) as Record<string, unknown>;
    const name = typeof v.name === "string" ? v.name.slice(0, 200) : "";
    if (v.action === "create") return { action: "create", name };
    if (v.action === "rename") return { action: "rename", profileId: profileIdOf(v), name };
    if (v.action === "delete" || v.action === "token" || v.action === "revoke") return { action: v.action, profileId: profileIdOf(v) };
    throw new Error("Unknown action.");
  })
  .handler(async ({ data }) => {
    await writeGuard();
    const store = await import("./automation.server");
    try {
      if (data.action === "create") return { ok: true as const, profile: await store.createProfile(data.name) };
      if (data.action === "rename") await store.renameProfile(data.profileId, data.name);
      if (data.action === "delete") await store.deleteProfile(data.profileId);
      if (data.action === "revoke") await store.revokeProfileToken(data.profileId);
      if (data.action === "token") return { ok: true as const, ...(await store.issueProfileToken(data.profileId)) };
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

export const adminActivity = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { activityFeed, listNotFounds } = await import("./repository.server");
  return { entries: await activityFeed(), notFounds: await listNotFounds(15) };
});
