import { NextResponse } from "next/server";
import { getSettings, saveSettings, type AppSettings } from "@/lib/settings";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    ...settings,
    smtpPass: settings.smtpPass ? "••••" : "",
    imapPass: settings.imapPass ? "••••" : "",
    githubToken: settings.githubToken ? "••••" : "",
    cePassword: settings.cePassword ? "••••" : "",
    gasSecret: settings.gasSecret,
    hasCe: Boolean(settings.ceEmail || settings.ceCookie),
    hasGithubToken: Boolean(settings.githubToken),
    hasGas: Boolean(settings.gasWebAppUrl),
    hasSmtp: Boolean(settings.smtpHost && settings.smtpFrom),
    hasImap: Boolean(settings.imapHost && settings.imapUser),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<AppSettings>;
  const clean: Partial<AppSettings> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "string") continue;
    if (value.includes("•")) continue;
    clean[key as keyof AppSettings] = value;
  }
  await saveSettings(clean);
  return NextResponse.json({ ok: true });
}
