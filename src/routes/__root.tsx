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
        { name: "theme-color", content: "#111111" },
        { name: "robots", content: "index, follow" },
      ],
      links: [
        {
          rel: "icon",
          type: "image/svg+xml",
          href: current.faviconMediaId ? `/media/${current.faviconMediaId}` : "/favicon.svg",
        },
        { rel: "stylesheet", href: appCss },
        { rel: "manifest", href: "/__grok/manifest.webmanifest" },
        { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
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