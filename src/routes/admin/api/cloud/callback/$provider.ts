import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth/admin.server";

/** t173: OAuth redirect target for Google Drive / OneDrive / Dropbox. Admin session required. */
export const Route = createFileRoute("/admin/api/cloud/callback/$provider")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const back = (msg: string, ok: boolean) =>
          new Response(null, { status: 303, headers: { location: `/admin/automation?tab=special&cloud=${encodeURIComponent(params.provider)}&${ok ? "connected=1" : `error=${encodeURIComponent(msg.slice(0, 200))}`}#cloud`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
        try {
          await requireAdmin();
        } catch {
          return new Response("Sign in to the admin panel first.", { status: 401, headers: { "cache-control": "no-store" } });
        }
        const cloud = await import("@/content/cloud.server");
        const p = params.provider;
        if (!cloud.isOAuthCloud(p)) return back("Unknown provider.", false);
        const error = url.searchParams.get("error");
        if (error) {
          await cloud.markCloudError(p, `Authorization was declined (${error}).`);
          return back(`Authorization was declined (${error}).`, false);
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return back("The provider did not return a code.", false);
        try {
          await cloud.finishCloudConnect(p, url.origin, code, state);
          return back("", true);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "The connection failed.";
          await cloud.markCloudError(p, msg);
          return back(msg, false);
        }
      },
    },
  },
});
