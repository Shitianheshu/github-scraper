import { prisma } from "./prisma";
import { CE_ID_OFFSET, ceLogin, getCeConversation, listCeInbox } from "./ce";
import { getOrCreateThread } from "./threads";

const globalCe = globalThis as unknown as { lastCeInbox?: number };

function otherId(row: Record<string, unknown>) {
  const raw =
    row.userId ??
    row.senderId ??
    row.sender_id ??
    row.RecordID ??
    row.recipientId ??
    row.idUser;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function textOf(row: Record<string, unknown>) {
  const raw =
    row.lastMsg ??
    row.preview ??
    row.message ??
    row.body ??
    row.msg ??
    row.text ??
    "";
  return String(raw).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function pollCeInbox() {
  const now = Date.now();
  if (globalCe.lastCeInbox && now - globalCe.lastCeInbox < 25_000) {
    return { fetched: 0, skipped: "throttle" as const };
  }
  globalCe.lastCeInbox = now;

  let rows: Array<Record<string, unknown>>;
  try {
    rows = (await listCeInbox()) as Array<Record<string, unknown>>;
  } catch {
    return { fetched: 0, skipped: "login" as const };
  }

  let fetched = 0;
  for (const row of rows) {
    const recordId = otherId(row);
    if (!recordId) continue;
    const login = ceLogin(recordId);
    let user = await prisma.githubUser.findUnique({ where: { login } });
    if (!user) {
      user = await prisma.githubUser.create({
        data: {
          login,
          githubId: CE_ID_OFFSET + recordId,
          name: String(row.firstName || row.name || login),
          htmlUrl: `https://www.conversationexchange.com/members/readConversation.php?lg=en&RecordID=${recordId}`,
          emailStatus: "ce",
          emailSource: "conversationexchange",
          publicEmail: `ce:${recordId}`,
        },
      });
    }
    const thread = await getOrCreateThread(user.id, "Conversation Exchange");
    let body = textOf(row);
    if (!body) {
      const conv = await getCeConversation(recordId);
      const last = conv[0] || conv[conv.length - 1];
      if (last) body = textOf(last);
    }
    if (!body) continue;
    const fingerprint = `ce-in-${recordId}-${body.slice(0, 80)}`;
    const exists = await prisma.message.findFirst({
      where: { threadId: thread.id, messageId: fingerprint },
    });
    if (exists) continue;
    await prisma.message.create({
      data: {
        threadId: thread.id,
        direction: "in",
        fromAddr: `ce:${recordId}`,
        toAddr: "ce:me",
        subject: String(row.subject || "Conversation Exchange"),
        body,
        status: "received",
        messageId: fingerprint,
      },
    });
    await prisma.thread.update({
      where: { id: thread.id },
      data: { status: "open" },
    });
    fetched += 1;
  }
  return { fetched };
}

export function ceIdFromUser(user: {
  login: string;
  githubId: number;
  publicEmail: string | null;
}) {
  return ceRecordId(user);
}
