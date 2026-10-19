"use client";

import { useEffect, useState, type FormEvent } from "react";

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function Field({
  label,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="lbl">
      <span>{label}</span>
      <input
        type={type}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="field"
      />
    </label>
  );
}

export default function SettingsPage() {
  const [form, setForm] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState("");
  const [testResult, setTestResult] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setForm(data));
  }, []);

  function set(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaved("");
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaved("Saved.");
  }

  return (
    <div className="page">
      <div className="mx-auto max-w-xl">
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">Local only. Secrets stay on this machine.</p>
        <form onSubmit={(e) => void save(e)}>
          <div className="section">
            <h2>GitHub</h2>
            <p className="hint">Classic PAT with public user and repo read.</p>
            <Field
              label="Token"
              type="password"
              value={form.githubToken || ""}
              onChange={(v) => set("githubToken", v)}
            />
          </div>

          <div className="section">
            <h2>Gmail (Apps Script)</h2>
            <p className="hint">
              Same string in this field and Script properties WEBHOOK_SECRET. Deploy as a web app
              (execute as you, anyone can access).
            </p>
            <Field
              label="Web app URL"
              value={form.gasWebAppUrl || ""}
              onChange={(v) => set("gasWebAppUrl", v)}
            />
            <label className="lbl">
              <span>Webhook secret</span>
              <div className="flex gap-2">
                <input
                  value={form.gasSecret || ""}
                  onChange={(e) => set("gasSecret", e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  spellCheck={false}
                  autoComplete="off"
                  className="field font-mono text-[12px]"
                />
                <button
                  type="button"
                  className="btn shrink-0"
                  onClick={async () => {
                    const secret = (form.gasSecret || "").trim();
                    if (!secret) return;
                    await navigator.clipboard.writeText(secret);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  set("gasSecret", randomSecret());
                  setSaved("Generated a secret. Copy it into Apps Script, then Save.");
                }}
              >
                Generate
              </button>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const res = await fetch("/api/mail/test", { method: "POST" });
                  const data = await res.json();
                  setTestResult(data.ok ? "Secret matches." : data.error || "Failed");
                }}
              >
                Test
              </button>
            </div>
            {testResult ? <p className="mt-3 text-[13px] text-zinc-400">{testResult}</p> : null}
          </div>

          <div className="section">
            <h2>From address</h2>
            <p className="hint">Used as reply-to. SMTP is only a fallback if GAS is empty.</p>
            <Field
              label="From / reply-to"
              value={form.smtpFrom || ""}
              onChange={(v) => set("smtpFrom", v)}
            />
            <Field label="SMTP host" value={form.smtpHost || ""} onChange={(v) => set("smtpHost", v)} />
            <Field label="SMTP port" value={form.smtpPort || ""} onChange={(v) => set("smtpPort", v)} />
            <Field label="SMTP user" value={form.smtpUser || ""} onChange={(v) => set("smtpUser", v)} />
            <Field
              label="SMTP password"
              type="password"
              value={form.smtpPass || ""}
              onChange={(v) => set("smtpPass", v)}
            />
          </div>

          <div className="section">
            <h2>Inbound (IMAP)</h2>
            <p className="hint">Needed for reply badges and desktop alerts.</p>
            <Field label="IMAP host" value={form.imapHost || ""} onChange={(v) => set("imapHost", v)} />
            <Field label="IMAP port" value={form.imapPort || ""} onChange={(v) => set("imapPort", v)} />
            <Field label="IMAP user" value={form.imapUser || ""} onChange={(v) => set("imapUser", v)} />
            <Field
              label="IMAP password"
              type="password"
              value={form.imapPass || ""}
              onChange={(v) => set("imapPass", v)}
            />
            <Field label="Daily send cap" value={form.dailyCap || ""} onChange={(v) => set("dailyCap", v)} />
          </div>

          <div className="section">
            <h2>Conversation Exchange</h2>
            <p className="hint">
              CE blocks bursts (“too many messages in a too short period”). Default gap is 3–6 hours,
              one CE send at a time. Throttled messages stay queued, not failed. Cookie login if
              Cloudflare blocks password.
            </p>
            <Field
              label="CE email"
              value={form.ceEmail || ""}
              onChange={(v) => set("ceEmail", v)}
            />
            <Field
              label="CE password"
              type="password"
              value={form.cePassword || ""}
              onChange={(v) => set("cePassword", v)}
            />
            <label className="lbl">
              <span>Cookie header (optional)</span>
              <textarea
                value={form.ceCookie || ""}
                onChange={(e) => set("ceCookie", e.target.value)}
                rows={3}
                className="field font-mono text-[12px]"
              />
            </label>
            <Field
              label="Default CE import pages"
              value={form.ceMaxPages || ""}
              onChange={(v) => set("ceMaxPages", v)}
            />
            <Field
              label="CE min minutes between sends"
              value={form.ceMinMinutes || "180"}
              onChange={(v) => set("ceMinMinutes", v)}
            />
            <Field
              label="CE max minutes between sends"
              value={form.ceMaxMinutes || "360"}
              onChange={(v) => set("ceMaxMinutes", v)}
            />
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const res = await fetch("/api/ce", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "login" }),
                });
                const data = await res.json();
                setTestResult(data.ok ? `CE login ok (${data.via})` : data.error || "Failed");
              }}
            >
              Test CE login
            </button>
          </div>

          <div className="section">
            <h2>Drip (interval send)</h2>
            <p className="hint">
              Random project-consult or friendly templates, shuffled recipients, one send after a random wait between min and max minutes. Pause stops the ticker from sending. Reply STOP still applies.
            </p>
            <Field
              label="Min minutes between sends"
              value={form.dripMinMinutes || ""}
              onChange={(v) => set("dripMinMinutes", v)}
            />
            <Field
              label="Max minutes between sends"
              value={form.dripMaxMinutes || ""}
              onChange={(v) => set("dripMaxMinutes", v)}
            />
            <label className="lbl">
              <span>Paused</span>
              <select
                className="field"
                value={form.dripPaused || "false"}
                onChange={(e) => set("dripPaused", e.target.value)}
              >
                <option value="false">Running</option>
                <option value="true">Paused</option>
              </select>
            </label>
            <label className="lbl">
              <span>Templates (blocks split by ---)</span>
              <textarea
                value={form.dripTemplates || ""}
                onChange={(e) => set("dripTemplates", e.target.value)}
                rows={10}
                className="field font-mono text-[12px]"
                placeholder="[project] Subject\n\nBody\n---\n[friend] Subject\n\nBody"
              />
            </label>
          </div>

          <div className="section">
            <h2>Template</h2>
            <p className="hint">{"{{name}} {{login}} {{github}} {{country}} {{location}} {{company}}"}</p>
            <label className="lbl">
              <span>Body</span>
              <textarea
                value={form.template || ""}
                onChange={(e) => set("template", e.target.value)}
                rows={6}
                className="field"
              />
            </label>
            <label className="lbl">
              <span>Signature</span>
              <textarea
                value={form.signature || ""}
                onChange={(e) => set("signature", e.target.value)}
                rows={4}
                className="field"
              />
            </label>
          </div>

          <button type="submit" className="btn btn-primary">
            Save
          </button>
          {saved ? <span className="ml-3 text-[13px] text-zinc-400">{saved}</span> : null}
        </form>
      </div>
    </div>
  );
}
