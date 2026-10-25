import { createServerFn } from "@tanstack/react-start";

async function requestOrigin(): Promise<string> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    if (!request) return "";
    const { canonicalOriginFrom } = await import("@/lib/seo");
    return canonicalOriginFrom(request.url);
  } catch {
    return "";
  }
}

export const getShell = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { readShell } = await import("./repository.server");
    return await readShell();
  } catch (error) {
    // The site frame must always render, even if the content layer is broken.
    console.error("[shell] falling back to the built-in site config.", error);
    const { site } = await import("./site");
    return { site, trending: [] as import("./ticker").TickerEntry[], pages: [] as { slug: string; title: string }[], menuTopics: null as { slug: string; label: string; count: number }[] | null, storyCount: 0 };
  }
});

export const getHome = createServerFn({ method: "GET" }).handler(async () => {
  const { readHome } = await import("./repository.server");
  return { ...(await readHome()), origin: await requestOrigin() };
});

export const getIndex = createServerFn({ method: "GET" }).handler(async () => {
  const { readIndex } = await import("./repository.server");
  return { ...(await readIndex()), origin: await requestOrigin() };
});

export const getTopics = createServerFn({ method: "GET" }).handler(async () => {
  const { readTopics } = await import("./repository.server");
  return { ...(await readTopics()), origin: await requestOrigin() };
});

export const getTopic = createServerFn({ method: "GET" })
  .validator((input: { slug: string }) => input)
  .handler(async ({ data }) => {
    const { readTopic } = await import("./repository.server");
    const result = await readTopic(data.slug);
    return result ? { ...result, origin: await requestOrigin() } : result;
  });

export const getArticle = createServerFn({ method: "GET" })
  .validator((input: { slug: string }) => input)
  .handler(async ({ data }) => {
    const { readArticle } = await import("./repository.server");
    const result = await readArticle(data.slug);
    return result ? { ...result, origin: await requestOrigin() } : result;
  });

export const getSitemapEntries = createServerFn({ method: "GET" }).handler(async () => {
  const { readSitemap } = await import("./repository.server");
  return readSitemap();
});

export const getPage = createServerFn({ method: "GET" })
  .validator((input: { slug: string }) => input)
  .handler(async ({ data }) => {
    const { readPage } = await import("./repository.server");
    const { standardPage } = await import("./pages-seed");
    const { pageExcerpt } = await import("@/lib/pages");
    const row = await readPage(data.slug);
    if (!row) return null;
    const seed = standardPage(row.slug);
    return {
      slug: row.slug,
      title: row.title,
      body: row.body,
      updatedAt: row.updated_at,
      description: seed?.description ?? pageExcerpt(row.body, row.title),
      origin: await requestOrigin(),
    };
  });
