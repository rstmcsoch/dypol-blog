import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { ExternalLinkGuard } from "@/components/site/external-link-guard";
import { AdHeadCode, AdsRuntime } from "@/components/site/ads";
import { CmpHeadMirror } from "@/components/site/cmp-head";
import { ThemeSync } from "@/components/site/theme-sync";
import { themeBootScript } from "@/components/site/theme";
import { TrendingBar } from "@/components/site/trending-bar";
import { NotFoundState } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";
import { getShell } from "@/content/public-api";
import { themeColors } from "@/lib/appearance";
import { appearanceCss } from "@/lib/appearance";
import { GoogleAnalytics } from "@/components/site/google-analytics";
import { site as fallbackSite } from "@/content/site";
import appCss from "../styles.css?url";
// t88: preload the latin display font. It sets the header/headline metrics;
// arriving late swapped the font and shifted article content (CLS 0.28 in
// Lighthouse). Same file the CSS @font-face references - no extra family,
// no visual change, just earlier delivery.
import familjenLatin from "@fontsource-variable/familjen-grotesk/files/familjen-grotesk-latin-wght-normal.woff2?url";

export const Route = createRootRoute({
  loader: () => getShell(),
  head: ({ loaderData }) => {
    const current = loaderData?.site ?? fallbackSite;
    const colors = themeColors(current.appearance);
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: current.title },
        { name: "description", content: current.description },
        { property: "og:site_name", content: current.name },
        { name: "application-name", content: current.name },
        { name: "apple-mobile-web-app-title", content: current.name },
        { name: "theme-color", media: "(prefers-color-scheme: light)", content: colors.light.paper },
        { name: "theme-color", media: "(prefers-color-scheme: dark)", content: colors.dark.paper },
        { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" },
      ],
      links: [
        ...(current.faviconMediaId ? [{ rel: "icon", href: `/media/${current.faviconMediaId}` }] : [
        // Stable built-in assets are used only when no favicon is selected.
        { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
        { rel: "shortcut icon", href: "/favicon.ico" },
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
        { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
        ]),
        { rel: "preload", as: "font", type: "font/woff2", href: familjenLatin, crossOrigin: "anonymous" },
        { rel: "stylesheet", href: appCss },
        { rel: "manifest", href: "/manifest.webmanifest?v=2" },
        { rel: "alternate", type: "application/rss+xml", title: `${current.name} feed`, href: "/feed.xml" },
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
        <CmpHeadMirror />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <HeadContent />
        <AdHeadCode />
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
  // GoogleAnalytics stays the first child of a stable fragment so switching
  // between the public shell and the admin desk never remounts its tracker.
  if (desk) return <Outlet />;
  return (
    <>
    <GoogleAnalytics />
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
      <ExternalLinkGuard />
      <AdsRuntime />
    </div>
    </>
  );
}
