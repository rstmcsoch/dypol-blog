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

export const getIndex = createServerFn({ method: "GET" })
  .validator((input: { page?: number } | undefined) => ({ page: input?.page ?? 1 }))
  .handler(async ({ data }) => {
    const { readIndex } = await import("./repository.server");
    const result = await readIndex(data.page);
    return result ? { ...result, origin: await requestOrigin() } : null;
  });

export const getTopics = createServerFn({ method: "GET" }).handler(async () => {
  const { readTopics } = await import("./repository.server");
  return { ...(await readTopics()), origin: await requestOrigin() };
});

export const getTopic = createServerFn({ method: "GET" })
  .validator((input: { slug: string; page?: number }) => input)
  .handler(async ({ data }) => {
    const { readTopic } = await import("./repository.server");
    const result = await readTopic(data.slug, data.page ?? 1);
    return result ? { ...result, origin: await requestOrigin() } : result;
  });

export const getArticle = createServerFn({ method: "GET" })
  .validator((input: { slug: string }) => input)
  .handler(async ({ data }) => {
    const { readArticle, resolveRedirect } = await import("./repository.server");
    const result = await readArticle(data.slug);
    if (!result) {
      // t115: an old or merged slug answers with a 301 to its canonical story.
      const to = await resolveRedirect(data.slug);
      return to ? { redirectTo: to } : null;
    }
    return { ...result, origin: await requestOrigin() };
  });

/** t115: /search?q= — ranked FTS5 results with highlighted snippets (light payload). */
export const getSearch = createServerFn({ method: "GET" })
  .validator((input: { q?: string }) => ({ q: typeof input?.q === "string" ? input.q.slice(0, 120) : "" }))
  .handler(async ({ data }) => {
    const { searchArticles } = await import("./repository.server");
    try {
      const { query, results, meta } = await searchArticles(data.q);
      return {
        query,
        error: false,
        results: results.map(({ article, snippet }) => ({
          id: article.id,
          slug: article.slug,
          title: article.title,
          publishedAt: article.publishedAt,
          coverMediaId: article.coverMediaId ?? null,
          coverAlt: article.coverAlt ?? null,
          coverImage: article.coverImage ?? null,
          snippet,
          topics: meta[article.id]?.topicLabels ?? [],
          minutes: meta[article.id]?.minutes ?? 1,
        })),
      };
    } catch (error) {
      console.error("[search]", error);
      return { query: data.q, error: true, results: [] };
    }
  });

/** t115: the contact form's Turnstile site key (null = not configured: the form fails closed). */
export const getContactConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { turnstileConfig } = await import("./contact.server");
  const host = new URL(getRequest().url).host;
  const cfg = await turnstileConfig(host);
  return { siteKey: cfg.siteKey };
});

export const getSitemapEntries = createServerFn({ method: "GET" }).handler(async () => {
  const { readSitemap } = await import("./repository.server");
  return readSitemap();
});

export const getPage = createServerFn({ method: "GET" })
  .validator((input: { slug: string }) => input)
  .handler(async ({ data }) => {
    const { readPage, readShell } = await import("./repository.server");
    const { standardPage } = await import("./pages-seed");
    const { pageExcerpt } = await import("@/lib/pages");
    const row = await readPage(data.slug);
    if (!row) return null;
    const seed = standardPage(row.slug);
    return {
      site: (await readShell()).site,
      slug: row.slug,
      title: row.title,
      body: row.body,
      updatedAt: row.updated_at,
      description: seed?.description ?? pageExcerpt(row.body, row.title),
      origin: await requestOrigin(),
    };
  });
