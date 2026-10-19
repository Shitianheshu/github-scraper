import { DEFAULT_DRIP_TEMPLATES, formatDripTemplates } from "./drip";
import { prisma } from "./prisma";

export type AppSettings = {
  githubToken: string;
  gasWebAppUrl: string;
  gasSecret: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  imapHost: string;
  imapPort: string;
  imapUser: string;
  imapPass: string;
  dailyCap: string;
  signature: string;
  template: string;
  dripMinMinutes: string;
  dripMaxMinutes: string;
  dripPaused: string;
  dripTemplates: string;
  ceEmail: string;
  cePassword: string;
  ceCookie: string;
  ceMaxPages: string;
  ceMinMinutes: string;
  ceMaxMinutes: string;
};

const DEFAULTS: AppSettings = {
  githubToken: "",
  gasWebAppUrl: "",
  gasSecret: "",
  smtpHost: "",
  smtpPort: "587",
  smtpUser: "",
  smtpPass: "",
  smtpFrom: "",
  imapHost: "",
  imapPort: "993",
  imapUser: "",
  imapPass: "",
  dailyCap: "20",
  signature:
    "\n\n—\nIf you would rather not hear from me, reply STOP and I will not write again.",
  template:
    "Hi {{name}},\n\nI found your GitHub profile ({{github}}) and wanted to say hello.\n\nBest,\n",
  dripMinMinutes: "25",
  dripMaxMinutes: "80",
  dripPaused: "false",
  dripTemplates: formatDripTemplates(DEFAULT_DRIP_TEMPLATES),
  ceEmail: "",
  cePassword: "",
  ceCookie: "",
  ceMaxPages: "20",
  ceMinMinutes: "180",
  ceMaxMinutes: "360",
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.setting.findMany();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const merged = { ...DEFAULTS, ...map };
  if (!merged.githubToken && process.env.GITHUB_TOKEN) {
    merged.githubToken = process.env.GITHUB_TOKEN;
  }
  if (!merged.gasWebAppUrl && process.env.GAS_WEBAPP_URL) {
    merged.gasWebAppUrl = process.env.GAS_WEBAPP_URL;
  }
  if (!merged.gasSecret && process.env.GAS_SECRET) {
    merged.gasSecret = process.env.GAS_SECRET;
  }
  if (!merged.ceEmail && process.env.CE_EMAIL) merged.ceEmail = process.env.CE_EMAIL;
  if (!merged.cePassword && process.env.CE_PASSWORD) {
    merged.cePassword = process.env.CE_PASSWORD;
  }
  if (!merged.ceCookie && process.env.CE_COOKIE) merged.ceCookie = process.env.CE_COOKIE;
  return merged;
}

export async function saveSettings(patch: Partial<AppSettings>) {
  const entries = Object.entries(patch).filter(
    ([, value]) => typeof value === "string",
  ) as [string, string][];
  for (const [key, value] of entries) {
    const next =
      key === "gasSecret" || key === "gasWebAppUrl" || key === "ceCookie" || key === "ceEmail"
        ? value.trim()
        : value;
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: next },
      update: { value: next },
    });
  }
}

export function renderTemplate(
  template: string,
  vars: {
    login: string;
    name: string;
    country?: string;
    location?: string;
    company?: string;
    htmlUrl?: string;
  },
) {
  return template
    .replaceAll("{{login}}", vars.login)
    .replaceAll("{{name}}", vars.name || vars.login)
    .replaceAll("{{country}}", vars.country || "")
    .replaceAll("{{location}}", vars.location || "")
    .replaceAll("{{company}}", vars.company || "")
    .replaceAll("{{github}}", vars.htmlUrl || `https://github.com/${vars.login}`);
}
