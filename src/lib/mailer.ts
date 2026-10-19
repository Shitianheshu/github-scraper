import nodemailer from "nodemailer";
import {
  ceIntervalMinutes,
  isCeAddress,
  isCeThrottleError,
  sendCeMessage,
} from "./ce";
import { randomInt } from "./drip";
import { prisma } from "./prisma";
import { dueQueuedIds, nextQueuedAt } from "./send-after";
import { getSettings, type AppSettings } from "./settings";

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function hasGas(settings: AppSettings) {
  return Boolean(settings.gasWebAppUrl);
}

function hasSmtp(settings: AppSettings) {
  return Boolean(settings.smtpHost && settings.smtpFrom);
}

async function postJsonFollowingRedirects(url: string, body: unknown) {
  const posted = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });

  let result = posted;
  if (posted.status >= 300 && posted.status < 400) {
    const location = posted.headers.get("location");
    if (!location) {
      throw new Error(`GAS redirect missing Location (${posted.status})`);
    }
    result = await fetch(new URL(location, url), { method: "GET", redirect: "follow" });
  }

  const text = await result.text();
  if (!result.ok) {
    throw new Error(`GAS HTTP ${result.status}: ${text.slice(0, 300)}`);
  }
  return text;
}

async function sendViaGas(
  settings: AppSettings,
  message: { toAddr: string; subject: string; body: string },
) {
  const text = await postJsonFollowingRedirects(settings.gasWebAppUrl, {
    secret: settings.gasSecret.trim(),
    to: message.toAddr,
    subject: message.subject,
    body: message.body,
    replyTo: settings.smtpFrom || undefined,
    name: settings.smtpFrom || undefined,
  });
  let parsed: { ok?: boolean; sent?: boolean; error?: string; service?: string } = {};
  try {
    parsed = JSON.parse(text) as {
      ok?: boolean;
      sent?: boolean;
      error?: string;
      service?: string;
    };
  } catch {
    throw new Error(`GAS returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!parsed.ok || parsed.service) {
    throw new Error(parsed.error || "GAS send failed");
  }
}

async function sendViaSmtp(
  settings: AppSettings,
  message: { toAddr: string; subject: string; body: string; inReplyTo: string | null },
) {
  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: Number(settings.smtpPort || "587"),
    secure: Number(settings.smtpPort) === 465,
    auth:
      settings.smtpUser && settings.smtpPass
        ? { user: settings.smtpUser, pass: settings.smtpPass }
        : undefined,
  });
  const info = await transporter.sendMail({
    from: settings.smtpFrom,
    to: message.toAddr,
    subject: message.subject,
    text: message.body,
    inReplyTo: message.inReplyTo || undefined,
    headers: message.inReplyTo ? { "In-Reply-To": message.inReplyTo } : undefined,
  });
  return typeof info.messageId === "string" ? info.messageId : null;
}

export async function pingGas() {
  const settings = await getSettings();
  if (!settings.gasWebAppUrl) {
    throw new Error("Set the GAS web app URL first");
  }
  if (!settings.gasSecret.trim()) {
    throw new Error("Set the GAS webhook secret first");
  }
  const text = await postJsonFollowingRedirects(settings.gasWebAppUrl, {
    action: "ping",
    secret: settings.gasSecret.trim(),
  });
  let parsed: { ok?: boolean; ping?: boolean; error?: string } = {};
  try {
    parsed = JSON.parse(text) as { ok?: boolean; ping?: boolean; error?: string };
  } catch {
    throw new Error(`GAS returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (parsed.error === "unauthorized") {
    throw new Error(
      "unauthorized: WEBHOOK_SECRET in Apps Script does not match Settings. Paste the same string in both places, then Save and (if you edited Code.gs) deploy a new version.",
    );
  }
  if (parsed.ok === true) {
    return { ok: true, ping: parsed.ping === true };
  }
  throw new Error(parsed.error || "GAS ping failed");
}

export async function dripStatus() {
  const queued = await prisma.message.count({
    where: { direction: "out", status: "queued" },
  });
  const dueIds = await dueQueuedIds(500);
  const next = await nextQueuedAt();
  return {
    queued,
    due: dueIds.length,
    nextAt: next.sendAfter,
    nextSubject: next.subject,
  };
}

export async function processSendQueue(
  limit = 3,
  opts: { respectInterval?: boolean } = {},
) {
  const settings = await getSettings();
  const useGas = hasGas(settings);
  const useSmtp = hasSmtp(settings);
  if (settings.dripPaused === "true" && opts.respectInterval) {
    return { sent: 0, skipped: "paused" as const };
  }

  const cap = Number(settings.dailyCap || "20") || 20;
  const already = await prisma.message.count({
    where: { direction: "out", status: "sent", sentAt: { gte: todayStart() } },
  });
  const remaining = Math.max(0, cap - already);
  if (remaining === 0) return { sent: 0, skipped: "cap" as const };

  const ceGap = ceIntervalMinutes(settings);
  const lastCe = await prisma.message.findFirst({
    where: { direction: "out", status: "sent", toAddr: { startsWith: "ce:" }, sentAt: { not: null } },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  const ceWaitMs = lastCe?.sentAt
    ? lastCe.sentAt.getTime() + ceGap.min * 60_000 - Date.now()
    : 0;
  const ceReady = ceWaitMs <= 0;

  const ids = await dueQueuedIds(Math.min(limit, remaining));
  const queued =
    ids.length === 0
      ? []
      : await prisma.message.findMany({
          where: { id: { in: ids } },
          include: { thread: { include: { user: true } } },
        });
  queued.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const ceQueued = queued.filter((message) => isCeAddress(message.toAddr));
  const mailQueued = queued.filter((message) => !isCeAddress(message.toAddr));

  let intervalBlocked = false;
  if (opts.respectInterval && mailQueued.length > 0) {
    const minMinutes = Math.max(1, Number(settings.dripMinMinutes || "25") || 25);
    const last = await prisma.message.findFirst({
      where: { direction: "out", status: "sent", sentAt: { not: null } },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    });
    if (last?.sentAt && Date.now() - last.sentAt.getTime() < minMinutes * 60_000) {
      intervalBlocked = true;
    }
  }

  const ceWork = ceReady ? ceQueued.slice(0, 1) : [];
  const mailWork = intervalBlocked ? [] : mailQueued;
  const work = [...ceWork, ...mailWork];
  if (work.length === 0) {
    if (!ceReady && ceQueued.length > 0) {
      return {
        sent: 0,
        skipped: "ce-interval" as const,
        waitMinutes: Math.ceil(ceWaitMs / 60_000),
      };
    }
    if (intervalBlocked) return { sent: 0, skipped: "interval" as const };
    return { sent: 0, via: useGas ? "gas" : "smtp" };
  }
  if (!useGas && !useSmtp && ceQueued.length === 0) {
    return { sent: 0, skipped: "mailer" as const };
  }

  let sent = 0;
  const errors: string[] = [];
  let via: string = useGas ? "gas" : useSmtp ? "smtp" : "ce";
  for (const message of work) {
    try {
      let messageId: string | null = null;
      if (isCeAddress(message.toAddr)) {
        const recordId = Number(message.toAddr.slice(3));
        messageId = await sendCeMessage(recordId, message.body);
        via = "ce";
      } else if (useGas) {
        await sendViaGas(settings, message);
      } else if (useSmtp) {
        messageId = await sendViaSmtp(settings, message);
      } else {
        throw new Error("No mailer configured for this recipient");
      }
      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          messageId,
          error: null,
        },
      });
      sent += 1;
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      errors.push(err.slice(0, 180));
      if (isCeAddress(message.toAddr) && isCeThrottleError(err)) {
        const later = new Date(Date.now() + ceGap.max * 60_000);
        await prisma.message.update({
          where: { id: message.id },
          data: { status: "queued", error: err.slice(0, 500) },
        });
        await prisma.$executeRaw`
          UPDATE Message SET sendAfter = ${later.toISOString()} WHERE id = ${message.id}
        `;
      } else {
        await prisma.message.update({
          where: { id: message.id },
          data: { status: "failed", error: err.slice(0, 500) },
        });
      }
    }
  }
  return { sent, failed: errors.length, error: errors[0], via };
}
