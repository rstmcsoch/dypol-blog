import { useRef, type KeyboardEvent } from "react";
import { tabIndexForKey } from "@/lib/admin-tabs";

export type SettingsTab = { id: string; label: string };

/**
 * t217: horizontal tab strip for one admin page's own sections (WAI-ARIA tabs, manual focus +
 * automatic activation). Panels stay mounted and are only `hidden`, so unsaved values in other tabs
 * are kept and still saved with the one shared record.
 */
export function SettingsTabs({
  tabs,
  active,
  onChange,
  label,
  idPrefix,
}: {
  tabs: SettingsTab[];
  active: string;
  onChange: (id: string) => void;
  label: string;
  idPrefix: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const go = (next: number) => {
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  };
  const onKey = (event: KeyboardEvent, index: number) => {
    const next = tabIndexForKey(event.key, index, tabs.length);
    if (next === null) return;
    event.preventDefault();
    go(next);
  };
  return (
    <div className="adm-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, i) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="adm-tabs__tab"
            onClick={(e) => {
              onChange(tab.id);
              e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
            }}
            onKeyDown={(e) => onKey(e, i)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
