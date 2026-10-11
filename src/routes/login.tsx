import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { adminSignIn } from "@/content/admin-api";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    denied: search.denied === true || search.denied === "true" || search.denied === "1",
  }),
  head: () => ({
    meta: [
      { title: "Admin sign-in — DYPOL Blog" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { denied } = Route.useSearch();
  const router = useRouter();
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="page">
      <div className="container">
        <header className="page-header">
          <p className="kicker">Desk</p>
          <h1 className="page-title">Sign in</h1>
          {denied ? <p className="lede">The desk is locked until an editor token is configured.</p> : null}
          <form
            className="stack login-form"
            style={{ maxWidth: "24rem" }}
            onSubmit={(event) => {
              event.preventDefault();
              setPending(true);
              setError(null);
              void adminSignIn({ data: { token } })
                .then(async (raw) => {
                  if ((raw as unknown) instanceof Response) {
                    const wait = Number((raw as unknown as Response).headers.get("Retry-After")) || 60;
                    setError(`Too many attempts. Try again in ${wait} seconds.`);
                    return;
                  }
                  const result = raw;
                  if (result.ok) {
                    await router.navigate({ to: "/admin" });
                    return;
                  }
                  setError(
                    result.reason === "locked"
                      ? "Sign-in is locked on this deployment: no ADMIN_TOKEN secret is set."
                      : "That token is not right.",
                  );
                })
                .catch((error: unknown) => {
                  if (error instanceof Response && error.status === 429) {
                    const wait = Number(error.headers.get("Retry-After")) || 60;
                    setError(`Too many attempts. Try again in ${wait} seconds.`);
                    return;
                  }
                  setError("Sign-in failed. Try again.");
                })
                .finally(() => setPending(false));
            }}
          >
            <label className="field">
              <span>Editor token</span>
              <input
                type="password"
                autoComplete="current-password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                required
              />
            </label>
            <button className="btn" type="submit" disabled={pending}>
              {pending ? "Checking…" : "Sign in"}
            </button>
            {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}
          </form>
        </header>
      </div>
    </div>
  );
}
