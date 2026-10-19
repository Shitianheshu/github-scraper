import { NextResponse } from "next/server";
import { inferCountry } from "@/lib/country";
import { prisma } from "@/lib/prisma";

const SEND_FILTERS = new Set(["sent", "queued", "failed"]);

async function latestOutboundByUser() {
  const rows = await prisma.$queryRaw<{ userId: number; status: string; error: string | null }[]>`
    SELECT t.userId as userId, m.status as status, m.error as error
    FROM Message m
    JOIN Thread t ON t.id = m.threadId
    WHERE m.direction = 'out'
      AND m.id IN (
        SELECT MAX(m2.id)
        FROM Message m2
        JOIN Thread t2 ON t2.id = m2.threadId
        WHERE m2.direction = 'out'
        GROUP BY t2.userId
      )
  `;
  const byUser = new Map<number, string>();
  for (const row of rows) {
    let status = row.status;
    if (status === "failed" && row.error?.includes("CE did not store")) status = "sent";
    byUser.set(Number(row.userId), status);
  }
  return byUser;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || "";
  const filter = searchParams.get("filter") || "all";
  const source = searchParams.get("source") || "";

  const outbound = await latestOutboundByUser();
  const sendIds = [...outbound.entries()]
    .filter(([, status]) => status === filter)
    .map(([userId]) => userId);

  const users = await prisma.githubUser.findMany({
    where: {
      AND: [
        q
          ? {
              OR: [
                { login: { contains: q } },
                { name: { contains: q } },
                { publicEmail: { contains: q } },
                { location: { contains: q } },
                { country: { contains: q } },
                { company: { contains: q } },
              ],
            }
          : {},
        filter === "found" ? { emailStatus: "found" } : {},
        filter === "pending" ? { emailStatus: "pending" } : {},
        filter === "none"
          ? { emailStatus: { in: ["none", "noreply"] } }
          : {},
        filter === "ce" ? { emailStatus: "ce" } : {},
        SEND_FILTERS.has(filter)
          ? { id: { in: sendIds.length ? sendIds : [0] } }
          : {},
        source
          ? { relations: { some: { sourceLogin: source } } }
          : {},
      ],
    },
    include: {
      relations: true,
      threads: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: {
          messages: {
            where: { direction: "out" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ emailStatus: "asc" }, { login: "asc" }],
  });

  const stats = {
    total: await prisma.githubUser.count(),
    found: await prisma.githubUser.count({ where: { emailStatus: "found" } }),
    pending: await prisma.githubUser.count({ where: { emailStatus: "pending" } }),
    none: await prisma.githubUser.count({
      where: { emailStatus: { in: ["none", "noreply"] } },
    }),
    ce: await prisma.githubUser.count({ where: { emailStatus: "ce" } }),
    sent: [...outbound.values()].filter((status) => status === "sent").length,
    queued: [...outbound.values()].filter((status) => status === "queued").length,
    failed: [...outbound.values()].filter((status) => status === "failed").length,
  };

  return NextResponse.json({
    users: users.map((user) => {
      const lastOut = user.threads[0]?.messages[0];
      const sendStatus =
        lastOut?.status === "failed" && lastOut.error?.includes("CE did not store")
          ? "sent"
          : lastOut?.status || null;
      return {
        ...user,
        country: user.country || inferCountry(user.location),
        htmlUrl: user.htmlUrl || `https://github.com/${user.login}`,
        sendStatus,
      };
    }),
    stats,
  });
}
