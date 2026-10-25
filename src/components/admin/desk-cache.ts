import type { getDeskSession } from "@/components/admin/gate";

type Desk = Awaited<ReturnType<typeof getDeskSession>>;

// Browser-only memo of a signed-in desk session (never on the server, where
// module state is shared between requests). Signed-out results are never
// cached, so signing in is picked up at once.
const TTL_MS = 2 * 60 * 1000;
let memo: { desk: Desk; at: number } | null = null;

export function cachedDesk(): Desk | null {
  if (typeof window === "undefined" || !memo) return null;
  if (Date.now() - memo.at > TTL_MS) {
    memo = null;
    return null;
  }
  return memo.desk;
}

export function rememberDesk(desk: Desk): Desk {
  if (typeof window !== "undefined" && desk.session) {
    if (!memo || memo.desk !== desk) memo = { desk, at: memo?.desk === desk ? memo.at : Date.now() };
  }
  return desk;
}

export function forgetDesk(): void {
  memo = null;
}
