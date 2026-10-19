import { NextResponse } from "next/server";
import { markThreadRead } from "@/lib/unread";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const summary = await markThreadRead(Number(id));
  return NextResponse.json(summary);
}
