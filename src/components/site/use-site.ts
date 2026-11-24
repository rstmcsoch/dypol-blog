import { getRouteApi, useRouterState } from "@tanstack/react-router";
import { site as fallbackSite } from "@/content/site";
import type { SiteConfig } from "@/content/types";

const rootRoute = getRouteApi("__root__");

export function useSite(): SiteConfig {
  const data = rootRoute.useLoaderData();
  return data?.site ?? fallbackSite;
}

/** Seasonal event for this request (null = the ordinary site). */
export function useEvent(): import("@/lib/events").SiteEvent | null {
  const data = rootRoute.useLoaderData();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // t202: never on admin article previews.
  if (pathname === "/preview" || pathname.startsWith("/preview/")) return null;
  return data?.event ?? null;
}

export function useTrending(): import("@/content/ticker").TickerEntry[] {
  const data = rootRoute.useLoaderData();
  return data?.trending ?? [];
}

export function usePages(): { slug: string; title: string }[] {
  const data = rootRoute.useLoaderData();
  return data?.pages ?? [];
}

export type MenuTopic = { slug: string; label: string; count: number };

/** t96: published-story counts per topic for the menu; null when unknown (content layer down). */
export function useMenuTopics(): MenuTopic[] | null {
  const data = rootRoute.useLoaderData();
  return (data?.menuTopics as MenuTopic[] | null | undefined) ?? null;
}
