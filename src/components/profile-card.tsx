import type { ReactNode } from "react";
import { inferCountry } from "@/lib/country";
import { githubUrl, websiteUrl } from "@/lib/links";

function isCe(user: ProfileView) {
  return user.login.startsWith("ce-") || user.emailStatus === "ce";
}

export type ProfileView = {
  login: string;
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
  githubCreatedAt: string | Date | null;
  avatarUrl: string | null;
  htmlUrl: string | null;
  publicEmail: string | null;
  emailSource: string | null;
  emailStatus: string;
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === "") return null;
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2 py-2 text-[13px]">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function Avatar({
  user,
  size = 40,
}: {
  user: Pick<ProfileView, "avatarUrl" | "name" | "login">;
  size?: number;
}) {
  const label = (user.name || user.login).slice(0, 1).toUpperCase();
  if (user.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid place-items-center rounded-full bg-[var(--bg-3)] text-xs font-medium"
      style={{ width: size, height: size }}
    >
      {label}
    </span>
  );
}

export function ProfileCard({ user }: { user: ProfileView }) {
  const gh = githubUrl(user.login, user.htmlUrl);
  const site = websiteUrl(user.blog);
  const country = user.country || inferCountry(user.location);
  const joined = user.githubCreatedAt
    ? new Date(user.githubCreatedAt).toLocaleDateString()
    : null;

  return (
    <div>
      <div className="flex items-start gap-3">
        <Avatar user={user} size={48} />
        <div className="min-w-0">
          <p className="truncate font-medium">{user.name || user.login}</p>
          <p className="text-[13px] text-[var(--muted)]">
            {isCe(user) ? "Conversation Exchange" : `@${user.login}`}
          </p>
        </div>
      </div>
      {user.bio ? (
        <p className="mt-3 text-[13px] leading-5 text-zinc-400">{user.bio}</p>
      ) : null}
      <dl className="mt-4 divide-y divide-[var(--line)]">
        <Row label={isCe(user) ? "Profile" : "GitHub"}>
          <a href={isCe(user) ? user.htmlUrl || gh : gh} target="_blank" rel="noreferrer">
            {isCe(user) ? "Open on Conversation Exchange" : user.login}
          </a>
        </Row>
        <Row label="Email">
          {user.publicEmail?.startsWith("ce:") ? "CE inbox (not email)" : user.publicEmail}
        </Row>
        <Row label="Country">{country}</Row>
        <Row label="Location">{user.location}</Row>
        <Row label="Company">{user.company}</Row>
        <Row label="Site">
          {site ? (
            <a href={site} target="_blank" rel="noreferrer">
              {user.blog}
            </a>
          ) : null}
        </Row>
        <Row label="Twitter">
          {user.twitterUsername ? (
            <a href={`https://x.com/${user.twitterUsername}`} target="_blank" rel="noreferrer">
              @{user.twitterUsername}
            </a>
          ) : null}
        </Row>
        <Row label="Repos">{user.publicRepos ?? null}</Row>
        <Row label="Followers">{user.followersCount ?? null}</Row>
        <Row label="Joined">{joined}</Row>
      </dl>
    </div>
  );
}
