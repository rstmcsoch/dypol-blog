import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

async function guard() {
  const { requireAdmin } = await import("@/lib/auth/admin.server");
  return requireAdmin();
}

export const adminSession = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const admin = await guard();
    const { listGrants } = await import("@/lib/auth/admin.server");
    return { email: admin.email, mode: admin.mode, grants: admin.mode === "account" ? await listGrants() : [] };
  });

export const adminDashboard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    await guard();
    const { adminOverview } = await import("./repository.server");
    return adminOverview();
  });

export const adminArticles = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await guard();
    const { adminList } = await import("./repository.server");
    const { articleListSchema } = await import("./validate");
    return adminList(articleListSchema.parse(data));
  });

export const adminEditorData = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { id: string | null }) => input)
  .handler(async ({ data }) => {
    await guard();
    const { adminEditor } = await import("./repository.server");
    return adminEditor(data.id);
  });

export const adminSaveArticle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await guard();
    const { saveArticle } = await import("./repository.server");
    return saveArticle(data);
  });

export const adminDeleteDraft = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await guard();
    const { deleteDraft } = await import("./repository.server");
    await deleteDraft(data.id);
    return { ok: true };
  });

export const adminPreview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await guard();
    const { readPreview, readShell } = await import("./repository.server");
    const preview = await readPreview(data.id);
    const shell = await readShell();
    return preview ? { ...preview, site: shell.site } : null;
  });

export const adminTaxonomy = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    await guard();
    const { adminList } = await import("./repository.server");
    const list = await adminList({});
    return { categories: list.categories, tags: list.tags, articles: list.articles };
  });

export const adminSaveCategory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await guard();
    const { saveCategory } = await import("./repository.server");
    return saveCategory(data);
  });

export const adminDeleteCategory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await guard();
    const { deleteCategory } = await import("./repository.server");
    await deleteCategory(data.id);
    return { ok: true };
  });

export const adminSaveTag = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await guard();
    const { saveTag } = await import("./repository.server");
    return saveTag(data);
  });

export const adminDeleteTag = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await guard();
    const { deleteTag } = await import("./repository.server");
    await deleteTag(data.id);
    return { ok: true };
  });

export const adminSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
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
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await guard();
    const { saveSettings } = await import("./repository.server");
    await saveSettings(data);
    return { ok: true };
  });

export const adminMedia = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
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
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    await guard();
    const { uploadMedia } = await import("./repository.server");
    return uploadMedia(data);
  });

export const adminDeleteMedia = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await guard();
    const { deleteMedia } = await import("./repository.server");
    await deleteMedia(data.id);
    return { ok: true };
  });

export const adminAddGrant = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { email: string }) => input)
  .handler(async ({ data }) => {
    await guard();
    const { addGrant } = await import("@/lib/auth/admin.server");
    await addGrant(data.email);
    return { ok: true };
  });

export const adminRemoveGrant = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { email: string }) => input)
  .handler(async ({ data }) => {
    await guard();
    const { removeGrant } = await import("@/lib/auth/admin.server");
    await removeGrant(data.email);
    return { ok: true };
  });
