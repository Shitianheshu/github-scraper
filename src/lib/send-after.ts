import { prisma } from "./prisma";

export async function setSendAfter(id: number, when: Date) {
  await prisma.$executeRaw`
    UPDATE Message SET sendAfter = ${when.toISOString()} WHERE id = ${id}
  `;
}

export async function setReadAt(id: number, when: Date = new Date()) {
  await prisma.$executeRaw`
    UPDATE Message SET readAt = ${when.toISOString()} WHERE id = ${id}
  `;
}

export async function dueQueuedIds(take: number): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM Message
    WHERE direction = 'out' AND status = 'queued'
      AND (sendAfter IS NULL OR sendAfter <= ${new Date().toISOString()})
    ORDER BY sendAfter ASC, createdAt ASC
    LIMIT ${take}
  `;
  return rows.map((row) => row.id);
}

export async function nextQueuedAt(): Promise<{ sendAfter: string | null; subject: string | null }> {
  const rows = await prisma.$queryRaw<{ sendAfter: string | null; subject: string }[]>`
    SELECT sendAfter, subject FROM Message
    WHERE direction = 'out' AND status = 'queued'
    ORDER BY sendAfter ASC
    LIMIT 1
  `;
  const row = rows[0];
  return { sendAfter: row?.sendAfter ?? null, subject: row?.subject ?? null };
}
