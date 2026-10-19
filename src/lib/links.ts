export function websiteUrl(blog: string | null | undefined): string | null {
  if (!blog) return null;
  const trimmed = blog.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function githubUrl(login: string, htmlUrl?: string | null) {
  return htmlUrl || `https://github.com/${login}`;
}
