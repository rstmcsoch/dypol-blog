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
