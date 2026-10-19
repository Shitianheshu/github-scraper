import { prisma } from "./prisma";

export async function unreadSummary() {
  try {
    const unreadIds = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM Message
      WHERE direction = 'in' AND readAt IS NULL
      ORDER BY createdAt DESC
    `;
    const ids = unreadIds.map((row) => row.id);
    const unread =
      ids.length === 0
        ? []
        : await prisma.message.findMany({
            where: { id: { in: ids } },
            include: { thread: { include: { user: true } } },
            orderBy: { createdAt: "desc" },
          });
    const byThread = new Map<number, number>();
    for (const message of unread) {
      byThread.set(message.threadId, (byThread.get(message.threadId) || 0) + 1);
    }
    const latest = unread[0];
    return {
      count: unread.length,
      latest: latest
        ? {
            threadId: latest.threadId,
            from: latest.thread.user.name || latest.thread.user.login,
            login: latest.thread.user.login,
            preview: latest.body.slice(0, 120),
          }
        : null,
      byThread: Object.fromEntries(byThread),
    };
  } catch (error) {
    console.error("unreadSummary failed", error);
    return { count: 0, latest: null, byThread: {} };
  }
}

export async function markThreadRead(threadId: number) {
  try {
    await prisma.$executeRaw`
      UPDATE Message SET readAt = ${new Date().toISOString()}
      WHERE threadId = ${threadId} AND direction = 'in' AND readAt IS NULL
    `;
  } catch (error) {
    console.error("markThreadRead failed", error);
  }
  return unreadSummary();
}
