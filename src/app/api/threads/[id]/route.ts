import { NextResponse } from "next/server";
import {
  ceIntervalMinutes,
  ceRecordId,
  isCeThrottleError,
  isCeUser,
  sendCeMessage,
} from "@/lib/ce";
import { randomInt } from "@/lib/drip";
import { prisma } from "@/lib/prisma";
import { setReadAt, setSendAfter } from "@/lib/send-after";
import { getSettings } from "@/lib/settings";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const thread = await prisma.thread.findUnique({
    where: { id: Number(id) },
    include: { user: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ thread });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const text = String(body.body || "");
  const queue = Boolean(body.queue);
  if (!text.trim()) {
    return NextResponse.json({ error: "Message body required" }, { status: 400 });
  }

  const thread = await prisma.thread.findUnique({
    where: { id: Number(id) },
    include: { user: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const ceId = thread ? ceRecordId(thread.user) : null;
  if (!thread || (!thread.user.publicEmail && !isCeUser(thread.user))) {
    return NextResponse.json({ error: "Thread has no public email" }, { status: 400 });
  }

  const settings = await getSettings();
  const lastIn = thread.messages.find((m) => m.direction === "in");
  const toAddr = ceId ? `ce:${ceId}` : thread.user.publicEmail!;
  let status = queue ? "queued" : "draft";
  let error: string | null = null;
  let messageId: string | null = null;
  let sentAt: Date | null = null;

  let sendAfter: Date | null = null;
  if (queue && ceId) {
    const gap = ceIntervalMinutes(settings);
    const lastCe = await prisma.message.findFirst({
      where: {
        direction: "out",
        status: "sent",
        toAddr: { startsWith: "ce:" },
        sentAt: { not: null },
      },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    });
    const waitMs = lastCe?.sentAt
      ? lastCe.sentAt.getTime() + gap.min * 60_000 - Date.now()
      : 0;
    if (waitMs > 0) {
      status = "queued";
      sendAfter = new Date(Date.now() + waitMs + randomInt(0, 30) * 60_000);
      error = `CE rate limit: waiting ~${Math.ceil(waitMs / 60_000)} min`;
    } else {
      try {
        messageId = await sendCeMessage(ceId, text);
        status = "sent";
        sentAt = new Date();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isCeThrottleError(msg)) {
          status = "queued";
          sendAfter = new Date(Date.now() + gap.max * 60_000);
          error = msg;
        } else {
          status = "failed";
          error = msg;
        }
      }
    }
  }

  const message = await prisma.message.create({
    data: {
      threadId: thread.id,
      direction: "out",
      fromAddr: settings.smtpFrom || "",
      toAddr,
      subject: thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`,
      body: text,
      status,
      error,
      messageId,
      sentAt,
      inReplyTo: lastIn?.messageId || null,
    },
  });
  await setReadAt(message.id);
  if (sendAfter) await setSendAfter(message.id, sendAfter);
  await prisma.thread.update({
    where: { id: thread.id },
    data: { status: "open" },
  });
  if (status === "failed") {
    return NextResponse.json({ error: error || "CE send failed", message }, { status: 400 });
  }
  return NextResponse.json({ message, queuedUntil: sendAfter?.toISOString() || null });
}
