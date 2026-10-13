import { createServerFn } from "@tanstack/react-start";

/** Worker env as plain strings; secrets are read but never returned. */
function envText(env: unknown): Record<string, string | undefined> {
  return (env ?? {}) as Record<string, string | undefined>;
}

export type RunForClient = {
  id: string;
  automationId: string | null;
  createdAt: string;
  finishedAt: string | null;
  tool: string;
  outcome: string;
  status: string;
  stage: string;
  reason: string;
  articleId: string | null;
  durationMs: number;
  attempt: number;
  /** Details as JSON text: the desk parses it only when it needs a field. */
  details: string;
};

/** Run rows are flattened to serializable primitives for the client. */
function runForClient(run: {
  id: string;
  automationId: string | null;
  createdAt: string;
  finishedAt: string | null;
  tool: string;
  outcome: string;
  status: string;
  stage: string;
  reason: string;
  articleId: string | null;
  durationMs: number;
  attempt: number;
  details: Record<string, unknown>;
}): RunForClient {
  return { ...run, details: JSON.stringify(run.details ?? {}) };
}

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
    const { listGrants, readDeskTheme } = await import("@/lib/auth/admin.server");
    return {
      email: admin.email,
      mode: admin.mode,
      grants: admin.mode === "account" ? await listGrants() : [],
      // Where the desk's own Light/Dark/System choice is kept (a cookie, so the
      // first paint is already correct).
      theme: await readDeskTheme(),
    };
  });

/** Desk appearance: Light, Dark or System. Written by the server, never localStorage. */
export const adminSetDeskTheme = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const value = (input ?? {}) as { theme?: unknown };
    if (value.theme !== "light" && value.theme !== "dark" && value.theme !== "system") throw new Error("Choose Light, Dark or System.");
    return { theme: value.theme as "light" | "dark" | "system" };
  })
  .handler(async ({ data }) => {
    const { requireAdmin, writeDeskTheme } = await import("@/lib/auth/admin.server");
    await requireAdmin();
    return { ok: true, theme: await writeDeskTheme(data.theme) };
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
    const { saveArticle } = await import("./repository.server");
    return saveArticle(data);
  });

export const adminDeleteDraft = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { deleteDraft } = await import("./repository.server");
    await deleteDraft(data.id);
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

export const adminDeleteMedia = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await writeGuard();
    const { deleteMedia } = await import("./repository.server");
    await deleteMedia(data.id);
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
  signOutDesk();
  return { ok: true };
});

// ---------------------------------------------------------------- automation

export const adminAutomation = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { listAutomations, readSchedules, recentRuns, runCounts } = await import("@/lib/automation/store.server");
  const { adminList } = await import("./repository.server");
  const { credentialStatus, credentialSummary } = await import("@/lib/automation/credentials");
  const { mcpConfigured } = await import("@/lib/mcp/auth");
  const { workerEnv } = await import("@/lib/cf-env.server");
  const { getSql } = await import("@/lib/db");
  const { inspectAutomationSchema } = await import("@/lib/automation/schema");
  const { scheduleSummary, mcpRunnable, automationActive } = await import("@/lib/automation/automation");
  const env = envText(await workerEnv());
  const schema = await inspectAutomationSchema(await getSql());
  const environment = env.DYPOL_ENV ?? "unknown";
  if (!schema.ready) return { ready: false as const, schema, environment };
  const [automations, schedules, runs, list, credentials] = await Promise.all([
    listAutomations(),
    readSchedules(),
    recentRuns(30),
    adminList({}),
    credentialStatus(env),
  ]);
  return {
    ready: true as const,
    schema,
    environment,
    automations: await Promise.all(
      automations.map(async (automation) => {
        const schedule = schedules.get(automation.id) ?? null;
        const counts = await runCounts(automation.id);
        const active = automationActive(automation);
        return {
          ...automation,
          schedule,
          counts,
          active,
          scheduleText: scheduleSummary(automation),
          /** Credential line never contains the key itself. */
          credential: credentialSummary(automation.credentialRef, credentials),
          runnable: mcpRunnable(automation) ? false : active.active,
          runnableReason: mcpRunnable(automation)
            ? "This automation is driven by an MCP client (draft pushed to /mcp); the site does not generate for it."
            : active.reason,
        };
      }),
    ),
    runs: runs.map(runForClient),
    categories: list.categories.map((c) => ({ id: c.id, label: c.label })),
    tags: list.tags.map((t) => ({ id: t.id, label: t.label })),
    articles: list.articles.map((a) => ({ id: a.id, slug: a.slug, title: a.title, status: a.status })),
    credentials,
    mcpTokenConfigured: mcpConfigured(env.MCP_TOKEN),
    cronSecretConfigured: Boolean((env.CRON_SECRET ?? "").trim()),
  };
});

export const adminSaveAutomation = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const value = (input ?? {}) as { id?: unknown; data?: unknown };
    const id = typeof value.id === "string" && value.id.length > 0 ? value.id : null;
    if (value.data === undefined) throw new Error("Nothing to save.");
    return { id, data: value.data };
  })
  .handler(async ({ data }) => {
    await writeGuard();
    const { createAutomation, updateAutomation } = await import("@/lib/automation/store.server");
    const record = data.id ? await updateAutomation(data.id, data.data) : await createAutomation(data.data);
    return { ok: true, automation: record };
  });

export const adminDeleteAutomation = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const value = (input ?? {}) as { id?: unknown };
    if (typeof value.id !== "string" || value.id.length === 0) throw new Error("A valid automation id is required.");
    return { id: value.id };
  })
  .handler(async ({ data }) => {
    await writeGuard();
    const { deleteAutomation, listAutomations } = await import("@/lib/automation/store.server");
    await deleteAutomation(data.id);
    return { ok: true, remaining: (await listAutomations()).length };
  });

export const adminDuplicateAutomation = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const value = (input ?? {}) as { id?: unknown; name?: unknown };
    if (typeof value.id !== "string" || value.id.length === 0) throw new Error("A valid automation id is required.");
    const name = typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 80) : undefined;
    return { id: value.id, name };
  })
  .handler(async ({ data }) => {
    await writeGuard();
    const { duplicateAutomation } = await import("@/lib/automation/store.server");
    return { ok: true, automation: await duplicateAutomation(data.id, data.name) };
  });

export const adminRunAutomation = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const value = (input ?? {}) as { id?: unknown; dryRun?: unknown };
    if (typeof value.id !== "string" || value.id.length === 0) throw new Error("A valid automation id is required.");
    return { id: value.id, dryRun: value.dryRun === true };
  })
  .handler(async ({ data }) => {
    await writeGuard();
    const { runAutomationById } = await import("@/lib/automation/scheduler.server");
    const outcome = await runAutomationById(data.id, { trigger: "manual", dryRun: data.dryRun });
    if (!outcome) throw new Error("That automation no longer exists.");
    return { ok: outcome.status !== "failed", outcome };
  });

/** Checks the provider with the automation's OWN credential. Never returns the key. */
export const adminTestAutomation = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const value = (input ?? {}) as { id?: unknown };
    if (typeof value.id !== "string" || value.id.length === 0) throw new Error("A valid automation id is required.");
    return { id: value.id };
  })
  .handler(async ({ data }) => {
    await writeGuard();
    const { listAutomations } = await import("@/lib/automation/store.server");
    const { resolveCredential, credentialSummary, credentialStatus } = await import("@/lib/automation/credentials");
    const { testProviderConnection } = await import("@/lib/automation/provider");
    const { workerEnv } = await import("@/lib/cf-env.server");
    const automation = (await listAutomations()).find((item) => item.id === data.id);
    if (!automation) throw new Error("That automation no longer exists.");
    const env = envText(await workerEnv());
    const status = await credentialStatus(env);
    if (automation.mode === "mcp-connector") {
      return {
        ok: true,
        kind: "mcp" as const,
        message: "MCP connector mode: your own MCP client calls this site, so there is no provider key to test here.",
        credential: credentialSummary(automation.credentialRef, status),
      };
    }
    const credential = resolveCredential(automation.credentialRef, env);
    if (!credential) {
      return {
        ok: false,
        kind: "credential" as const,
        message: credentialSummary(automation.credentialRef, status),
        credential: credentialSummary(automation.credentialRef, status),
      };
    }
    const result = await testProviderConnection(automation, credential.value, { fetchImpl: fetch });
    return { ...result, credential: credentialSummary(automation.credentialRef, status) };
  });

export const adminAutomationRuns = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const value = (input ?? {}) as { automationId?: unknown; limit?: unknown };
    const automationId = typeof value.automationId === "string" && value.automationId ? value.automationId : undefined;
    const limit = typeof value.limit === "number" && Number.isFinite(value.limit) ? Math.max(1, Math.min(200, Math.trunc(value.limit))) : 50;
    return { automationId, limit };
  })
  .handler(async ({ data }) => {
    await guard();
    const { getSql } = await import("@/lib/db");
    const { assertAutomationSchemaReady } = await import("@/lib/automation/schema");
    const { workerEnv } = await import("@/lib/cf-env.server");
    await assertAutomationSchemaReady(await getSql(), (await workerEnv()).DYPOL_ENV);
    const { recentRuns } = await import("@/lib/automation/store.server");
    return { runs: (await recentRuns(data.limit, data.automationId)).map(runForClient) };
  });

// -------------------------------------------------------------------- layout

export const adminLayout = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { readLayoutState } = await import("./layout.server");
  const { adminList } = await import("./repository.server");
  const list = await adminList({});
  return {
    state: await readLayoutState(),
    options: {
      articles: list.articles
        .filter((article) => article.status === "published")
        .map((article) => ({ slug: article.slug, title: article.title, categoryLabel: article.categoryLabel })),
      categories: list.categories.map((category) => ({ id: category.id, slug: category.slug, label: category.label })),
      tags: list.tags.map((tag) => ({ id: tag.id, slug: tag.slug, label: tag.label })),
    },
  };
});

export const adminSaveLayoutDraft = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const value = (input ?? {}) as { doc?: unknown };
    if (value.doc === undefined) throw new Error("Nothing to save.");
    return { doc: value.doc };
  })
  .handler(async ({ data }) => {
    await writeGuard();
    const { saveLayoutDraft } = await import("./layout.server");
    return { ok: true, doc: await saveLayoutDraft(data.doc) };
  });

export const adminPublishLayout = createServerFn({ method: "POST" }).handler(async () => {
  await writeGuard();
  const { publishLayout } = await import("./layout.server");
  return { ok: true, doc: await publishLayout() };
});

export const adminDiscardLayout = createServerFn({ method: "POST" }).handler(async () => {
  await writeGuard();
  const { discardLayoutDraft } = await import("./layout.server");
  await discardLayoutDraft();
  return { ok: true };
});

/** Resolves a draft document for the desk preview, without publishing it. */
export const adminLayoutPreview = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const value = (input ?? {}) as { area?: unknown; doc?: unknown; articleSlug?: unknown };
    if (value.area !== "homepage" && value.area !== "sidebar") throw new Error("Choose which area to preview.");
    if (value.doc === undefined) throw new Error("Nothing to preview.");
    const articleSlug = typeof value.articleSlug === "string" && value.articleSlug ? value.articleSlug : undefined;
    return { area: value.area as "homepage" | "sidebar", doc: value.doc, articleSlug };
  })
  .handler(async ({ data }) => {
    await guard();
    const { parseLayout } = await import("@/lib/layout/blocks");
    const doc = parseLayout(data.doc);
    if (!doc) throw new Error("This draft is not valid yet; fix the highlighted fields and try again.");
    const { resolveBlocks } = await import("./layout.server");
    const { adminList } = await import("./repository.server");
    const list = await adminList({});
    const article = data.articleSlug ? list.articles.find((item) => item.slug === data.articleSlug) : list.articles[0];
    const blocks = await resolveBlocks(doc, data.area, {
      articleId: article?.id,
      articleSlug: article?.slug,
      articleTitle: article?.title,
    });
    return { blocks, sampleArticle: article ? { slug: article.slug, title: article.title } : null };
  });

/** The ticker exactly as it would appear, from real published articles. */
export const adminTickerPreview = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const value = (input ?? {}) as { trending?: unknown };
    if (value.trending === undefined) throw new Error("Nothing to preview.");
    return { trending: value.trending };
  })
  .handler(async ({ data }) => {
    await guard();
    const { parseSite } = await import("./validate");
    const { readSettings, publicSnapshotForPreview } = await import("./repository.server");
    const { resolveTicker } = await import("./ticker");
    const settings = await readSettings();
    const merged = parseSite({ ...settings.site, trending: data.trending });
    const { live, views, categories, featured } = await publicSnapshotForPreview();
    const ticker = resolveTicker(merged, live, { views, categories, featured });
    return { items: ticker.items, source: ticker.source, fallback: ticker.fallback, note: ticker.note };
  });
