"use client";

import Link from "next/link";
import { useUnread } from "./unread-provider";

const links = [
  { href: "/", label: "Inbox" },
  { href: "/people", label: "People" },
  { href: "/import", label: "Import" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ current }: { current: string }) {
  const { count } = useUnread();

  return (
    <header className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)] text-sm font-bold text-[var(--accent-ink)]">
          G
        </span>
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
            Outreach
          </p>
          <h1 className="text-base font-semibold tracking-tight">GitHub inbox</h1>
        </div>
      </div>
      <nav className="flex gap-1">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`relative rounded-full px-3.5 py-1.5 text-sm ${
              current === link.href
                ? "bg-[var(--foreground)] text-[#161513]"
                : "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)]"
            }`}
          >
            {link.label}
            {link.href === "/" && count > 0 ? (
              <span className="badge absolute -right-1 -top-1">{count > 99 ? "99+" : count}</span>
            ) : null}
          </Link>
        ))}
      </nav>
    </header>
  );
}
