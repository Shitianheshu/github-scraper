import { prisma } from "./prisma";

export async function mergeDuplicateThreads() {
  const threads = await prisma.thread.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true },
  });
  const byUser = new Map<number, number[]>();
  for (const thread of threads) {
    const ids = byUser.get(thread.userId) ?? [];
    ids.push(thread.id);
    byUser.set(thread.userId, ids);
  }

  for (const ids of byUser.values()) {
    if (ids.length < 2) continue;
    const [keepId, ...extras] = ids;
    await prisma.message.updateMany({
      where: { threadId: { in: extras } },
      data: { threadId: keepId },
    });
    await prisma.thread.deleteMany({ where: { id: { in: extras } } });
    await prisma.thread.update({
      where: { id: keepId },
      data: { status: "open" },
    });
  }
}

export async function getOrCreateThread(userId: number, subject: string) {
  const existing = await prisma.thread.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return prisma.thread.update({
      where: { id: existing.id },
      data: { status: "open" },
    });
  }
  return prisma.thread.create({
    data: { userId, subject, status: "open" },
  });
}
