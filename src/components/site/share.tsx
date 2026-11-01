import { useEffect, useState } from "react";
import { CANONICAL_ORIGIN } from "@/lib/seo";
import { ShareIcon } from "./share-icons";
import { DEFAULT_SHARE_BUTTONS, shareHref, shareLabel, type ShareButton } from "@/lib/share-buttons";

/**
 * Share links built from the article's canonical URL (no tracking scripts).
 * t148: the buttons, their order and labels come from Admin → Homepage builder →
 * Article sidebar → Share buttons. Rendered on the server; only "Copy link" and the
 * native "Share…" button need the browser (Share… stays hidden where unsupported).
 */
export function ShareLinks({
  title,
  path,
  label,
  copyLabel,
  copiedLabel,
  buttons = DEFAULT_SHARE_BUTTONS,
}: {
  title: string;
  path: string;
  label: string;
  copyLabel: string;
  copiedLabel: string;
  buttons?: ShareButton[];
}) {
  const url = new URL(path, CANONICAL_ORIGIN).toString();
  const [copied, setCopied] = useState(false);
  const [canNative, setCanNative] = useState(false);
  useEffect(() => setCanNative(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);
  const shown = buttons.filter((b) => b.enabled);
  if (shown.length === 0) return null;
  return (
    <div className="aside-block" data-block="share">
      {label ? <h2 className="aside-head">{label}</h2> : null}
      <ul className="share-list" data-share-count={shown.length}>
        {shown.map((b) => {
          const name = shareLabel(b, copyLabel);
          if (b.kind === "copy") {
            return (
              <li key={b.id}>
                <button type="button" aria-label={copied ? copiedLabel : name} title={name} onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}>
                  <ShareIcon kind="copy" />
                  <span className="share-label">{copied ? copiedLabel : name}</span>
                </button>
              </li>
            );
          }
          if (b.kind === "native") {
            return (
              <li key={b.id} hidden={!canNative}>
                <button type="button" aria-label={name} title={name} onClick={() => void navigator.share?.({ title, url }).catch(() => undefined)}>
                  <ShareIcon kind="native" />
                  <span className="share-label">{name}</span>
                </button>
              </li>
            );
          }
          const href = shareHref(b, url, title);
          if (!href) return null;
          return (
            <li key={b.id}>
              <a href={href} target="_blank" rel="noopener noreferrer" aria-label={name} title={name}>
                <ShareIcon kind={b.kind} />
                <span className="share-label">{name}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
