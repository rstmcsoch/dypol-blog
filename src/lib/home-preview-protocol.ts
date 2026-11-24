/**
 * t217: tiny state machine for the homepage preview dialog. The frame is kept hidden ("loading")
 * until it acknowledges it rendered the latest draft we sent, so stored content never flashes.
 * Acks/errors for an older draft id are ignored.
 */
export type PreviewState = { status: "loading" | "ready" | "error"; sent: number };
export type PreviewEvent =
  | { type: "reset" }
  | { type: "sent"; id: number }
  | { type: "applied"; id: number }
  | { type: "failed"; id: number }
  | { type: "timeout"; id: number };

export const PREVIEW_INITIAL: PreviewState = { status: "loading", sent: 0 };
export const PREVIEW_TIMEOUT_MS = 15000;

export function previewReducer(state: PreviewState, event: PreviewEvent): PreviewState {
  switch (event.type) {
    case "reset":
      return { status: "loading", sent: state.sent };
    case "sent":
      // Once ready, later edits keep the current render visible while the update arrives.
      return { status: state.status === "ready" ? "ready" : "loading", sent: event.id };
    case "applied":
      return event.id === state.sent ? { ...state, status: "ready" } : state;
    case "failed":
    case "timeout":
      return event.id === state.sent && state.status !== "ready"
        ? { ...state, status: "error" }
        : state;
  }
}

/** Same-origin message from exactly the expected window, with a known type. */
export function isTrustedMessage(
  event: { origin: string; source: unknown; data: unknown },
  origin: string,
  source: unknown,
  type: string,
): boolean {
  return (
    event.origin === origin &&
    source != null &&
    event.source === source &&
    (event.data as { type?: unknown } | null)?.type === type
  );
}
