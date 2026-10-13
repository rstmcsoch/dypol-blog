import { createServerFn } from "@tanstack/react-start";

export const getShell = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { readShell } = await import("./repository.server");
    return await readShell();
  } catch (error) {
    // The site frame must always render, even if the content layer is broken.
    console.error("[shell] falling back to the built-in site config.", error);
    const { site } = await import("./site");
    return {
      site,
      trending: [] as import("./ticker").TickerEntry[],
      trendingNote: "",
      trendingFallback: false,
    };
  }
});

export const getHome = createServerFn({ method: "GET" }).handler(async () => {
  const { readHome } = await import("./repository.server");
  return readHome();
});

export const getIndex = createServerFn({ method: "GET" }).handler(async () => {
  const { readIndex } = await import("./repository.server");
  return readIndex();
});

export const getTopics = createServerFn({ method: "GET" }).handler(async () => {
  const { readTopics } = await import("./repository.server");
  return readTopics();
});

export const getTopic = createServerFn({ method: "GET" })
  .validator((input: { slug: string }) => input)
  .handler(async ({ data }) => {
    const { readTopic } = await import("./repository.server");
    return readTopic(data.slug);
  });

export const getArticle = createServerFn({ method: "GET" })
  .validator((input: { slug: string }) => input)
  .handler(async ({ data }) => {
    const { readArticle } = await import("./repository.server");
    return readArticle(data.slug);
  });

export const getSitemapEntries = createServerFn({ method: "GET" }).handler(async () => {
  const { readSitemap } = await import("./repository.server");
  return readSitemap();
});
