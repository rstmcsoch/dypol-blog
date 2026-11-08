/** t217: pure helpers for the admin in-page tab strip (kept out of the component file). */

export function tabPanelProps(idPrefix: string, id: string, active: string) {
  return {
    role: "tabpanel" as const,
    id: `${idPrefix}-panel-${id}`,
    "aria-labelledby": `${idPrefix}-tab-${id}`,
    hidden: id !== active,
    tabIndex: 0,
    className: "stack adm-tabpanel",
  };
}

/** Index of the tab a key moves to, or null for keys the tablist ignores. Wraps at both ends. */
export function tabIndexForKey(key: string, index: number, count: number): number | null {
  const map: Record<string, number> = {
    ArrowRight: index + 1,
    ArrowLeft: index - 1,
    Home: 0,
    End: count - 1,
  };
  if (!(key in map) || count < 1) return null;
  return (map[key]! + count) % count;
}

/** Tab id owning a panel element id (`<prefix>-panel-<id>`), or null. */
export function tabFromPanelId(
  idPrefix: string,
  panelId: string | undefined | null,
): string | null {
  const head = `${idPrefix}-panel-`;
  return panelId && panelId.startsWith(head) && panelId.length > head.length
    ? panelId.slice(head.length)
    : null;
}

/** t217: the only part of the site record the homepage preview renders (sent in memory to the frame). */
export function homeDraftPayload(site: {
  home: unknown;
  trending: unknown;
  labels: unknown;
}): string {
  return JSON.stringify({ home: site.home, trending: site.trending, labels: site.labels });
}
