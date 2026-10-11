import { createServerFn } from "@tanstack/react-start";

export const getShell = createServerFn({ method: "GET" }).handler(async () => {
  const { readShell } = await import("./repository.server");
  return readShell();
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
