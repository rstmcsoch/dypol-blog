import { createServerFn } from "@tanstack/react-start";

export const adminArticleStorage = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("@/lib/auth/admin.server");
  await requireAdmin();
  const { readDailyArticleStorage } = await import("@/lib/r2-usage.server");
  return readDailyArticleStorage();
});
