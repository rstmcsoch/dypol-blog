import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { NavHref } from "@/content/types";

export function NavLink({
  href,
  className,
  children,
}: {
  href: NavHref;
  className: string;
  children: ReactNode;
}) {
  const activeProps = { className: "is-active" };
  if (href === "/") {
    return (
      <Link to="/" className={className} activeOptions={{ exact: true }} activeProps={activeProps}>
        {children}
      </Link>
    );
  }
  if (href === "/articles") {
    return (
      <Link to="/articles" className={className} activeOptions={{ exact: false }} activeProps={activeProps}>
        {children}
      </Link>
    );
  }
  if (href === "/topics") {
    return (
      <Link to="/topics" className={className} activeOptions={{ exact: false }} activeProps={activeProps}>
        {children}
      </Link>
    );
  }
  return (
    <Link to="/about" className={className} activeProps={activeProps}>
      {children}
    </Link>
  );
}
