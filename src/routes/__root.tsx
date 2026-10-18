import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { ThemeSync } from "@/components/site/theme-sync";
import { themeBootScript } from "@/components/site/theme";
import { TrendingBar } from "@/components/site/trending-bar";
import { NotFoundState } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getShell } from "@/content/public-api";
import { appearanceCss } from "@/lib/appearance";
import { site as fallbackSite } from "@/content/site";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  loader: () => getShell(),
  head: ({ loaderData }) => {
    const current = loaderData?.site ?? fallbackSite;
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: current.title },
        { name: "description", content: current.description },
        { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#ffffff" },
        { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#0a0a0a" },
        { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" },
      ],
      links: [
        // t74: hardcoded favicon set at STABLE root paths (never hashed, never
        // admin-overridable) so Google/Bing/browsers always find real files:
        // /favicon.ico was previously a 404 HTML fallback — the Search Console
        // "no favicon" cause. Files live in public/ (scripts/generate-favicons.mjs).
        { rel: "icon", href: "/favicon.ico", sizes: "any" },
        { rel: "shortcut icon", href: "/favicon.ico" },
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
        { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
        { rel: "stylesheet", href: appCss },
        { rel: "manifest", href: "/manifest.webmanifest" },
        { rel: "alternate", type: "application/rss+xml", title: `${current.title} feed`, href: "/feed.xml" },
      ],
    };
  },
  shellComponent: RootShell,
  component: RootLayout,
  notFoundComponent: NotFoundState,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>{children}</AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  const site = useSite();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const desk = pathname === "/admin" || pathname.startsWith("/admin/");
  if (desk) return <Outlet />;
  return (
    <div className="site">
      <a className="skip" href="#content">
        {site.labels.skip}
      </a>
      <style dangerouslySetInnerHTML={{ __html: appearanceCss(site.appearance) }} />
      <ThemeSync />
      <SiteHeader />
      <TrendingBar />
      <main id="content">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}