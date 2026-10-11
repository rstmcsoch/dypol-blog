import { useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { errorText } from "@/components/admin/gate";
import { adminSaveSettings } from "@/content/admin-api";
import type { SiteConfig } from "@/content/types";

/**
 * Shared editor for the site settings record (site_settings 'site'). Each admin
 * page edits its own part of the same record and saves the whole record.
 */
export function useSiteForm(initial: SiteConfig) {
  const router = useRouter();
  const [site, setSite] = useState<SiteConfig>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const patch = (next: Partial<SiteConfig>) => setSite((current) => ({ ...current, ...next }));
  const save = async (success = "Saved. The public site now uses these settings.") => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await adminSaveSettings({ data: site });
      setMessage(success);
      await router.invalidate();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  };
  return { site, setSite, patch, save, pending, error, message };
}

export function FormShell({
  kicker,
  title,
  intro,
  form,
  children,
  saveLabel = "Save changes",
}: {
  kicker: string;
  title: string;
  intro?: ReactNode;
  form: ReturnType<typeof useSiteForm>;
  children: ReactNode;
  saveLabel?: string;
}) {
  return (
    <>
      <p className="desk-kicker">{kicker}</p>
      <h1 className="desk-title">{title}</h1>
      {intro ? <p className="desk-note">{intro}</p> : null}
      <form
        className="stack"
        style={{ marginTop: "1.25rem" }}
        onSubmit={(event) => {
          event.preventDefault();
          void form.save();
        }}
      >
        {children}
        <div className="inline-actions adm-savebar">
          <button className="btn" type="submit" disabled={form.pending}>
            {form.pending ? "Saving…" : saveLabel}
          </button>
          {form.error ? (
            <p className="banner banner--bad" role="alert" style={{ margin: 0 }}>
              {form.error}
            </p>
          ) : null}
          {form.message ? (
            <p className="banner banner--ok" role="status" style={{ margin: 0 }}>
              {form.message}
            </p>
          ) : null}
        </div>
      </form>
    </>
  );
}

export function move<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}
