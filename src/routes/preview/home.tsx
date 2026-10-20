import { useEffect, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { HomeBlocks } from "@/components/site/blocks";
import { adminHomePreview } from "@/content/admin-api";
import { sitePageTitle } from "@/lib/seo";

type Preview = Awaited<ReturnType<typeof adminHomePreview>>;

/** Homepage preview for the admin builder: renders unsaved block settings sent by the parent admin page. */
export const Route = createFileRoute("/preview/home")({
  loader: async () => {
    try {
      return await adminHomePreview({ data: {} });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Unauthorized") || message.includes("Forbidden")) throw redirect({ to: "/admin", search: { denied: message.includes("Forbidden") } });
      throw error;
    }
  },
  head: () => ({ meta: [{ title: sitePageTitle("Homepage preview") }, { name: "robots", content: "noindex" }] }),
  component: HomePreview,
});

function HomePreview() {
  const initial = Route.useLoaderData();
  const [data, setData] = useState<Preview>(initial);
  useEffect(() => {
    let seq = 0;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const msg = event.data as { type?: string; draft?: string };
      if (msg?.type !== "dypol-home-draft" || typeof msg.draft !== "string") return;
      const mine = ++seq;
      void adminHomePreview({ data: JSON.parse(msg.draft) })
        .then((next) => {
          if (mine === seq) setData(next);
        })
        .catch(() => undefined);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return <HomeBlocks blocks={data.blocks} site={data.site} />;
}
