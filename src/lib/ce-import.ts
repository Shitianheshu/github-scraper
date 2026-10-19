import { prisma } from "./prisma";
import {
  avatarUrl,
  CE_ID_OFFSET,
  ceLogin,
  langsText,
  searchCePage,
  type CeSearchRecord,
} from "./ce";
import { inferCountry } from "./country";

const globalJobs = globalThis as unknown as { ceImportRunning?: boolean };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertCeUser(record: CeSearchRecord) {
  const login = ceLogin(record.userId);
  const location = [record.Town, record.State, record.CountryLiveIn]
    .filter(Boolean)
    .join(", ");
  const fields = {
    githubId: CE_ID_OFFSET + record.userId,
    name: record.firstName || login,
    bio: record.Description || record.Interests || null,
    location,
    country: inferCountry(record.CountryLiveIn || location),
    company: langsText(record) || null,
    blog: null,
    avatarUrl: avatarUrl(record.avatarLocation),
    htmlUrl: `https://www.conversationexchange.com/members/readConversation.php?lg=en&RecordID=${record.userId}&ref=search`,
    emailStatus: "ce",
    emailSource: "conversationexchange",
    publicEmail: `ce:${record.userId}`,
    enrichError: null,
    enrichedAt: new Date(),
    fetchedAt: new Date(),
  };
  const user = await prisma.githubUser.upsert({
    where: { login },
    create: { login, ...fields },
    update: fields,
  });
  await prisma.userRelation.upsert({
    where: {
      sourceLogin_type_userId: {
        sourceLogin: "conversationexchange",
        type: "search",
        userId: user.id,
      },
    },
    create: {
      sourceLogin: "conversationexchange",
      type: "search",
      userId: user.id,
    },
    update: {},
  });
  return user;
}

export async function startCeImport(input: {
  query?: string;
  maxPages?: number;
}) {
  if (globalJobs.ceImportRunning) {
    throw new Error("A Conversation Exchange import is already running");
  }
  const job = await prisma.importJob.create({
    data: {
      sourceLogin: "conversationexchange",
      includeFollowers: false,
      includeFollowing: false,
      status: "queued",
      phase: "starting",
    },
  });
  void runCeImport(job.id, input.query || "lg=en&Sort=login", input.maxPages || 20);
  return job;
}

export async function runCeImport(jobId: number, query: string, maxPages: number) {
  if (globalJobs.ceImportRunning) return;
  globalJobs.ceImportRunning = true;
  try {
    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: "running", phase: "search page 0", error: null },
    });

    let processed = 0;
    let emailsFound = 0;
    let totalPages = 1;
    const cap = Math.min(Math.max(maxPages, 1), 67);

    for (let page = 0; page < cap; page += 1) {
      const result = await searchCePage(page, query);
      totalPages = Math.min(result.totalPages || cap, cap);
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          total: Math.min(result.totalRows || 0, totalPages * 15),
          phase: `search page ${page + 1}/${totalPages}`,
        },
      });
      for (const record of result.records) {
        if (!record.userId) continue;
        await upsertCeUser(record);
        processed += 1;
        emailsFound += 1;
      }
      await prisma.importJob.update({
        where: { id: jobId },
        data: { processed, emailsFound },
      });
      if (page + 1 >= totalPages || result.records.length === 0) break;
      await sleep(1100);
    }

    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: "done", phase: "complete", processed, emailsFound },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: "error", error: message, phase: "failed" },
    });
  } finally {
    globalJobs.ceImportRunning = false;
  }
}
