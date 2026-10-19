import { NextResponse } from "next/server";
import { ceRecordId, isCeUser } from "@/lib/ce";
import { parseDripTemplates, pickTemplate, randomInt, shuffle } from "@/lib/drip";
import { prisma } from "@/lib/prisma";
import { setReadAt, setSendAfter } from "@/lib/send-after";
import { getSettings, renderTemplate } from "@/lib/settings";
import { getOrCreateThread, mergeDuplicateThreads } from "@/lib/threads";

export async function GET() {
  await mergeDuplicateThreads();
  const threads = await prisma.thread.findMany({
    include: {
      user: true,
      messages: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
  });
  const unreadRows = await prisma.$queryRaw<{ threadId: number; n: number }[]>`
    SELECT threadId, COUNT(*) as n FROM Message
    WHERE direction = 'in' AND readAt IS NULL
    GROUP BY threadId
  `;
  const unreadByThread = new Map(
    unreadRows.map((row) => [Number(row.threadId), Number(row.n)]),
  );
  return NextResponse.json({
    threads: threads.map((thread) => ({
      ...thread,
      unreadCount: unreadByThread.get(thread.id) || 0,
    })),
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const userIds = Array.isArray(body.userIds) ? body.userIds.map(Number) : [];
  const customBody = typeof body.body === "string" ? body.body : "";
  const customSubject = typeof body.subject === "string" ? body.subject : "";
  const queue = Boolean(body.queue);
  const drip = Boolean(body.drip);

  if (userIds.length === 0) {
    return NextResponse.json({ error: "Select at least one user" }, { status: 400 });
  }

  await mergeDuplicateThreads();

  const settings = await getSettings();
  const users = await prisma.githubUser.findMany({
    where: {
      id: { in: userIds },
      OR: [
        {
          emailStatus: "found",
          publicEmail: { not: null },
          NOT: { publicEmail: { contains: "noreply" } },
        },
        { emailStatus: "ce" },
      ],
    },
  });

  const templates = parseDripTemplates(settings.dripTemplates);
  const minMinutes = Math.max(1, Number(settings.dripMinMinutes || "25") || 25);
  const maxMinutes = Math.max(minMinutes, Number(settings.dripMaxMinutes || "80") || 80);
  const ordered = drip ? shuffle(users) : users;

  const created = [];
  let sendAfter = new Date();
  for (const user of ordered) {
    const vars = {
      login: user.login,
      name: user.name || user.login,
      country: user.country || "",
      location: user.location || "",
      company: user.company || "",
      htmlUrl: user.htmlUrl || "",
    };
    const picked = drip ? pickTemplate(templates) : null;
    const subjectSource = customSubject.trim() || picked?.subject || `Hello ${vars.name}`;
    const bodySource = customBody.trim() || picked?.body || settings.template;
    const subject = renderTemplate(subjectSource, vars);
    const text = renderTemplate(bodySource, vars) + settings.signature;

    const ceId = isCeUser(user) ? ceRecordId(user) : null;
    if (drip && !ceId) {
      sendAfter = new Date(sendAfter.getTime() + randomInt(minMinutes, maxMinutes) * 60_000);
    }

    const thread = await getOrCreateThread(user.id, subject);
    const toAddr = ceId ? `ce:${ceId}` : user.publicEmail!;
    const message = await prisma.message.create({
      data: {
        threadId: thread.id,
        direction: "out",
        fromAddr: settings.smtpFrom || "",
        toAddr,
        subject,
        body: text,
        status: queue || drip ? "queued" : "draft",
      },
    });
    await setReadAt(message.id);
    if (drip && !ceId) {
      await setSendAfter(message.id, sendAfter);
    }
    const full = await prisma.thread.findUniqueOrThrow({
      where: { id: thread.id },
      include: { user: true, messages: true },
    });
    created.push(full);
  }

  return NextResponse.json({
    created: created.length,
    threads: created,
    drip: drip
      ? {
          minMinutes,
          maxMinutes,
          until: sendAfter.toISOString(),
        }
      : null,
  });
}
