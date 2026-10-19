"use client";

import { useEffect } from "react";

export function TickRunner() {
  useEffect(() => {
    const run = async () => {
      const res = await fetch("/api/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drain: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.inbound?.fetched > 0 || data?.ceInbox?.fetched > 0) {
        window.dispatchEvent(new CustomEvent("outreach:inbound", { detail: data }));
      }
    };
    void run();
    const timer = setInterval(() => void run(), 15000);
    return () => clearInterval(timer);
  }, []);
  return null;
}
