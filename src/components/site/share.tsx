import { useEffect, useState } from "react";

/** Share links built on the client from the real page URL (no tracking scripts). */
export function ShareLinks({ title, path, label, copyLabel, copiedLabel }: { title: string; path: string; label: string; copyLabel: string; copiedLabel: string }) {
  const [url, setUrl] = useState(path);
  const [copied, setCopied] = useState(false);
  useEffect(() => setUrl(new URL(path, window.location.origin).toString()), [path]);
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const links = [
    { name: "X", href: `https://x.com/intent/post?url=${u}&text=${t}` },
    { name: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { name: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { name: "Email", href: `mailto:?subject=${t}&body=${u}` },
  ];
  return (
    <div className="aside-block">
      <h2 className="aside-head">{label}</h2>
      <ul className="share-list">
        {links.map((link) => (
          <li key={link.name}>
            <a href={link.href} target="_blank" rel="noopener noreferrer">
              {link.name}
            </a>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(() => setCopied(true));
            }}
          >
            {copied ? copiedLabel : copyLabel}
          </button>
        </li>
      </ul>
    </div>
  );
}
