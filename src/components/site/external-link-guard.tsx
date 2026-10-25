import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { bareHost, isExternalHref } from "@/lib/inline-markdown";
import { CANONICAL_ORIGIN } from "@/lib/seo";
import { useSite } from "./use-site";

/**
 * t106: "You're leaving <site>" confirmation for links to other hosts.
 *
 * One delegated click listener for the public site. "Own" hosts are the host
 * the visitor is on right now (so a future custom domain works with no code
 * change) plus the configured canonical origin; www and non-www are the same
 * site. Own-host absolute links stay in this tab. Progressive: without JS the
 * links are ordinary anchors (external ones open in a new tab).
 */
export function ExternalLinkGuard() {
  const site = useSite();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [target, setTarget] = useState<{ href: string; host: string } | null>(null);

  useEffect(() => {
    const ownHosts = () => [window.location.host, new URL(CANONICAL_ORIGIN).host];
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const el = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!el || el.closest("[data-leave-guard='off']") || el.hasAttribute("download")) return;
      const href = el.href;
      if (!/^https?:/i.test(href)) return;
      if (!isExternalHref(href, ownHosts())) {
        // Own site written as a full URL: keep it in this tab (SPA navigation).
        if (el.target === "_blank" && !el.closest(".site-header, .site-footer")) {
          event.preventDefault();
          const url = new URL(href);
          router.history.push(url.pathname + url.search + url.hash);
        }
        return;
      }
      event.preventDefault();
      returnFocus.current = el;
      setTarget({ href, host: bareHost(new URL(href).host) });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [router]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (target && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!target && dialog.open) dialog.close();
  }, [target]);

  const close = () => {
    setTarget(null);
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back) requestAnimationFrame(() => back.focus());
  };

  // Focus trap: Tab / Shift+Tab cycle inside the dialog.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const items = dialogRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    if (!items?.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="leave-dialog"
      aria-labelledby="leave-dialog-title"
      aria-describedby="leave-dialog-desc"
      data-leave-guard="off"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) close();
      }}
      onKeyDown={onKeyDown}
    >
      {target ? (
        <div className="leave-dialog__panel">
          <p className="leave-dialog__kicker">External link</p>
          <h2 id="leave-dialog-title" className="leave-dialog__title">
            You&rsquo;re leaving {site.name}
          </h2>
          <p id="leave-dialog-desc" className="leave-dialog__text">
            This link goes to <strong>{target.host}</strong>, a site we don&rsquo;t control. It will open in a new tab.
          </p>
          <p className="leave-dialog__url" title={target.href}>
            {target.href}
          </p>
          <div className="leave-dialog__actions">
            <button ref={cancelRef} type="button" className="leave-dialog__btn leave-dialog__btn--ghost" onClick={close}>
              Cancel
            </button>
            <a className="leave-dialog__btn leave-dialog__btn--go grain" href={target.href} target="_blank" rel="noopener noreferrer nofollow" onClick={() => setTimeout(close, 0)}>
              Continue to {target.host}
            </a>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
