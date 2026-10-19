import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import {
  adminSecurityChangePassword, adminSecurityRegenRecovery, adminSecurityResetTotpConfirm,
  adminSecurityResetTotpStart, adminSecuritySetupConfirm, adminSecuritySetupStart, adminSecurityStatus,
} from "@/content/admin-api";

export const Route = createFileRoute("/admin/security")({
  loader: () => adminSecurityStatus(),
  component: SecurityAdmin,
});

type Enrolment = { secret: string; qrSvg: string } | null;

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="banner" role="status">
      <p><strong>Save these recovery codes now — they are shown only once.</strong> Each one can sign you in once if you lose your authenticator. Store them somewhere safe (password manager / paper), not on this site.</p>
      <p style={{ fontFamily: "monospace", lineHeight: 1.9 }}>{codes.map((c) => <span key={c} style={{ display: "inline-block", marginRight: "1rem" }}>{c}</span>)}</p>
    </div>
  );
}

function SecurityAdmin() {
  const status = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
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

  const run = async (fn: () => Promise<void>) => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  const startSetup = () =>
    run(async () => {
      if (password !== password2) throw new Error("The two passwords do not match.");
      const r = await adminSecuritySetupStart({ data: { username, password } });
      setEnrolment({ secret: r.secret, qrSvg: r.qrSvg });
      setEnrolFor("setup");
      setMessage("Now scan the QR code with your authenticator app, then enter the 6-digit code it shows.");
    });

  const startReset = () =>
    run(async () => {
      const r = await adminSecurityResetTotpStart({ data: { currentPassword, currentCode } });
      setEnrolment({ secret: r.secret, qrSvg: r.qrSvg });
      setEnrolFor("reset");
      setMessage("Scan the new QR code, then enter the 6-digit code. Your old authenticator entry keeps working until you confirm.");
    });

  const confirmEnrolment = () =>
    run(async () => {
      const r = enrolFor === "setup"
        ? await adminSecuritySetupConfirm({ data: { code: confirmCode } })
        : await adminSecurityResetTotpConfirm({ data: { code: confirmCode } });
      setRecoveryCodes(r.recoveryCodes);
      setEnrolment(null);
      setConfirmCode("");
      setMessage(enrolFor === "setup" ? "Password + 2FA sign-in is now active. The admin token can no longer sign in." : "New authenticator confirmed. Old recovery codes were replaced.");
      await router.invalidate();
    });

  return (
    <>
      <p className="desk-kicker">System</p>
      <h1 className="desk-title">Security</h1>
      <p className="desk-note">
        How you sign in to this admin panel. Articles, automation and the public site are not affected by anything here.
      </p>
      {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}
      {message ? <p className="banner" role="status">{message}</p> : null}
      {recoveryCodes ? <RecoveryCodes codes={recoveryCodes} /> : null}

      <section className="desk-section">
        <h2>Sign-in status</h2>
        {status.active ? (
          <p className="desk-note">
            <strong>Username + password + authenticator (2FA) is active</strong> for <strong>{status.username}</strong>.
            The shared admin token can no longer sign in. Recovery codes remaining: <strong>{status.recoveryRemaining}</strong> of 10.
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
          <h2>Set up password + 2FA sign-in</h2>
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
            <button className="btn" type="submit" disabled={pending}>{pending ? "Preparing…" : "Create credentials & show QR code"}</button>
          </form>
        </section>
      ) : null}

      {enrolment ? (
        <section className="desk-section">
          <h2>{enrolFor === "setup" ? "Scan with your authenticator app" : "Scan the new QR code"}</h2>
          <div style={{ maxWidth: "220px", background: "#fff", padding: "8px" }} dangerouslySetInnerHTML={{ __html: enrolment.qrSvg }} />
          <p className="desk-note">
            No camera? Add it manually — secret: <strong style={{ fontFamily: "monospace" }}>{enrolment.secret}</strong> (account “DYPOL Blog”, time-based).
          </p>
          <form className="stack" style={{ maxWidth: "26rem" }} onSubmit={(e) => { e.preventDefault(); void confirmEnrolment(); }}>
            <label className="field">
              <span>6-digit code from the app</span>
              <input inputMode="numeric" autoComplete="one-time-code" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} required autoFocus />
            </label>
            <button className="btn" type="submit" disabled={pending}>{pending ? "Checking…" : "Confirm code & finish"}</button>
          </form>
        </section>
      ) : null}

      {status.active ? (
        <>
          <section className="desk-section">
            <h2>Change password</h2>
            <form
              className="stack"
              style={{ maxWidth: "26rem" }}
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (newPassword !== newPassword2) throw new Error("The two new passwords do not match.");
                  await adminSecurityChangePassword({ data: { currentPassword, currentCode, newPassword } });
                  setNewPassword(""); setNewPassword2("");
                  setMessage("Password changed. Other signed-in sessions keep working until they expire or you sign them out.");
                });
              }}
            >
              <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></label>
              <label className="field"><span>Current authenticator / recovery code</span><input autoComplete="one-time-code" value={currentCode} onChange={(e) => setCurrentCode(e.target.value)} required /></label>
              <label className="field"><span>New password (at least 12 characters)</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /></label>
              <label className="field"><span>New password again</span><input type="password" autoComplete="new-password" value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)} required /></label>
              <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : "Change password"}</button>
            </form>
          </section>

          <section className="desk-section">
            <h2>Authenticator (2FA)</h2>
            <p className="desk-note">Lost your phone or moving to a new one? Verify yourself, scan a fresh QR code, and the old entry stops working. This also replaces your recovery codes.</p>
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
                void run(async () => {
                  const r = await adminSecurityRegenRecovery({ data: { currentPassword, currentCode } });
                  setRecoveryCodes(r.recoveryCodes);
                  setMessage("New recovery codes generated — the old ones no longer work.");
                  await router.invalidate();
                })
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
