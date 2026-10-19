import { Octokit } from "octokit";
import { inferCountry } from "./country";

const GITHUB_NOREPLY = /@(users\.)?noreply\.github\.com$/i;

export type Profile = {
  login: string;
  githubId: number;
  name: string | null;
  bio: string | null;
  location: string | null;
  country: string | null;
  company: string | null;
  blog: string | null;
  twitterUsername: string | null;
  hireable: boolean | null;
  publicRepos: number | null;
  followersCount: number | null;
  followingCount: number | null;
  githubCreatedAt: Date | null;
  avatarUrl: string | null;
  htmlUrl: string | null;
  profileEmail: string | null;
};

export type EmailHit = {
  email: string;
  source: "profile" | "events" | "commits";
  kind: "real" | "noreply";
};

export function createOctokit(token: string) {
  return new Octokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter: number, options: { method?: string; url?: string }, _octokit: unknown, retryCount: number) => {
        if (retryCount < 3) {
          console.warn(
            `GitHub rate limit on ${options.method} ${options.url}; retry in ${retryAfter}s`,
          );
          return true;
        }
        return false;
      },
      onSecondaryRateLimit: (retryAfter: number, options: { method?: string; url?: string }, _octokit: unknown, retryCount: number) => {
        if (retryCount < 2) {
          console.warn(
            `GitHub secondary rate limit on ${options.method} ${options.url}; retry in ${retryAfter}s`,
          );
          return true;
        }
        return false;
      },
    },
  });
}

export function classifyEmail(raw: string | null | undefined): EmailHit["kind"] | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (GITHUB_NOREPLY.test(email) || email === "noreply@github.com") return "noreply";
  return "real";
}

function consider(raw: string | null | undefined, source: EmailHit["source"]): EmailHit | null {
  const kind = classifyEmail(raw);
  if (!kind || !raw) return null;
  return { email: raw.trim().toLowerCase(), source, kind };
}

export async function fetchProfile(octokit: Octokit, username: string): Promise<Profile> {
  const { data } = await octokit.rest.users.getByUsername({ username });
  const location = data.location ?? null;
  return {
    login: data.login,
    githubId: data.id,
    name: data.name ?? null,
    bio: data.bio ?? null,
    location,
    country: inferCountry(location),
    company: data.company ?? null,
    blog: data.blog ?? null,
    twitterUsername: data.twitter_username ?? null,
    hireable: typeof data.hireable === "boolean" ? data.hireable : null,
    publicRepos: data.public_repos ?? null,
    followersCount: data.followers ?? null,
    followingCount: data.following ?? null,
    githubCreatedAt: data.created_at ? new Date(data.created_at) : null,
    avatarUrl: data.avatar_url ?? null,
    htmlUrl: data.html_url ?? null,
    profileEmail: data.email ?? null,
  };
}

function emailsFromUnknown(payload: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || node == null) return;
    if (typeof node === "string") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.email === "string") found.push(obj.email);
    for (const value of Object.values(obj)) walk(value, depth + 1);
  };
  walk(payload, 0);
  return found;
}

export async function findEmailFromEvents(
  octokit: Octokit,
  username: string,
): Promise<EmailHit | null> {
  let noreply: EmailHit | null = null;
  const iterator = octokit.paginate.iterator(octokit.rest.activity.listPublicEventsForUser, {
    username,
    per_page: 100,
  });

  let pages = 0;
  for await (const response of iterator) {
    pages += 1;
    for (const event of response.data) {
      const payload = (event as { payload?: unknown }).payload;
      for (const email of emailsFromUnknown(payload)) {
        const hit = consider(email, "events");
        if (!hit) continue;
        if (hit.kind === "real") return hit;
        noreply ??= hit;
      }
    }
    if (pages >= 3) break;
  }
  return noreply;
}

export async function findEmailFromCommits(
  octokit: Octokit,
  username: string,
): Promise<EmailHit | null> {
  const { data: repos } = await octokit.rest.repos.listForUser({
    username,
    type: "owner",
    sort: "pushed",
    per_page: 10,
  });

  let noreply: EmailHit | null = null;
  for (const repo of repos) {
    if (repo.fork) continue;
    try {
      const { data: commits } = await octokit.rest.repos.listCommits({
        owner: repo.owner.login,
        repo: repo.name,
        author: username,
        per_page: 30,
      });
      for (const commit of commits) {
        const candidates = [
          commit.commit?.author?.email,
          commit.commit?.committer?.email,
        ];
        for (const email of candidates) {
          const hit = consider(email, "commits");
          if (!hit) continue;
          if (hit.kind === "real") return hit;
          noreply ??= hit;
        }
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 409 || status === 404) continue;
      throw error;
    }
  }
  return noreply;
}

export async function resolvePublicEmail(
  octokit: Octokit,
  profile: Profile,
): Promise<EmailHit | null> {
  const fromProfile = consider(profile.profileEmail, "profile");
  if (fromProfile?.kind === "real") return fromProfile;

  const fromEvents = await findEmailFromEvents(octokit, profile.login);
  if (fromEvents?.kind === "real") return fromEvents;

  const fromCommits = await findEmailFromCommits(octokit, profile.login);
  if (fromCommits?.kind === "real") return fromCommits;

  return fromProfile ?? fromEvents ?? fromCommits;
}

export async function listLogins(
  octokit: Octokit,
  username: string,
  type: "followers" | "following",
  opts: { max?: number } = {},
): Promise<string[]> {
  const method =
    type === "followers"
      ? octokit.rest.users.listFollowersForUser
      : octokit.rest.users.listFollowingForUser;
  const logins: string[] = [];
  const iterator = octokit.paginate.iterator(method, { username, per_page: 100 });
  for await (const response of iterator) {
    for (const user of response.data) {
      logins.push(user.login);
      if (opts.max && logins.length >= opts.max) {
        return logins;
      }
    }
  }
  return logins;
}

export async function sourceStats(octokit: Octokit, username: string) {
  const profile = await fetchProfile(octokit, username);
  return {
    login: profile.login,
    followers: profile.followersCount || 0,
    following: profile.followingCount || 0,
    avatarUrl: profile.avatarUrl,
  };
}
