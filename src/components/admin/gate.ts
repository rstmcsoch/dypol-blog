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

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong.";
}
