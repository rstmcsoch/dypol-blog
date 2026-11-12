import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * t220: after the first paint, replay a short CSS enter on public pathname changes.
 * SSR and hydration render the same unmarked wrapper. Hash-only changes are ignored
 * so TOC / Back to top smooth scrolling is untouched.
 */
export function RouteMotion({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const armed = useRef(false);
  const [nav, setNav] = useState(0);
  useEffect(() => {
    if (!armed.current) {
      armed.current = true;
      return;
    }
    setNav((n) => n + 1);
  }, [pathname]);
  return (
    <div className="route-motion" data-nav={nav || undefined}>
      {children}
    </div>
  );
}
