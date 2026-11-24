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
      if (message.includes("Unauthorized") || message.includes("Forbidden"))
        throw redirect({ to: "/admin", search: { denied: message.includes("Forbidden") } });
      throw error;
    }
  },
  head: () => ({
    meta: [{ title: sitePageTitle("Homepage preview") }, { name: "robots", content: "noindex" }],
  }),
  component: HomePreview,
});

function HomePreview() {
  const initial = Route.useLoaderData();
  const [data, setData] = useState<Preview & { ack?: number }>(initial);
  useEffect(() => {
    let seq = 0;
    const reply = (msg: object) => window.parent.postMessage(msg, window.location.origin);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const msg = event.data as { type?: string; draft?: string; id?: number };
      if (msg?.type !== "dypol-home-draft" || typeof msg.draft !== "string") return;
      const id = typeof msg.id === "number" ? msg.id : 0;
      const mine = ++seq;
      void adminHomePreview({ data: JSON.parse(msg.draft) })
        .then((next) => {
          if (mine === seq) setData({ ...next, ack: id });
        })
        .catch(() => {
          if (mine === seq) reply({ type: "dypol-home-error", id });
        });
    };
    window.addEventListener("message", onMessage);
    // t217: tell the builder the listener is live (a draft sent at iframe `load` can arrive before hydration).
    if (window.parent !== window) reply({ type: "dypol-home-ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);
  // t217: acknowledge only after the draft render is committed, so the builder can reveal the frame.
  useEffect(() => {
    if (data.ack !== undefined && window.parent !== window)
      window.parent.postMessage(
        { type: "dypol-home-applied", id: data.ack },
        window.location.origin,
      );
  }, [data]);
  return <HomeBlocks blocks={data.blocks} site={data.site} />;
}
