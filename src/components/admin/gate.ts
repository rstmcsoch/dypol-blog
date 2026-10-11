import { redirect } from "@tanstack/react-router";
import { adminSession } from "@/content/admin-api";

export async function requireDesk() {
  try {
    return await adminSession();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Forbidden")) throw redirect({ to: "/login", search: { denied: true } });
    if (message.includes("Unauthorized")) throw redirect({ to: "/login", search: { denied: false } });
    throw error;
  }
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
