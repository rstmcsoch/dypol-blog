import { useEffect, useRef, useState } from "react";
import { getContactConfig } from "@/content/public-api";

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: Record<string, unknown>): string;
      reset(id?: string): void;
      remove(id?: string): void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("turnstile")));
    if (!existing) {
      script.src = SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

type Status = { kind: "idle" | "sending" | "sent" | "error"; message?: string };

/** t115: contact form on /contact — Turnstile-protected, stored in D1, visible success/error states. */
export function ContactForm() {
  const [siteKey, setSiteKey] = useState<string | null | undefined>(undefined);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => {
    getContactConfig()
      .then((c) => setSiteKey(c.siteKey))
      .catch(() => setSiteKey(null));
  }, []);

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile || widget.current) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: siteKey,
          action: "contact",
          callback: (t: string) => setToken(t),
          "expired-callback": () => setToken(""),
          "error-callback": () => setToken(""),
        });
      })
      .catch(() => setStatus({ kind: "error", message: "The verification check could not load. Please disable blockers for this page or try again later." }));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!token) {
      setStatus({ kind: "error", message: "Please complete the verification check first." });
      return;
    }
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: data.get("name"), email: data.get("email"), message: data.get("message"), website: data.get("website"), token }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && body.ok) {
        form.reset();
        setStatus({ kind: "sent", message: "Thanks — your message was sent. We'll reply by email if needed." });
      } else {
        setStatus({ kind: "error", message: body.error || "Your message could not be sent. Please try again." });
      }
    } catch {
      setStatus({ kind: "error", message: "Network error — your message was not sent. Please try again." });
    } finally {
      setToken("");
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
    }
  }

  if (siteKey === null) {
    return (
      <section className="contact-form contact-form--off" aria-labelledby="contact-form-title">
        <h2 id="contact-form-title">Send us a message</h2>
        <p className="contact-form__status is-error" role="status">The contact form is temporarily unavailable. Please try again later.</p>
      </section>
    );
  }

  return (
    <section className="contact-form" aria-labelledby="contact-form-title">
      <h2 id="contact-form-title">Send us a message</h2>
      {status.kind === "sent" ? (
        <p className="contact-form__status is-ok" role="status">{status.message}</p>
      ) : null}
      <form onSubmit={onSubmit} noValidate={false}>
        <label className="contact-form__field">
          <span>Name</span>
          <input name="name" type="text" required maxLength={120} autoComplete="name" />
        </label>
        <label className="contact-form__field">
          <span>Email</span>
          <input name="email" type="email" required maxLength={254} autoComplete="email" />
        </label>
        <label className="contact-form__field">
          <span>Message</span>
          <textarea name="message" required minLength={10} maxLength={5000} rows={6} />
        </label>
        <label className="contact-form__hp" aria-hidden="true">
          Website <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
        <div ref={box} className="contact-form__turnstile" />
        {status.kind === "error" ? (
          <p className="contact-form__status is-error" role="alert">{status.message}</p>
        ) : null}
        <button type="submit" className="btn btn--accent grain" disabled={status.kind === "sending" || siteKey === undefined}>
          {status.kind === "sending" ? "Sending…" : "Send message"}
        </button>
      </form>
    </section>
  );
}
