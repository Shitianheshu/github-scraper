import { ImapFlow } from "imapflow";
import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { getOrCreateThread } from "./threads";

const globalImap = globalThis as unknown as { lastImap?: number };

export async function pollInbound() {
  const settings = await getSettings();
  if (!settings.imapHost || !settings.imapUser || !settings.imapPass) {
    return { fetched: 0, skipped: "imap" };
  }

  const now = Date.now();
  if (globalImap.lastImap && now - globalImap.lastImap < 20_000) {
    return { fetched: 0, skipped: "throttle" };
  }
  globalImap.lastImap = now;

  const client = new ImapFlow({
    host: settings.imapHost,
    port: Number(settings.imapPort || "993"),
    secure: Number(settings.imapPort || "993") === 993,
    auth: { user: settings.imapUser, pass: settings.imapPass },
    logger: false,
  });

  let fetched = 0;
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    const lock = await client.getMailboxLock("INBOX");
    try {
      const unseen = client.fetch({ seen: false }, { envelope: true, source: true });
      for await (const msg of unseen) {
        const fromAddr = msg.envelope?.from?.[0]?.address?.toLowerCase();
        const subject = msg.envelope?.subject || "(no subject)";
        const inReplyTo = Array.isArray(msg.envelope?.inReplyTo)
          ? msg.envelope?.inReplyTo[0]
          : msg.envelope?.inReplyTo;
        const messageId = msg.envelope?.messageId;
        if (!fromAddr) continue;

        const user = await prisma.githubUser.findFirst({
          where: { publicEmail: fromAddr },
        });
        if (!user) continue;

        const thread = await getOrCreateThread(user.id, subject);

        const exists = messageId
          ? await prisma.message.findFirst({ where: { messageId } })
          : null;
        if (exists) continue;

        const body = msg.source ? msg.source.toString("utf8").slice(0, 20_000) : "";
        await prisma.message.create({
          data: {
            threadId: thread.id,
            direction: "in",
            fromAddr,
            toAddr: settings.smtpFrom || settings.imapUser,
            subject,
            body,
            status: "received",
            messageId: messageId || null,
            inReplyTo: inReplyTo || null,
          },
        });
        await prisma.thread.update({
          where: { id: thread.id },
          data: { status: "open" },
        });
        fetched += 1;
        await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
  return { fetched };
}
