import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { NavHref } from "@/content/types";

const TOPIC_PREFIX = "/topics/";

/**
 * One menu link. Exact matches get aria-current="page" from the router; the
 * header passes `section` when the visitor is somewhere inside this item's
 * section (e.g. a topic page that has no shortcut of its own lights "Topics").
 */
export function NavLink({
  href,
  className,
  children,
  section = false,
  onNavigate,
}: {
  href: NavHref;
  className: string;
  children: ReactNode;
  section?: boolean;
  onNavigate?: () => void;
}) {
  const activeProps = { className: "is-active" };
  const common = {
    className: section ? `${className} is-active` : className,
    activeOptions: { exact: true, includeSearch: false },
    activeProps,
    onClick: onNavigate,
    ...(section ? { "aria-current": "true" as const } : {}),
  };
  if (href.startsWith(TOPIC_PREFIX)) {
    return (
      <Link to="/topics/$slug" params={{ slug: href.slice(TOPIC_PREFIX.length) }} {...common}>
        {children}
      </Link>
    );
  }
  if (href === "/") {
    return (
      <Link to="/" {...common}>
        {children}
      </Link>
    );
  }
  if (href === "/articles") {
    return (
      <Link to="/articles" {...common}>
        {children}
      </Link>
    );
  }
  if (href === "/topics") {
    return (
      <Link to="/topics" {...common}>
        {children}
      </Link>
    );
  }
  return (
    <Link to="/about" {...common}>
      {children}
    </Link>
  );
}
