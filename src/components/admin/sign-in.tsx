import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { adminLoginStart, adminLoginStatus, adminLoginVerify, adminSignIn } from "@/content/admin-api";

type Mode = "loading" | "token" | "password";

/**
 * The one and only admin sign-in form (t83 follow-up). Rendered inline by
 * the /admin layout when there is no desk session - there is no separate
 * login page any more (/login permanently redirects to /admin). All auth
 * logic lives server-side in admin-api.ts (rate limiting, TOTP step,
 * recovery codes); this component only drives the steps.
 */
export function AdminSignIn({ denied = false }: { denied?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("loading");
  const [setupPending, setSetupPending] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [locked, setLocked] = useState(false);
  const [step, setStep] = useState<"credentials" | "totp">("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void adminLoginStatus()
      .then((status) => {
        setLocked(!status.configured);
        setSetupPending(status.setupPending);
        setMode(status.mode);
      })
      .catch(() => {
        // t83: never fall back silently - token sign-in stays available
        // (lockout-safe), but the page says the check failed.
        setStatusError(true);
        setMode("token");
      });
  }, []);

  const tooMany = (wait: number) => setError(`Too many attempts. Try again in ${wait} seconds.`);

  const submitToken = () => {
    setPending(true);
    setError(null);
    void adminSignIn({ data: { token } })
      .then(async (raw) => {
        if ((raw as unknown) instanceof Response) {
          tooMany(Number((raw as unknown as Response).headers.get("Retry-After")) || 60);
          return;
        }
        if (raw.ok) {
          await router.invalidate();
          await router.navigate({ to: "/admin" });
          return;
        }
        setError(
          raw.reason === "locked"
            ? "Sign-in is locked on this deployment: no ADMIN_TOKEN secret is set."
            : "That token is not right.",
        );
      })
      .catch((e: unknown) => {
        if (e instanceof Response && e.status === 429) tooMany(Number(e.headers.get("Retry-After")) || 60);
        else setError("Sign-in failed. Try again.");
      })
      .finally(() => setPending(false));
  };

  const submitCredentials = () => {
    setPending(true);
    setError(null);
    void adminLoginStart({ data: { username, password } })
      .then(async (raw) => {
        if ((raw as unknown) instanceof Response) {
          tooMany(Number((raw as unknown as Response).headers.get("Retry-After")) || 60);
          return;
        }
        const result = raw;
        if (result.ok) {
          setStep("totp");
          return;
        }
        if (result.stage === "locked") setError("Sign-in is locked on this deployment.");
        else if (result.stage === "token") {
          setMode("token");
          setError("Password login is not set up yet — sign in with the admin token.");
        } else setError("Username or password is not right.");
      })
      .catch((e: unknown) => {
        if (e instanceof Response && e.status === 429) tooMany(Number(e.headers.get("Retry-After")) || 60);
        else setError("Sign-in failed. Try again.");
      })
      .finally(() => setPending(false));
  };

  const submitCode = () => {
    setPending(true);
    setError(null);
    void adminLoginVerify({ data: { code } })
      .then(async (raw) => {
        if ((raw as unknown) instanceof Response) {
          tooMany(Number((raw as unknown as Response).headers.get("Retry-After")) || 60);
          return;
        }
        const result = raw;
        if (result.ok) {
          await router.invalidate();
          await router.navigate({ to: "/admin" });
          return;
        }
        if (result.stage === "expired") {
          setStep("credentials");
          setError("That step expired. Enter your password again.");
        } else setError("That code is not right.");
      })
      .catch((e: unknown) => {
        if (e instanceof Response && e.status === 429) tooMany(Number(e.headers.get("Retry-After")) || 60);
        else setError("Sign-in failed. Try again.");
      })
      .finally(() => setPending(false));
  };

  return (
    <div className="page">
      <div className="container">
        <header className="page-header">
          <p className="kicker">Admin</p>
          <h1 className="page-title">Sign in</h1>
          {denied || locked ? (
            <p className="lede">Sign-in is locked until the admin secrets (ADMIN_TOKEN / ADMIN_SESSION_SECRET) are configured.</p>
          ) : null}

          {mode === "password" && step === "credentials" ? (
            <form
              className="stack login-form"
              style={{ maxWidth: "24rem" }}
              onSubmit={(e) => {
                e.preventDefault();
                submitCredentials();
              }}
            >
              <label className="field">
                <span>Username</span>
                <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </label>
              <label className="field">
                <span>Password</span>
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              <button className="btn" type="submit" disabled={pending}>
                {pending ? "Checking…" : "Continue"}
              </button>
              {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}
            </form>
          ) : null}

          {mode === "password" && step === "totp" ? (
            <form
              className="stack login-form"
              style={{ maxWidth: "24rem" }}
              onSubmit={(e) => {
                e.preventDefault();
                submitCode();
              }}
            >
              <p className="field-help">Enter the 6-digit code from your authenticator app — or one of your recovery codes.</p>
              <label className="field">
                <span>Authentication code</span>
                <input
                  inputMode="text"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  autoFocus
                />
              </label>
              <button className="btn" type="submit" disabled={pending}>
                {pending ? "Checking…" : "Sign in"}
              </button>
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => {
                  setStep("credentials");
                  setError(null);
                }}
              >
                Back
              </button>
              {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}
            </form>
          ) : null}

          {mode === "token" && setupPending ? (
            <p className="banner" role="status" style={{ maxWidth: "32rem" }}>
              <strong>Password sign-in is not active yet.</strong> A username and password were saved, but the
              authenticator step was never confirmed, so this page still uses the admin token. Sign in with the
              token, open <strong>Admin → Security</strong>, and finish the authenticator confirmation there —
              from that moment this page will ask for your username, password and authenticator code instead.
            </p>
          ) : null}

          {mode === "token" && statusError ? (
            <p className="banner banner--bad" role="alert" style={{ maxWidth: "32rem" }}>
              The sign-in status check failed, so token sign-in is shown as a fallback. If you already finished
              setting up password + 2FA, reload this page; if the problem repeats, it is a server problem, not
              your credentials.
            </p>
          ) : null}

          {mode === "token" ? (
            <form
              className="stack login-form"
              style={{ maxWidth: "24rem" }}
              onSubmit={(e) => {
                e.preventDefault();
                submitToken();
              }}
            >
              <label className="field">
                <span>Admin token</span>
                <input type="password" autoComplete="current-password" value={token} onChange={(e) => setToken(e.target.value)} required />
              </label>
              <button className="btn" type="submit" disabled={pending}>
                {pending ? "Checking…" : "Sign in"}
              </button>
              {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}
            </form>
          ) : null}

          {mode === "loading" ? <p className="field-help">Loading sign-in…</p> : null}
        </header>
      </div>
    </div>
  );
}
