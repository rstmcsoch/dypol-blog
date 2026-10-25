import { useState } from "react";
import { adminPending } from "@/components/admin/pending";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import {
  adminSecurityChangePassword, adminSecurityRegenRecovery, adminSecurityResetTotpConfirm,
  adminSecurityResetTotpStart, adminSecuritySetupConfirm, adminSecuritySetupStart, adminSecurityStatus,
} from "@/content/admin-api";

export const Route = createFileRoute("/admin/security")({
  ...adminPending,
  loader: () => adminSecurityStatus(),
  component: SecurityAdmin,
});

type Enrolment = { secret: string; qrSvg: string } | null;

function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="banner" role="status" style={{ borderColor: "var(--good, #1a7f37)" }}>
      <p><strong>✅ Password + 2FA sign-in is now active.</strong></p>
      <p><strong>Save these recovery codes now — they are shown only once.</strong> Each one can sign you in once if you lose your authenticator. Store them somewhere safe (password manager / paper), not on this site.</p>
      <p style={{ fontFamily: "monospace", lineHeight: 1.9 }}>{codes.map((c) => <span key={c} style={{ display: "inline-block", marginRight: "1rem" }}>{c}</span>)}</p>
      <button
        className="btn btn--ghost"
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(codes.join("\n")).then(() => setCopied(true)).catch(() => setCopied(false));
        }}
      >
        {copied ? "Copied ✓" : "Copy all codes"}
      </button>
    </div>
  );
}

function SecurityAdmin() {
  const status = Route.useLoaderData();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  // per-form feedback (t82: errors live next to the form that caused them)
  const [setupError, setSetupError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // setup / reset enrolment state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [enrolment, setEnrolment] = useState<Enrolment>(null);
  const [enrolFor, setEnrolFor] = useState<"setup" | "reset">("setup");
  const [confirmCode, setConfirmCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  // change / verify-current state
  const [currentPassword, setCurrentPassword] = useState("");
  const [currentCode, setCurrentCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");

  const startSetup = async () => {
    setPending(true);
    setSetupError(null);
    setConfirmError(null);
    try {
      // Restart when credentials already exist (server keeps them, fresh QR).
      if (!status.pending && password !== password2) throw new Error("The two passwords do not match.");
      const r = await adminSecuritySetupStart({ data: { username, password } });
      setEnrolment({ secret: r.secret, qrSvg: r.qrSvg });
      setEnrolFor("setup");
      setMessage(r.restarted ? "Fresh QR code generated — earlier codes no longer work. Scan the new one." : "Now scan the QR code with your authenticator app, then enter the 6-digit code it shows.");
    } catch (e) {
      setSetupError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  const startReset = async () => {
    setPending(true);
    setManageError(null);
    setConfirmError(null);
    try {
      const r = await adminSecurityResetTotpStart({ data: { currentPassword, currentCode } });
      setEnrolment({ secret: r.secret, qrSvg: r.qrSvg });
      setEnrolFor("reset");
      setMessage("Scan the new QR code, then enter the 6-digit code. Your old authenticator entry keeps working until you confirm.");
    } catch (e) {
      setManageError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  const confirmEnrolment = async () => {
    setPending(true);
    setConfirmError(null);
    try {
      if (enrolFor === "setup") {
        const r = await adminSecuritySetupConfirm({ data: { code: confirmCode } });
        if (!r.ok) {
          setConfirmError(r.message);
          setConfirmCode("");
          return;
        }
        setRecoveryCodes(r.recoveryCodes);
        setMessage(null);
      } else {
        const r = await adminSecurityResetTotpConfirm({ data: { code: confirmCode } });
        setRecoveryCodes(r.recoveryCodes);
        setMessage("New authenticator confirmed. Old recovery codes were replaced with the ones below.");
      }
      setEnrolment(null);
      setConfirmCode("");
      await router.invalidate();
    } catch (e) {
      setConfirmError(errorText(e));
      setConfirmCode("");
    } finally {
      setPending(false);
    }
  };

  const enrolmentBlock = enrolment ? (
    <section className="desk-section">
      <h2>{enrolFor === "setup" ? "Scan with your authenticator app" : "Scan the new QR code"}</h2>
      <div style={{ maxWidth: "220px", background: "#fff", padding: "8px" }} dangerouslySetInnerHTML={{ __html: enrolment.qrSvg }} />
      <p className="desk-note">
        Prefer scanning — typing the secret by hand is the most common reason codes get rejected. If asked, choose
        <strong> time-based</strong>. Manual secret (grouped for typing):{" "}
        <strong style={{ fontFamily: "monospace" }}>{grouped(enrolment.secret)}</strong> (account “DYPOL Blog”).
      </p>
      <form className="stack" style={{ maxWidth: "26rem" }} onSubmit={(e) => { e.preventDefault(); void confirmEnrolment(); }}>
        <label className="field">
          <span>6-digit code from the app</span>
          <input inputMode="numeric" autoComplete="one-time-code" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} required autoFocus />
        </label>
        {confirmError ? <p className="banner banner--bad" role="alert">{confirmError}</p> : null}
        <button className="btn" type="submit" disabled={pending}>{pending ? "Checking…" : "Confirm code & finish"}</button>
        <button
          className="btn btn--ghost"
          type="button"
          disabled={pending}
          onClick={() => {
            setConfirmError(null);
            if (enrolFor === "setup") void startSetup();
            else void startReset();
          }}
        >
          Show a fresh QR code (invalidates this one)
        </button>
      </form>
    </section>
  ) : null;

  return (
    <>
      <p className="desk-kicker">System</p>
      <h1 className="desk-title">Security</h1>
      <p className="desk-note">
        How you sign in to this admin panel. Articles, automation and the public site are not affected by anything here.
      </p>
      {message ? <p className="banner" role="status">{message}</p> : null}
      {recoveryCodes ? <RecoveryCodes codes={recoveryCodes} /> : null}

      <section className="desk-section">
        <h2>Sign-in status</h2>
        {status.active ? (
          <p className="desk-note">
            <strong>✅ Username + password + authenticator (2FA) is active</strong> for <strong>{status.username}</strong>.
            The shared admin token can no longer sign in. Recovery codes remaining: <strong>{status.recoveryRemaining}</strong> of 10.
          </p>
        ) : status.pending ? (
          <p className="desk-note">
            <strong>Setup is half-finished:</strong> username and password for <strong>{status.username}</strong> are saved,
            but no authenticator is confirmed yet — so <strong>admin-token sign-in still works</strong>. Finish below:
            get a fresh QR code, scan it, enter the code.
          </p>
        ) : (
          <p className="desk-note">
            <strong>Admin-token sign-in is still active.</strong> Set up a username, password and authenticator below —
            the moment you confirm the first code, token sign-in switches off. Nothing changes until then, so you
            cannot lock yourself out by starting this.
          </p>
        )}
      </section>

      {!status.active && !enrolment ? (
        <section className="desk-section">
          <h2>{status.pending ? "Finish setting up the authenticator" : "Set up password + 2FA sign-in"}</h2>
          {status.pending ? (
            <>
              <p className="desk-note">Your credentials are already saved. You only need the authenticator step — a fresh QR replaces any earlier one (including any secret you may have shared in a screenshot).</p>
              {setupError ? <p className="banner banner--bad" role="alert">{setupError}</p> : null}
              <button className="btn" type="button" disabled={pending} onClick={() => void startSetup()}>
                {pending ? "Preparing…" : "Show a fresh QR code"}
              </button>
            </>
          ) : (
            <form className="stack" style={{ maxWidth: "26rem" }} onSubmit={(e) => { e.preventDefault(); void startSetup(); }}>
              <label className="field">
                <span>Username</span>
                <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </label>
              <label className="field">
                <span>Password (at least 12 characters)</span>
                <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              <label className="field">
                <span>Password again</span>
                <input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required />
              </label>
              {setupError ? <p className="banner banner--bad" role="alert">{setupError}</p> : null}
              <button className="btn" type="submit" disabled={pending}>{pending ? "Preparing…" : "Create credentials & show QR code"}</button>
            </form>
          )}
        </section>
      ) : null}

      {enrolmentBlock}

      {status.active ? (
        <>
          <section className="desk-section">
            <h2>Change password</h2>
            <form
              className="stack"
              style={{ maxWidth: "26rem" }}
              onSubmit={(e) => {
                e.preventDefault();
                void (async () => {
                  setPending(true);
                  setManageError(null);
                  try {
                    if (newPassword !== newPassword2) throw new Error("The two new passwords do not match.");
                    await adminSecurityChangePassword({ data: { currentPassword, currentCode, newPassword } });
                    setNewPassword(""); setNewPassword2("");
                    setMessage("Password changed.");
                  } catch (err) {
                    setManageError(errorText(err));
                  } finally {
                    setPending(false);
                  }
                })();
              }}
            >
              <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></label>
              <label className="field"><span>Current authenticator / recovery code</span><input autoComplete="one-time-code" value={currentCode} onChange={(e) => setCurrentCode(e.target.value)} required /></label>
              <label className="field"><span>New password (at least 12 characters)</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /></label>
              <label className="field"><span>New password again</span><input type="password" autoComplete="new-password" value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)} required /></label>
              {manageError ? <p className="banner banner--bad" role="alert">{manageError}</p> : null}
              <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : "Change password"}</button>
            </form>
          </section>

          <section className="desk-section">
            <h2>Authenticator (2FA)</h2>
            <p className="desk-note">Lost your phone or moving to a new one? Verify yourself (fields above), scan a fresh QR code, and the old entry stops working. This also replaces your recovery codes.</p>
            <button className="btn btn--ghost" type="button" disabled={pending || !currentPassword || !currentCode} onClick={() => void startReset()}>
              Reset authenticator (uses current password + code above)
            </button>
          </section>

          <section className="desk-section">
            <h2>Recovery codes</h2>
            <p className="desk-note">{status.recoveryRemaining} unused codes remain. Generating new ones cancels every old code.</p>
            <button
              className="btn btn--ghost"
              type="button"
              disabled={pending || !currentPassword || !currentCode}
              onClick={() =>
                void (async () => {
                  setPending(true);
                  setManageError(null);
                  try {
                    const r = await adminSecurityRegenRecovery({ data: { currentPassword, currentCode } });
                    setRecoveryCodes(r.recoveryCodes);
                    setMessage("New recovery codes generated — the old ones no longer work.");
                    await router.invalidate();
                  } catch (err) {
                    setManageError(errorText(err));
                  } finally {
                    setPending(false);
                  }
                })()
              }
            >
              Generate new recovery codes (uses current password + code above)
            </button>
          </section>

          <section className="desk-section">
            <h2>If you ever get locked out</h2>
            <p className="desk-note">
              1) Use a recovery code at sign-in. 2) If those are gone too: in Cloudflare → Workers &amp; Pages → this
              site → D1, delete the row in the <strong>admin_users</strong> table — admin-token sign-in comes back
              immediately and you can set up again here. Rotating the ADMIN_SESSION_SECRET secret also signs out
              every session. Full details are in the Help page (admin guide).
            </p>
          </section>
        </>
      ) : null}
    </>
  );
}
