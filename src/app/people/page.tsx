"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, ProfileCard, type ProfileView } from "@/components/profile-card";
import { inferCountry } from "@/lib/country";

type Relation = { type: string; sourceLogin: string };

type Person = ProfileView & {
  id: number;
  relations: Relation[];
};

function canMail(user: Person) {
  if (user.emailStatus === "ce") return true;
  const email = user.publicEmail || "";
  return user.emailStatus === "found" && Boolean(email) && !email.includes("noreply") && !email.startsWith("ce:");
}

async function readJson<T>(res: Response): Promise<T | null> {
  const raw = await res.text();
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default function PeoplePage() {
  const [users, setUsers] = useState<Person[]>([]);
  const [stats, setStats] = useState({ total: 0, found: 0, pending: 0, none: 0, ce: 0 });
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [dripInfo, setDripInfo] = useState<{
    queued: number;
    nextAt: string | null;
  } | null>(null);
  const headerCheck = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ filter, q });
    const res = await fetch(`/api/users?${params}`);
    const data = await readJson<{ users?: Person[]; stats?: typeof stats }>(res);
    if (!data) return;
    setUsers(data.users || []);
    if (data.stats) setStats(data.stats);
  }, [filter, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDrip = useCallback(async () => {
    const res = await fetch("/api/tick");
    const data = await readJson<{ queued?: number; nextAt?: string | null }>(res);
    if (data) setDripInfo({ queued: data.queued || 0, nextAt: data.nextAt || null });
  }, []);

  useEffect(() => {
    void loadDrip();
    const timer = setInterval(() => void loadDrip(), 20000);
    return () => clearInterval(timer);
  }, [loadDrip]);

  const mailable = useMemo(() => users.filter(canMail), [users]);
  const mailableIds = useMemo(() => mailable.map((user) => user.id), [mailable]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedCount = selected.length;
  const allOn = mailableIds.length > 0 && mailableIds.every((id) => selectedSet.has(id));
  const someOn = mailableIds.some((id) => selectedSet.has(id));

  useEffect(() => {
    if (headerCheck.current) {
      headerCheck.current.indeterminate = someOn && !allOn;
    }
  }, [someOn, allOn]);

  useEffect(() => {
    setConfirmSend(false);
  }, [selectedCount, subject, body]);

  const active = useMemo(
    () => users.find((user) => user.id === activeId) || null,
    [users, activeId],
  );

  function toggle(id: number) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleAll() {
    setSelected(allOn ? [] : mailableIds);
  }

  async function broadcast() {
    if (!confirmSend) {
      setConfirmSend(true);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: selected, subject, body, queue: true }),
      });
      const data = await readJson<{ created?: number; error?: string }>(res);
      if (!res.ok) {
        setMessage(data?.error || "Failed to queue broadcast");
        return;
      }
      const created = data?.created || 0;
      const tick = await fetch("/api/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drain: true, limit: created }),
      });
      const tickData = await readJson<{
        sent?: { sent?: number; skipped?: string; error?: string };
      }>(tick);
      const sent = tickData?.sent?.sent ?? 0;
      const skipped = tickData?.sent?.skipped;
      if (skipped === "mailer") {
        setMessage("Queued, but mailer is not configured. Add GAS in Settings.");
      } else if (skipped === "cap") {
        setMessage(`Queued ${created}. Daily cap reached — remaining stay in the send queue.`);
      } else {
        setMessage(
          `Broadcast queued ${created}. Sent ${sent}${tickData?.sent?.error ? `. ${tickData.sent.error}` : ""}`,
        );
      }
      setSelected([]);
      setConfirmSend(false);
      void loadDrip();
    } finally {
      setBusy(false);
    }
  }

  async function startDrip() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: selected,
          subject,
          body,
          queue: true,
          drip: true,
        }),
      });
      const data = await readJson<{
        created?: number;
        error?: string;
        drip?: { minMinutes: number; maxMinutes: number; until: string };
      }>(res);
      if (!res.ok) {
        setMessage(data?.error || "Failed to start drip");
        return;
      }
      const until = data?.drip?.until
        ? new Date(data.drip.until).toLocaleString()
        : "later";
      const tick = await fetch("/api/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drain: true, limit: 1 }),
      });
      const tickData = await readJson<{ sent?: { sent?: number; error?: string } }>(tick);
      setMessage(
        `Queued ${data?.created || 0}. Sent ${tickData?.sent?.sent ?? 0} now` +
          `${tickData?.sent?.error ? `. ${tickData.sent.error}` : ""}. ` +
          `CE chats go out immediately. GitHub email drip stays ${data?.drip?.minMinutes}–${data?.drip?.maxMinutes} min (until ${until}).`,
      );
      setSelected([]);
      void loadDrip();
    } finally {
      setBusy(false);
    }
  }

  const filters = [
    ["all", stats.total],
    ["found", stats.found],
    ["pending", stats.pending],
    ["none", stats.none],
    ["ce", stats.ce || 0],
  ] as const;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-[var(--line)] px-6 py-4">
          <h1 className="page-title">People</h1>
          <p className="page-sub" style={{ marginBottom: 16 }}>
            {mailable.length} can receive mail in this view · {selectedCount} selected
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {filters.map(([key, n]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`btn h-8 text-[12px] ${filter === key ? "btn-primary" : ""}`}
              >
                {key} {n}
              </button>
            ))}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              className="field ml-auto max-w-xs"
            />
          </div>
        </header>
        <div className="flex items-center gap-3 border-b border-[var(--line)] bg-[var(--bg-2)] px-6 py-2">
          <input
            ref={headerCheck}
            type="checkbox"
            checked={allOn}
            disabled={mailableIds.length === 0}
            onChange={toggleAll}
            aria-label="Select all with a public email"
          />
          <button
            type="button"
            className="text-[12px] text-zinc-300 hover:text-white"
            disabled={mailableIds.length === 0}
            onClick={() => setSelected(mailableIds)}
          >
            Select all with email ({mailableIds.length})
          </button>
          <button
            type="button"
            className="text-[12px] text-[var(--muted)] hover:text-white"
            disabled={selectedCount === 0}
            onClick={() => setSelected([])}
          >
            Clear
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {users.map((user) => {
            const on = activeId === user.id;
            const mail = canMail(user);
            return (
              <div
                key={user.id}
                onClick={() => setActiveId(user.id)}
                className={`flex cursor-pointer items-center gap-3 border-b border-[var(--line)] px-6 py-3 ${
                  on ? "bg-[var(--bg-3)]" : "hover:bg-white/5"
                }`}
              >
                <input
                  type="checkbox"
                  disabled={!mail}
                  checked={selectedSet.has(user.id)}
                  onChange={() => toggle(user.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <Avatar user={user} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    {user.name || user.login}
                  </p>
                  <p className="truncate text-[12px] text-[var(--muted)]">
                    @{user.login}
                    {user.company ? ` · ${user.company}` : ""}
                    {inferCountry(user.location) || user.country
                      ? ` · ${user.country || inferCountry(user.location)}`
                      : ""}
                  </p>
                </div>
                <p className="hidden max-w-[220px] truncate text-[12px] text-[var(--muted)] sm:block">
                  {user.publicEmail || user.emailStatus}
                </p>
              </div>
            );
          })}
        </div>
      </div>
      <aside className="flex w-[320px] shrink-0 flex-col border-l border-[var(--line)] bg-[var(--bg-2)]">
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {active ? (
            <ProfileCard user={active} />
          ) : (
            <p className="text-[13px] text-[var(--muted)]">Select someone to see their profile.</p>
          )}
        </div>
        <div className="border-t border-[var(--line)] p-4">
          <p className="mb-1 text-[13px] font-medium">Broadcast / drip</p>
          <p className="mb-3 text-[12px] text-[var(--muted)]">
            Blank body: drip picks a random project-consult or friendly note per person. Custom body is used as-is (still fills {"{{name}}"}). Daily cap still applies.
          </p>
          {dripInfo && dripInfo.queued > 0 ? (
            <p className="mb-3 text-[12px] text-[var(--accent-2)]">
              {dripInfo.queued} waiting
              {dripInfo.nextAt
                ? ` · next ${new Date(dripInfo.nextAt).toLocaleTimeString()}`
                : ""}
            </p>
          ) : null}
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject (optional)"
            className="field mb-2"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Hi {{name}}, I found {{github}}…"
            rows={5}
            className="field mb-2 resize-none"
          />
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={selectedCount === 0 || busy}
            onClick={() => void startDrip()}
          >
            {busy ? "Queuing…" : `Drip to ${selectedCount || 0} (interval)`}
          </button>
          <button
            type="button"
            className="btn mt-2 w-full"
            disabled={selectedCount === 0 || busy}
            onClick={() => void broadcast()}
          >
            {confirmSend
              ? `Confirm send all now to ${selectedCount}`
              : `Send all now (${selectedCount || 0})`}
          </button>
          {confirmSend && !busy ? (
            <button
              type="button"
              className="btn mt-2 w-full"
              onClick={() => setConfirmSend(false)}
            >
              Cancel
            </button>
          ) : null}
          {message ? <p className="mt-2 text-[12px] text-zinc-400">{message}</p> : null}
        </div>
      </aside>
    </div>
  );
}
