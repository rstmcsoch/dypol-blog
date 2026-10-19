import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /admin is the one and only admin entry point (t83 follow-up). /login is
 * kept only as a permanent redirect for old bookmarks/links. 308 (not
 * 301) preserves the request method on any non-GET hit and is not cached
 * as aggressively by intermediaries; the `denied` flag is the only query
 * param the old page ever used, and it is carried across.
 */
export const Route = createFileRoute("/login")({
  // Optional: returning a required search param makes the router first
  // canonicalise /login to /login?denied=false (an extra 307 hop).
  validateSearch: (search: Record<string, unknown>): { denied?: boolean } => ({
    denied: search.denied === true || search.denied === "true" || search.denied === "1" ? true : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/admin", search: { denied: search.denied }, statusCode: 308 });
  },
  component: () => null,
});
