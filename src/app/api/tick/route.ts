import { NextResponse } from "next/server";
import { pollCeInbox } from "@/lib/ce-inbox";
import { dripStatus, processSendQueue } from "@/lib/mailer";
import { pollInbound } from "@/lib/imap";
import { unreadSummary } from "@/lib/unread";

export async function GET() {
  return NextResponse.json(await dripStatus());
}

export async function POST(request: Request) {
  let drain = false;
  let limit = 1;
  try {
    const body = (await request.json()) as { drain?: boolean; limit?: number };
    drain = Boolean(body.drain);
    const asked = Number(body.limit);
    limit = drain
      ? Math.min(Math.max(Number.isFinite(asked) ? asked : 50, 1), 200)
      : 1;
  } catch {
    drain = false;
    limit = 1;
  }
  const sent = await processSendQueue(limit, { respectInterval: !drain });
  const inbound = await pollInbound();
  const ceInbox = await pollCeInbox();
  const unread = await unreadSummary();
  const drip = await dripStatus();
  return NextResponse.json({ sent, inbound, ceInbox, unread, drip });
}
