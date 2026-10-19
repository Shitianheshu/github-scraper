"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useUnread } from "./unread-provider";

const items = [
  { href: "/", label: "Inbox", icon: "M" },
  { href: "/people", label: "People", icon: "P" },
  { href: "/import", label: "Import", icon: "I" },
  { href: "/settings", label: "Settings", icon: "S" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { count, toast } = useUnread();

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg-2)]">
        <div className="px-4 py-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
            Relay
          </p>
          <p className="mt-1 text-[15px] font-semibold tracking-tight">GitHub outreach</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {items.map((item) => {
            const on =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-[13px] no-underline ${
                  on
                    ? "bg-[var(--bg-3)] font-medium text-white"
                    : "text-zinc-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span>{item.label}</span>
                {item.href === "/" && count > 0 ? (
                  <span className="badge">{count > 99 ? "99+" : count}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <p className="px-4 py-4 text-[11px] leading-4 text-[var(--muted)]">
          Public GitHub emails only. One thread per person.
        </p>
      </aside>
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
      {toast ? (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-[var(--line)] bg-[var(--bg-3)] px-4 py-3 shadow-xl">
          <p className="text-xs font-medium text-[var(--accent-2)]">New message</p>
          <p className="mt-1 text-sm">{toast}</p>
        </div>
      ) : null}
    </div>
  );
}
