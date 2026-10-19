"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, ProfileCard, type ProfileView } from "@/components/profile-card";
import { useUnread } from "@/components/unread-provider";

type User = ProfileView & { id: number };

type Message = {
  id: number;
  direction: string;
  body: string;
  status: string;
  createdAt: string;
};

type Thread = {
  id: number;
  subject: string;
  user: User;
  messages: Message[];
  unreadCount: number;
};

export default function InboxPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [showProfile, setShowProfile] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const { refresh } = useUnread();

  const load = useCallback(async () => {
    const res = await fetch("/api/threads");
    const raw = await res.text();
    if (!raw.trim()) return;
    try {
      const data = JSON.parse(raw) as { threads?: Thread[] };
      setThreads(data.threads || []);
    } catch {
      /* ignore empty/invalid payload */
    }
  }, []);

  useEffect(() => {
    void load();
    const onInbound = () => void load();
    window.addEventListener("outreach:inbound", onInbound);
    const timer = setInterval(() => void load(), 15000);
    return () => {
      window.removeEventListener("outreach:inbound", onInbound);
      clearInterval(timer);
    };
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((thread) => {
      const hay = `${thread.user.name} ${thread.user.login} ${thread.user.publicEmail}`.toLowerCase();
      return hay.includes(q);
    });
  }, [threads, query]);

  const active = useMemo(
    () => threads.find((t) => t.id === activeId) || filtered[0] || null,
    [threads, filtered, activeId],
  );

  useEffect(() => {
    if (activeId == null) return;
    const thread = threads.find((t) => t.id === activeId);
    if (!thread || thread.unreadCount === 0) return;
    void fetch(`/api/threads/${activeId}/read`, { method: "POST" }).then(() => {
      void refresh();
      void load();
    });
  }, [activeId, threads, load, refresh]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [active?.id, active?.messages.length]);

  async function sendReply(queue: boolean) {
    if (!active || !reply.trim()) return;
    setError("");
    const res = await fetch(`/api/threads/${active.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: reply, queue }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to send");
      return;
    }
    setReply("");
    if (queue && !active.user.login.startsWith("ce-")) {
      await fetch("/api/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drain: true, limit: 1 }),
      });
    }
    await load();
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg-2)]">
        <div className="border-b border-[var(--line)] p-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            className="field"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-[13px] text-[var(--muted)]">
              No conversations. Import people, then send from People.
            </p>
          ) : (
            filtered.map((thread) => {
              const last = thread.messages.at(-1);
              const unread = thread.unreadCount || 0;
              const on = active?.id === thread.id;
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setActiveId(thread.id)}
                  className={`flex w-full items-start gap-3 px-3 py-3 text-left ${
                    on ? "bg-[var(--bg-3)]" : "hover:bg-white/5"
                  }`}
                >
                  <Avatar user={thread.user} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-[13px] ${unread ? "font-semibold" : ""}`}>
                        {thread.user.name || thread.user.login}
                      </span>
                      {unread > 0 ? <span className="badge">{unread}</span> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-[var(--muted)]">
                      {last?.body?.replace(/\s+/g, " ") || "No messages"}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-[var(--bg)]">
        {active ? (
          <>
            <header className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-[15px] font-semibold">
                  {active.user.name || active.user.login}
                </h2>
                <p className="truncate text-[12px] text-[var(--muted)]">
                  {active.user.publicEmail || "No public email"} · @{active.user.login}
                </p>
              </div>
              <button type="button" className="btn" onClick={() => setShowProfile((v) => !v)}>
                {showProfile ? "Hide profile" : "Profile"}
              </button>
            </header>
            <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5">
              {active.messages.map((message) => (
                <article
                  key={message.id}
                  className={`max-w-[640px] rounded-2xl px-4 py-2.5 text-[13px] leading-6 ${
                    message.direction === "out"
                      ? "ml-auto bg-[#1e3a8a] text-white"
                      : "bg-[var(--bg-3)]"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.body}</p>
                  <p
                    className={`mt-1 text-[11px] ${
                      message.direction === "out" ? "text-blue-200" : "text-[var(--muted)]"
                    }`}
                  >
                    {message.status} · {new Date(message.createdAt).toLocaleString()}
                  </p>
                </article>
              ))}
            </div>
            <footer className="border-t border-[var(--line)] p-3">
              {error ? <p className="mb-2 text-[13px] text-red-400">{error}</p> : null}
              <div className="flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={2}
                  placeholder="Reply…"
                  className="field min-h-[44px] resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void sendReply(true);
                    }
                  }}
                />
                <button type="button" className="btn" onClick={() => void sendReply(false)}>
                  Draft
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void sendReply(true)}>
                  Send
                </button>
              </div>
              <p className="mt-2 text-[11px] text-[var(--muted)]">Ctrl/⌘ + Enter to send</p>
            </footer>
          </>
        ) : (
          <div className="grid h-full place-items-center text-[13px] text-[var(--muted)]">
            Select a conversation
          </div>
        )}
      </section>

      {active && showProfile ? (
        <aside className="w-[280px] shrink-0 overflow-y-auto border-l border-[var(--line)] bg-[var(--bg-2)] p-5">
          <ProfileCard user={active.user} />
        </aside>
      ) : null}
    </div>
  );
}
