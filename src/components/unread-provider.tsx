"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type UnreadState = {
  count: number;
  refresh: () => Promise<void>;
  toast: string | null;
};

const UnreadContext = createContext<UnreadState>({
  count: 0,
  refresh: async () => undefined,
  toast: null,
});

export function useUnread() {
  return useContext(UnreadContext);
}

function notify(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body, silent: false });
  }
}

export function UnreadProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const known = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/unread");
    const raw = await res.text();
    if (!raw.trim()) return;
    let data: { count?: number; latest?: { from?: string } } = {};
    try {
      data = JSON.parse(raw) as { count?: number; latest?: { from?: string } };
    } catch {
      return;
    }
    const next = Number(data.count || 0);
    if (known.current !== null && next > known.current) {
      const from = data.latest?.from || "someone";
      const msg = `${next - known.current} new message${next - known.current === 1 ? "" : "s"} from ${from}`;
      setToast(msg);
      notify("New outreach reply", msg);
      setTimeout(() => setToast(null), 6000);
    }
    known.current = next;
    setCount(next);
    document.title = next > 0 ? `(${next}) Outreach inbox` : "Outreach inbox";
  }, []);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
    void refresh();
    const onInbound = () => void refresh();
    window.addEventListener("outreach:inbound", onInbound);
    const timer = setInterval(() => void refresh(), 12000);
    return () => {
      window.removeEventListener("outreach:inbound", onInbound);
      clearInterval(timer);
    };
  }, [refresh]);

  const value = useMemo(() => ({ count, refresh, toast }), [count, refresh, toast]);

  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}
