import { createFileRoute, Link } from "@tanstack/react-router";
import { authEnabled, GROK_PROVIDERS, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    denied: search.denied === true || search.denied === "true" || search.denied === "1",
  }),
  head: () => ({
    meta: [
      { title: "Desk — DYPOL Blog" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { denied } = Route.useSearch();
  return (
    <div className="page">
      <div className="container">
        <header className="page-header">
          <p className="kicker">Desk</p>
          <h1 className="page-title">Sign in</h1>
          {denied ? <p className="lede">This account is not an editor.</p> : null}
          {!authEnabled ? (
            <>
              <p className="lede">
                Sign-in is off in this environment. The desk is open here, and it is locked to granted accounts once
                sign-in is turned on.
              </p>
              <Link to="/admin" className="btn">
                Open the desk
              </Link>
            </>
          ) : (
            <div className="stack" style={{ maxWidth: "24rem" }}>
              {GROK_PROVIDERS.map((provider) => (
                <button
                  key={provider.providerId}
                  type="button"
                  className="btn"
                  onClick={() => void signIn(provider.providerId, { callbackURL: "/admin" })}
                >
                  Continue with {provider.label}
                </button>
              ))}
            </div>
          )}
        </header>
      </div>
    </div>
  );
}
