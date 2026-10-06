import type { ErrorComponentProps } from "@tanstack/react-router";
import { site } from "@/content/site";

const FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className="error-screen">
      <div className="state-panel">
        <h1 className="state-panel__title">{site.labels.errorTitle}</h1>
        <p>{errorMessage(error)}</p>
        <a className="btn" href="/">
          {site.labels.errorHome}
        </a>
      </div>
    </main>
  );
}
