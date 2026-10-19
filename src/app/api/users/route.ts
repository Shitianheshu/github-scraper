import { NextResponse } from "next/server";
import { inferCountry } from "@/lib/country";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || "";
  const filter = searchParams.get("filter") || "all";
  const source = searchParams.get("source") || "";

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
        source
          ? { relations: { some: { sourceLogin: source } } }
          : {},
      ],
    },
    include: {
      relations: true,
      threads: { orderBy: { updatedAt: "desc" }, take: 1 },
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
  };

  return NextResponse.json({
    users: users.map((user) => ({
      ...user,
      country: user.country || inferCountry(user.location),
      htmlUrl: user.htmlUrl || `https://github.com/${user.login}`,
    })),
    stats,
  });
}
