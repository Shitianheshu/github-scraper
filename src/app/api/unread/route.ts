import { NextResponse } from "next/server";
import { unreadSummary } from "@/lib/unread";

export async function GET() {
  try {
    return NextResponse.json(await unreadSummary());
  } catch (error) {
    const message = error instanceof Error ? error.message : "unread failed";
    return NextResponse.json({ count: 0, latest: null, error: message }, { status: 200 });
  }
}
