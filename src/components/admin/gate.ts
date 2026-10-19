import { redirect } from "@tanstack/react-router";
import { adminSession } from "@/content/admin-api";

export type DeskSession = Awaited<ReturnType<typeof adminSession>>;

/**
 * Single-entry gate (t83 follow-up): /admin is the only admin page.
 * Unauthenticated visits render the sign-in form inline at /admin instead
 * of redirecting to a separate login page. Returns the session, or null
 * with `locked` when the deployment has no admin secrets configured
 * (Forbidden). Any other error is rethrown - it is a server problem, not
 * a sign-in state.
 */
export async function getDeskSession(): Promise<{ session: DeskSession | null; locked: boolean }> {
  try {
    return { session: await adminSession(), locked: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Forbidden")) return { session: null, locked: true };
    if (message.includes("Unauthorized")) return { session: null, locked: false };
    throw error;
  }
}

/** @deprecated Callers should render sign-in inline via getDeskSession(). */
export async function requireDesk() {
  const { session, locked } = await getDeskSession();
  if (!session) throw redirect({ to: "/admin", search: { denied: locked } });
  return session;
}

/** Plain-language error text; validation errors become "field: problem" lines. */
export function errorText(error: unknown): string {
  if (!(error instanceof Error) || !error.message) return "Something went wrong.";
  const text = error.message.trim();
  if (text.startsWith("[")) {
    try {
      const issues = JSON.parse(text) as { path?: (string | number)[]; message?: string }[];
      if (Array.isArray(issues) && issues.length > 0) {
        return issues
          .slice(0, 5)
          .map((issue) => `${(issue.path ?? []).join(" › ") || "Value"}: ${issue.message ?? "is not valid"}`)
          .join("; ");
      }
    } catch {
      /* not JSON */
    }
  }
  return text;
}
