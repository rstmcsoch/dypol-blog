import { useEffect } from "react";

/**
 * Loads the Kit newsletter form on public pages.
 *
 * The script is added only once and intentionally remains loaded across
 * client-side navigation so Kit's modal timing/scroll triggers keep working.
 */
export function KitNewsletterEmbed() {
  useEffect(() => {
    const uid = "499fbcce8b";
    if (document.querySelector(`script[data-uid="${uid}"]`)) return;

    const script = document.createElement("script");
    script.async = true;
    script.dataset.uid = uid;
    script.src = "https://dypol-labs.kit.com/499fbcce8b/index.js";
    document.body.appendChild(script);
  }, []);

  return null;
}
