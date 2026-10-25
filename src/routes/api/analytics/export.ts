import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin.server";
import { analyticsExportCsv } from "@/content/analytics.server";

const ExportQuery = z.object({
  table: z.enum(["articles", "categories", "sources", "devices", "overview"]),
  preset: z.enum(["today", "yesterday", "last-7", "last-28", "last-30", "last-90", "last-12-months", "custom"]).optional(),
  from: z.string().max(20).optional(),
  to: z.string().max(20).optional(),
  categoryId: z.string().max(80).optional().nullable(),
  tagId: z.string().max(80).optional().nullable(),
  q: z.string().max(200).optional().nullable(),
});

export const Route = createFileRoute("/api/analytics/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await requireAdmin();
        const url = new URL(request.url);
        const parsed = ExportQuery.parse({
          table: url.searchParams.get("table"),
          preset: url.searchParams.get("preset") || undefined,
          from: url.searchParams.get("from") || undefined,
          to: url.searchParams.get("to") || undefined,
          categoryId: url.searchParams.get("categoryId") || undefined,
          tagId: url.searchParams.get("tagId") || undefined,
          q: url.searchParams.get("q") || undefined,
        });
        const { csv, filename } = await analyticsExportCsv({
          table: parsed.table,
          period: { preset: parsed.preset ?? "last-28", from: parsed.from ?? "", to: parsed.to ?? "" },
          categoryId: parsed.categoryId ?? null,
          tagId: parsed.tagId ?? null,
          q: parsed.q ?? null,
        });
        return new Response(csv, {
          status: 200,
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${filename}"`,
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
