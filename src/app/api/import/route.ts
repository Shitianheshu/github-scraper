import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { previewSource, resumeStaleImport, startImport } from "@/lib/import-job";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source")?.trim();
  const wantPreview = searchParams.get("preview") === "1";
  const job = await prisma.importJob.findFirst({ orderBy: { id: "desc" } });
  const stale = await resumeStaleImport();
  let preview = null;
  if (wantPreview && source) {
    try {
      preview = await previewSource(source);
    } catch (error) {
      preview = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  const users = await prisma.githubUser.count();
  return NextResponse.json({ job: stale || job, preview, users });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const job = await startImport({
      sourceLogin: String(body.sourceLogin || ""),
      includeFollowers: Boolean(body.includeFollowers),
      includeFollowing: Boolean(body.includeFollowing),
      expandHops: Boolean(body.expandHops),
      maxUsers: Number(body.maxUsers) || 2500,
    });
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
