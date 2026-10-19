"use client";

import { useEffect, useState, type FormEvent } from "react";

type Job = {
  id: number;
  sourceLogin: string;
  status: string;
  phase: string | null;
  processed: number;
  total: number;
  emailsFound: number;
  error: string | null;
};

type Preview = {
  login?: string;
  followers?: number;
  following?: number;
  error?: string;
};

export default function ImportPage() {
  const [sourceLogin, setSourceLogin] = useState("MadsLorentzen");
  const [includeFollowers, setIncludeFollowers] = useState(true);
  const [includeFollowing, setIncludeFollowing] = useState(true);
  const [expandHops, setExpandHops] = useState(false);
  const [maxUsers, setMaxUsers] = useState("2500");
  const [job, setJob] = useState<Job | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [users, setUsers] = useState(0);
  const [error, setError] = useState("");
  const [ceJob, setCeJob] = useState<Job | null>(null);
  const [ceUsers, setCeUsers] = useState(0);
  const [ceQuery, setCeQuery] = useState("lg=en&Sort=login");
  const [cePages, setCePages] = useState("20");
  const [ceError, setCeError] = useState("");

  async function refresh(withPreview = false) {
    const params = new URLSearchParams();
    if (withPreview) {
      params.set("source", sourceLogin);
      params.set("preview", "1");
    }
    const res = await fetch(`/api/import?${params}`);
    const data = await res.json();
    if (data.job?.sourceLogin !== "conversationexchange") setJob(data.job);
    setUsers(data.users || 0);
    if (data.preview && !data.preview.error) setPreview(data.preview);
    const ce = await fetch("/api/ce");
    const ceData = await ce.json();
    setCeJob(ceData.job);
    setCeUsers(ceData.users || 0);
  }

  useEffect(() => {
    void refresh(true);
    const timer = setInterval(() => void refresh(false), 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceLogin,
        includeFollowers,
        includeFollowing,
        expandHops,
        maxUsers: Number(maxUsers) || 2500,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Import failed to start");
      return;
    }
    setJob(data.job);
  }

  const running = job?.status === "running" || job?.status === "queued";
  const incomplete =
    job &&
    (job.status === "running" || job.status === "queued") &&
    job.total > job.processed;
  const pct = job && job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;
  const expected =
    (preview?.followers || 0) + (preview?.following || 0);

  return (
    <div className="page">
      <div className="mx-auto max-w-lg">
        <h1 className="page-title">Import</h1>
        <p className="page-sub">
          {users} people in the local list. GitHub itself is not the limit — a previous job listed{" "}
          {job?.total || expected || "—"} and stopped before finishing.
        </p>
        <form onSubmit={(e) => void start(e)} className="section">
          <h2>Source account</h2>
          <p className="hint">
            {preview
              ? `@${preview.login} has ${preview.followers} followers and ${preview.following} following on GitHub.`
              : "Use a username, not a URL."}
          </p>
          <label className="lbl">
            <span>GitHub username</span>
            <input
              value={sourceLogin}
              onChange={(e) => setSourceLogin(e.target.value)}
              className="field"
            />
          </label>
          <label className="mb-3 flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={includeFollowers}
              onChange={(e) => setIncludeFollowers(e.target.checked)}
            />
            Followers
          </label>
          <label className="mb-3 flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={includeFollowing}
              onChange={(e) => setIncludeFollowing(e.target.checked)}
            />
            Following
          </label>
          <label className="mb-3 flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={expandHops}
              onChange={(e) => setExpandHops(e.target.checked)}
            />
            2nd hop (also crawl their followers/following, up to max)
          </label>
          <label className="lbl">
            <span>Max people this job</span>
            <input
              value={maxUsers}
              onChange={(e) => setMaxUsers(e.target.value)}
              className="field"
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={running && !incomplete}>
            {running ? "Importing…" : incomplete ? "Resume import" : "Start import"}
          </button>
          {error ? <p className="mt-3 text-[13px] text-red-400">{error}</p> : null}
        </form>
        {job ? (
          <div className="section">
            <h2>Latest job</h2>
            <p className="hint">
              @{job.sourceLogin} · {job.status}
              {job.phase ? ` · ${job.phase}` : ""}
            </p>
            <div className="mb-2 flex items-baseline justify-between text-[13px]">
              <span>
                {job.processed} / {job.total || "—"} profiles
              </span>
              <span className="text-[var(--muted)]">{job.emailsFound} emails</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-3)]">
              <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
            </div>
            {job.error ? <p className="mt-3 text-[13px] text-red-400">{job.error}</p> : null}
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setCeError("");
            void fetch("/api/ce", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                query: ceQuery,
                maxPages: Number(cePages) || 20,
              }),
            })
              .then((res) => res.json().then((data) => ({ res, data })))
              .then(({ res, data }) => {
                if (!res.ok) setCeError(data.error || "CE import failed");
                else setCeJob(data.job);
              });
          }}
          className="section"
        >
          <h2>Conversation Exchange</h2>
          <p className="hint">
            Search listing is public JSON (no login). {ceUsers} CE people in People. Chat on that
            site needs login in Settings. Max listed by CE is about 1000 (15 per page).
          </p>
          <label className="lbl">
            <span>Query string</span>
            <input
              value={ceQuery}
              onChange={(e) => setCeQuery(e.target.value)}
              className="field"
            />
          </label>
          <label className="lbl">
            <span>Pages (15 people each)</span>
            <input
              value={cePages}
              onChange={(e) => setCePages(e.target.value)}
              className="field"
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={ceJob?.status === "running" || ceJob?.status === "queued"}
          >
            {ceJob?.status === "running" ? "Importing CE…" : "Import CE search"}
          </button>
          {ceError ? <p className="mt-3 text-[13px] text-red-400">{ceError}</p> : null}
          {ceJob ? (
            <p className="mt-3 text-[13px] text-zinc-400">
              {ceJob.status} · {ceJob.phase} · {ceJob.processed}/{ceJob.total || "—"}
              {ceJob.error ? ` · ${ceJob.error}` : ""}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
