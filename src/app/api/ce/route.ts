import { NextResponse } from "next/server";
import { loginCe } from "@/lib/ce";
import { startCeImport } from "@/lib/ce-import";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const job = await prisma.importJob.findFirst({
    where: { sourceLogin: "conversationexchange" },
    orderBy: { id: "desc" },
  });
  const users = await prisma.githubUser.count({
    where: { emailStatus: "ce" },
  });
  return NextResponse.json({ job, users });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      query?: string;
      maxPages?: number;
    };
    if (body.action === "login") {
      const result = await loginCe();
      return NextResponse.json({ ok: true, via: result.via });
    }
    const job = await startCeImport({
      query: body.query,
      maxPages: Number(body.maxPages) || 20,
    });
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
