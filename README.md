# GitHub outreach inbox

Local CRM for GitHub **followers / following**. It uses the **official GitHub REST API** (not HTML scraping). For each user it keeps going through public sources until it finds a real email or those sources run out:

1. `GET /users/{username}` public `email`
2. `GET /users/{username}/events/public` commit author emails
3. Recent owner repos → `listCommits?author=` author/committer emails

`@users.noreply.github.com` addresses are **not** treated as contactable. Many people hide email on purpose; coverage will not be 100%.

Do not use this to send unsolicited bulk mail. Queue sends, keep a daily cap, and include an opt-out line.

## Setup

1. Copy `.env.example` to `.env` and set `GITHUB_TOKEN` (classic PAT with public user/repo read), or paste the token in **Settings**.
2. Install and create the SQLite database:

```bash
npm install
npx prisma db push
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) → **Import** a source username (followers and/or following) → **People** → queue messages → **Inbox** for threads.

## Sending mail (Google Apps Script)

Queueing from People does **not** send until a mailer is configured. SMTP is optional fallback. Recommended path is Gmail via Apps Script:

1. Create a project at [script.google.com](https://script.google.com), paste [`gas/Code.gs`](gas/Code.gs).
2. Project Settings → Script properties → `WEBHOOK_SECRET` = a long random string.
3. Deploy → New deployment → Web app. Execute as **Me**. Who has access: **Anyone**.
4. Put the `/exec` URL and the same secret in **Settings** (`GAS web app URL` / `GAS webhook secret`) or in `.env` as `GAS_WEBAPP_URL` and `GAS_SECRET`.
5. Optional: set **From / reply-to** so replies land in your inbox.

People → Queue selected flushes the send queue immediately. Messages stay at `queued`/`failed` in Inbox if GAS is missing or rejects the call.

Inbound IMAP matching is unchanged if you configure IMAP.
