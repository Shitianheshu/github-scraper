import { prisma } from "./prisma";
import {
  createOctokit,
  fetchProfile,
  listLogins,
  resolvePublicEmail,
  sourceStats,
  type Profile,
} from "./github";
import { getSettings } from "./settings";

const globalJobs = globalThis as unknown as { importRunning?: boolean };

function profileFields(profile: Profile) {
  return {
    githubId: profile.githubId,
    name: profile.name,
    bio: profile.bio,
    location: profile.location,
    country: profile.country,
    company: profile.company,
    blog: profile.blog,
    twitterUsername: profile.twitterUsername,
    hireable: profile.hireable,
    publicRepos: profile.publicRepos,
    followersCount: profile.followersCount,
    followingCount: profile.followingCount,
    githubCreatedAt: profile.githubCreatedAt,
    avatarUrl: profile.avatarUrl,
    htmlUrl: profile.htmlUrl,
  };
}

async function upsertUser(profile: Profile) {
  const fields = profileFields(profile);
  return prisma.githubUser.upsert({
    where: { login: profile.login },
    create: {
      login: profile.login,
      ...fields,
    },
    update: {
      ...fields,
      fetchedAt: new Date(),
    },
  });
}

async function linkRelation(
  sourceLogin: string,
  type: "follower" | "following",
  userId: number,
) {
  await prisma.userRelation.upsert({
    where: {
      sourceLogin_type_userId: { sourceLogin, type, userId },
    },
    create: { sourceLogin, type, userId },
    update: {},
  });
}

export async function latestJob() {
  return prisma.importJob.findFirst({ orderBy: { id: "desc" } });
}

export async function resumeStaleImport() {
  const stale = await prisma.importJob.findFirst({
    where: { status: { in: ["queued", "running"] } },
    orderBy: { id: "asc" },
  });
  if (!stale) return null;
  await prisma.importJob.updateMany({
    where: {
      id: { not: stale.id },
      status: { in: ["queued", "running"] },
    },
    data: { status: "error", error: "superseded", phase: "cancelled" },
  });
  if (!globalJobs.importRunning) void runImport(stale.id);
  return stale;
}

export async function startImport(input: {
  sourceLogin: string;
  includeFollowers: boolean;
  includeFollowing: boolean;
  expandHops?: boolean;
  maxUsers?: number;
}) {
  const sourceLogin = input.sourceLogin.trim().replace(/^@/, "");
  if (!sourceLogin) throw new Error("Source username is required");
  if (!input.includeFollowers && !input.includeFollowing) {
    throw new Error("Select followers and/or following");
  }

  const incomplete = await prisma.importJob.findFirst({
    where: {
      sourceLogin,
      status: { in: ["queued", "running"] },
    },
    orderBy: { id: "asc" },
  });
  if (incomplete) {
    await prisma.importJob.updateMany({
      where: {
        id: { not: incomplete.id },
        status: { in: ["queued", "running"] },
      },
      data: { status: "error", error: "superseded", phase: "cancelled" },
    });
    if (!globalJobs.importRunning) void runImport(incomplete.id);
    return incomplete;
  }

  if (globalJobs.importRunning) {
    throw new Error("An import is already running");
  }

  const job = await prisma.importJob.create({
    data: {
      sourceLogin,
      includeFollowers: input.includeFollowers,
      includeFollowing: input.includeFollowing,
      status: "queued",
      phase: input.expandHops ? "starting hop2" : "starting",
    },
  });

  void runImport(job.id, {
    expandHops: Boolean(input.expandHops),
    maxUsers: Math.min(Math.max(Number(input.maxUsers) || 2500, 50), 8000),
  });
  return job;
}

async function collectNetwork(
  octokit: ReturnType<typeof createOctokit>,
  job: {
    sourceLogin: string;
    includeFollowers: boolean;
    includeFollowing: boolean;
  },
  expandHops: boolean,
  maxUsers: number,
  onProgress: (phase: string, total: number) => Promise<void>,
) {
  const followerSet = new Set<string>();
  const followingSet = new Set<string>();

  await onProgress("listing source", 0);
  if (job.includeFollowers) {
    for (const login of await listLogins(octokit, job.sourceLogin, "followers")) {
      followerSet.add(login);
    }
  }
  if (job.includeFollowing) {
    for (const login of await listLogins(octokit, job.sourceLogin, "following")) {
      followingSet.add(login);
    }
  }

  const uniqueSet = new Set([...followerSet, ...followingSet]);
  await onProgress(`listed ${uniqueSet.size} from source`, uniqueSet.size);

  if (expandHops && uniqueSet.size < maxUsers) {
    const seeds = [...uniqueSet];
    for (const seed of seeds) {
      if (uniqueSet.size >= maxUsers) break;
      try {
        const extra = job.includeFollowing
          ? await listLogins(octokit, seed, "following", {
              max: Math.min(100, maxUsers - uniqueSet.size),
            })
          : [];
        const extraFollowers = job.includeFollowers
          ? await listLogins(octokit, seed, "followers", {
              max: Math.min(50, maxUsers - uniqueSet.size),
            })
          : [];
        for (const login of extra) {
          if (uniqueSet.size >= maxUsers) break;
          if (!uniqueSet.has(login)) {
            uniqueSet.add(login);
            followingSet.add(login);
          }
        }
        for (const login of extraFollowers) {
          if (uniqueSet.size >= maxUsers) break;
          if (!uniqueSet.has(login)) {
            uniqueSet.add(login);
            followerSet.add(login);
          }
        }
      } catch {
        continue;
      }
      if (uniqueSet.size % 25 === 0) {
        await onProgress(`expanding 2nd hop · ${uniqueSet.size}`, uniqueSet.size);
      }
    }
  }

  return { unique: [...uniqueSet], followerSet, followingSet };
}

async function enrichLogin(
  octokit: ReturnType<typeof createOctokit>,
  login: string,
  job: { sourceLogin: string },
  followerSet: Set<string>,
  followingSet: Set<string>,
) {
  const profile = await fetchProfile(octokit, login);
  const user = await upsertUser(profile);

  if (followerSet.has(login)) {
    await linkRelation(job.sourceLogin, "follower", user.id);
  }
  if (followingSet.has(login)) {
    await linkRelation(job.sourceLogin, "following", user.id);
  }

  if (user.emailStatus === "found" && user.publicEmail) {
    return { found: true };
  }
  if (user.emailStatus === "noreply" || user.emailStatus === "none") {
    return { found: false };
  }

  const hit = await resolvePublicEmail(octokit, profile);
  if (hit?.kind === "real") {
    await prisma.githubUser.update({
      where: { id: user.id },
      data: {
        publicEmail: hit.email,
        emailSource: hit.source,
        emailStatus: "found",
        enrichError: null,
        enrichedAt: new Date(),
      },
    });
    return { found: true };
  }
  if (hit?.kind === "noreply") {
    await prisma.githubUser.update({
      where: { id: user.id },
      data: {
        publicEmail: null,
        emailSource: hit.source,
        emailStatus: "noreply",
        enrichError: null,
        enrichedAt: new Date(),
      },
    });
    return { found: false };
  }
  await prisma.githubUser.update({
    where: { id: user.id },
    data: {
      emailStatus: "none",
      enrichError: null,
      enrichedAt: new Date(),
    },
  });
  return { found: false };
}

export async function runImport(
  jobId: number,
  opts: { expandHops?: boolean; maxUsers?: number } = {},
) {
  if (globalJobs.importRunning) return;
  globalJobs.importRunning = true;

  try {
    const settings = await getSettings();
    if (!settings.githubToken) {
      throw new Error("Set a GitHub token in Settings or GITHUB_TOKEN in .env");
    }
    const octokit = createOctokit(settings.githubToken);

    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: "running", phase: "listing", error: null },
    });

    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    const expandHops = opts.expandHops || job.phase?.includes("hop2") || false;
    const maxUsers = opts.maxUsers || 2500;

    const { unique, followerSet, followingSet } = await collectNetwork(
      octokit,
      job,
      expandHops,
      maxUsers,
      async (phase, total) => {
        await prisma.importJob.update({
          where: { id: jobId },
          data: { phase, total },
        });
      },
    );

    await prisma.importJob.update({
      where: { id: jobId },
      data: { total: unique.length, phase: "enriching", processed: 0 },
    });

    let emailsFound = 0;
    let processed = 0;

    for (const login of unique) {
      try {
        const result = await enrichLogin(octokit, login, job, followerSet, followingSet);
        if (result.found) emailsFound += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.githubUser.updateMany({
          where: { login },
          data: {
            enrichError: message.slice(0, 500),
            enrichedAt: new Date(),
          },
        });
      }

      processed += 1;
      await prisma.importJob.update({
        where: { id: jobId },
        data: { processed, emailsFound, phase: `enriching ${login}` },
      });
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
    globalJobs.importRunning = false;
  }
}

export async function previewSource(username: string) {
  const settings = await getSettings();
  if (!settings.githubToken) {
    throw new Error("Set a GitHub token first");
  }
  const octokit = createOctokit(settings.githubToken);
  return sourceStats(octokit, username.trim().replace(/^@/, ""));
}
