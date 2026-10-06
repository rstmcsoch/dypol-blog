import { getRouteApi } from "@tanstack/react-router";
import { site as fallbackSite } from "@/content/site";
import type { SiteConfig } from "@/content/types";

const rootRoute = getRouteApi("__root__");

export function useSite(): SiteConfig {
  const data = rootRoute.useLoaderData();
  return data?.site ?? fallbackSite;
}

export function useTrending(): { id: string; slug: string; title: string }[] {
  const data = rootRoute.useLoaderData();
  return data?.trending ?? [];
}
