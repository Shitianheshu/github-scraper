export type DripTemplate = {
  kind: "project" | "friend";
  subject: string;
  body: string;
};

export const DEFAULT_DRIP_TEMPLATES: DripTemplate[] = [
  {
    kind: "project",
    subject: "{{name}} — a project question",
    body: `Hi {{name}},

I came across {{github}} and wanted to ask something small about a project I’m working on. Not a pitch — I’d value how you think about the problem, if you ever have a few minutes.

If this is a bad time, no need to reply.

Best,`,
  },
  {
    kind: "project",
    subject: "Quick thought from another builder",
    body: `Hi {{name}},

Saw your GitHub ({{github}}) and I’m exploring a similar problem. Would you be open to a short exchange on it? Happy to share context first.

Thanks,`,
  },
  {
    kind: "project",
    subject: "{{name}} さんへ — プロジェクトの相談",
    body: `{{name}} さん

GitHub（{{github}}）を拝見してご連絡しました。いま進めているプロジェクトで少し相談したいことがあり、売り込みではなく、考え方を伺えたらと思っています。

お忙しいときは無視してください。

よろしくお願いいたします。`,
  },
  {
    kind: "friend",
    subject: "Hello from GitHub",
    body: `Hi {{name}},

I found {{github}} while looking around GitHub and thought your profile was interesting. Reaching out as a fellow builder — would be glad to say hello, no agenda.

Have a good one,`,
  },
  {
    kind: "friend",
    subject: "{{name}}, hello",
    body: `Hi {{name}},

Hope you’re well. I noticed your GitHub ({{github}}) and wanted to introduce myself. If you’re ever up for a casual chat about work or side projects, I’d enjoy that.

Best,`,
  },
  {
    kind: "friend",
    subject: "{{name}} さん、こんにちは",
    body: `{{name}} さん

GitHub（{{github}}）を見て、同じようにものを作っている者としてご挨拶したくご連絡しました。何かあれば気軽にやり取りできたら嬉しいです。

どうぞよろしくお願いします。`,
  },
];

export function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function randomInt(min: number, max: number) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

export function pickTemplate(templates: DripTemplate[]): DripTemplate {
  if (templates.length === 0) return DEFAULT_DRIP_TEMPLATES[0];
  return templates[Math.floor(Math.random() * templates.length)];
}

export function parseDripTemplates(raw: string): DripTemplate[] {
  const text = raw.trim();
  if (!text) return DEFAULT_DRIP_TEMPLATES;
  const blocks = text.split(/\n---\n/);
  const parsed: DripTemplate[] = [];
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const header = lines.shift() || "";
    const kind: DripTemplate["kind"] = /friend|交流|挨拶/i.test(header)
      ? "friend"
      : "project";
    const subject =
      header.replace(/^\[(project|friend|相談|交流)\]\s*/i, "").trim() ||
      lines.shift()?.trim() ||
      "Hello";
    const body = lines.join("\n").trim();
    if (!body) continue;
    parsed.push({ kind, subject, body });
  }
  return parsed.length > 0 ? parsed : DEFAULT_DRIP_TEMPLATES;
}

export function formatDripTemplates(templates: DripTemplate[]): string {
  return templates
    .map((t) => `[${t.kind}] ${t.subject}\n\n${t.body}`)
    .join("\n---\n");
}
