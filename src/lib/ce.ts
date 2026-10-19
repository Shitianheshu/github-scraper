import { getSettings, saveSettings, type AppSettings } from "./settings";

export const CE_ORIGIN = "https://www.conversationexchange.com";
export const CE_ID_OFFSET = 2_000_000_000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

export type CeSearchRecord = {
  userId: number;
  firstName: string;
  CountryLiveIn?: string;
  Town?: string;
  State?: string;
  Nlangs?: string;
  Plangs?: { language: string }[] | string;
  Description?: string;
  Interests?: string;
  avatarLocation?: string;
  LastLogin?: string;
};

export function ceLogin(userId: number) {
  return `ce-${userId}`;
}

export function ceRecordId(user: {
  login: string;
  githubId?: number;
  publicEmail?: string | null;
}) {
  if (user.publicEmail?.startsWith("ce:")) {
    return Number(user.publicEmail.slice(3));
  }
  if (user.login.startsWith("ce-")) {
    return Number(user.login.slice(3));
  }
  if (user.githubId && user.githubId >= CE_ID_OFFSET) {
    return user.githubId - CE_ID_OFFSET;
  }
  return null;
}

export function isCeUser(user: { login: string; emailStatus?: string }) {
  return user.login.startsWith("ce-") || user.emailStatus === "ce";
}

export function isCeAddress(addr: string) {
  return addr.startsWith("ce:");
}

export function isCeThrottleError(err: string) {
  return /too many messages|too short period|forced time delay|purchasing a membership/i.test(
    err,
  );
}

export function ceIntervalMinutes(settings: {
  ceMinMinutes?: string;
  ceMaxMinutes?: string;
}) {
  const min = Math.max(60, Number(settings.ceMinMinutes || "180") || 180);
  const max = Math.max(min, Number(settings.ceMaxMinutes || "360") || 360);
  return { min, max };
}

function mergeCookie(existing: string, setCookie: string[]) {
  const map = new Map<string, string>();
  for (const part of existing.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name && rest.length) map.set(name, rest.join("="));
  }
  for (const header of setCookie) {
    const pair = header.split(";")[0];
    const [name, ...rest] = pair.split("=");
    if (name && rest.length) map.set(name.trim(), rest.join("="));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function cookieHeaders(cookie: string): HeadersInit {
  return {
    "User-Agent": UA,
    Accept: "application/json, text/html;q=0.9,*/*;q=0.8",
    "X-Requested-With": "XMLHttpRequest",
    Cookie: cookie,
  };
}

export async function ceRequest(
  path: string,
  opts: {
    method?: string;
    cookie: string;
    body?: URLSearchParams | string;
    contentType?: string;
    referer?: string;
  },
) {
  const headers: Record<string, string> = {
    ...(cookieHeaders(opts.cookie) as Record<string, string>),
    Origin: CE_ORIGIN,
    Referer: opts.referer || `${CE_ORIGIN}/`,
  };
  if (opts.body) {
    headers["Content-Type"] =
      opts.contentType || "application/x-www-form-urlencoded;charset=UTF-8";
  }
  const res = await fetch(`${CE_ORIGIN}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body,
    redirect: "manual",
  });
  const setCookie =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie") as string]
        : [];
  let cookie = setCookie.length ? mergeCookie(opts.cookie, setCookie) : opts.cookie;
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) {
    const next = new URL(location, CE_ORIGIN);
    if (next.origin === CE_ORIGIN) {
      const followed = await fetch(next, {
        method: "GET",
        headers: { ...cookieHeaders(cookie), Referer: `${CE_ORIGIN}/` },
        redirect: "manual",
      });
      const extra =
        typeof followed.headers.getSetCookie === "function"
          ? followed.headers.getSetCookie()
          : [];
      if (extra.length) cookie = mergeCookie(cookie, extra);
      const text = await followed.text();
      return { res: followed, text, cookie };
    }
  }
  const text = await res.text();
  return { res, text, cookie };
}

export async function persistCookie(cookie: string) {
  if (cookie.trim()) await saveSettings({ ceCookie: cookie.trim() });
}

export async function sessionCookie(settings?: AppSettings) {
  const current = settings || (await getSettings());
  return (current.ceCookie || process.env.CE_COOKIE || "").trim();
}

export async function loginCe() {
  const settings = await getSettings();
  const email = (settings.ceEmail || process.env.CE_EMAIL || "").trim();
  const password = settings.cePassword || process.env.CE_PASSWORD || "";
  let cookie = await sessionCookie(settings);
  if (cookie) {
    const ping = await ceRequest("/ajax/getMessagesList.php", {
      method: "POST",
      cookie,
      body: new URLSearchParams({ lg: "en", folder: "inbox", crtPg: "0", numMsg: "1" }),
    });
    cookie = ping.cookie;
    await persistCookie(cookie);
    if (!ping.text.includes("notLogged")) {
      return { ok: true, cookie, via: "cookie" as const };
    }
  }
  if (!email || !password) {
    throw new Error("Set Conversation Exchange email/password or cookie in Settings");
  }

  const body = new URLSearchParams({
    Email: email,
    Password: password,
    lg: "en",
    autologin: "1",
  });
  const { res, text, cookie: next } = await ceRequest("/members/login.php?lg=en", {
    method: "POST",
    cookie,
    body,
  });
  cookie = next;
  await persistCookie(cookie);

  if (res.status === 403 || /cf-challenge|Just a moment/i.test(text)) {
    throw new Error(
      "Cloudflare blocked the login POST. Open the site in your browser, log in, then paste the Cookie header into Settings.",
    );
  }
  const logged = /isUserLogged\s*=\s*true/.test(text) || res.status === 302;
  if (!logged && /incorrect|invalid|error/i.test(text) && /loginForm/.test(text)) {
    throw new Error("Conversation Exchange login failed. Check email/password.");
  }
  return { ok: true, cookie, via: "password" as const };
}

export async function searchCePage(page: number, query: string) {
  const qs = query.includes("lg=") ? query : `lg=en&Sort=login&${query}`;
  const url = `/ajax/getSearchResults.php?pg=${page}&${qs}`;
  const { text } = await ceRequest(url, { cookie: "" });
  if (!text.trim()) throw new Error("Empty search response");
  const data = JSON.parse(text) as {
    records?: CeSearchRecord[];
    totalRows?: number;
    getTotalPages?: number;
  };
  return {
    records: data.records || [],
    totalRows: Number(data.totalRows || 0),
    totalPages: Number(data.getTotalPages || 0),
  };
}

function toHtmlMessage(text: string) {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "<br>");
  return `<p>${escaped}</p>`;
}

export async function sendCeMessage(recordId: number, body: string) {
  if (!Number.isFinite(recordId) || recordId <= 0) {
    throw new Error("Invalid Conversation Exchange user id");
  }
  const ready = await loginCe();
  const payload = new URLSearchParams({
    lg: "en",
    RecordID: String(recordId),
    emailMessage: toHtmlMessage(body),
  });
  const referer = `${CE_ORIGIN}/members/readConversation.php?lg=en&RecordID=${recordId}&ref=search`;
  const { res, text, cookie } = await ceRequest("/ajax/sendMessage.php", {
    method: "POST",
    cookie: ready.cookie,
    body: payload,
    referer,
  });
  await persistCookie(cookie);
  if (res.status >= 400) {
    throw new Error(`CE send HTTP ${res.status}: ${text.slice(0, 180)}`);
  }
  if (text.includes("notLogged")) {
    throw new Error("Conversation Exchange session expired. Re-save login in Settings.");
  }
  if (isCeThrottleError(text)) {
    throw new Error(
      "Too many messages sent in a too short period of time. Please try again later.",
    );
  }
  let parsed: { err?: string } | string = text;
  try {
    parsed = JSON.parse(text) as { err?: string } | string;
  } catch {
    throw new Error(`CE send returned non-JSON: ${text.slice(0, 180)}`);
  }
  if (parsed === "notLogged") {
    throw new Error("Conversation Exchange session expired.");
  }
  if (typeof parsed === "object" && parsed && parsed.err) {
    throw new Error(parsed.err);
  }
  return `ce-${recordId}-${Date.now()}`;
}

type InboxRow = {
  userId?: number;
  senderId?: number;
  sender_id?: number;
  RecordID?: number;
  id?: number;
  firstName?: string;
  name?: string;
  subject?: string;
  lastMsg?: string;
  preview?: string;
  message?: string;
  body?: string;
  read?: number;
};

export async function listCeInbox() {
  const ready = await loginCe();
  const payload = new URLSearchParams({
    lg: "en",
    folder: "inbox",
    crtPg: "0",
    numMsg: "30",
  });
  const { text, cookie } = await ceRequest("/ajax/getMessagesList.php", {
    method: "POST",
    cookie: ready.cookie,
    body: payload,
  });
  await persistCookie(cookie);
  if (text.includes("notLogged")) {
    throw new Error("Conversation Exchange session expired.");
  }
  if (text.includes("noMsgs")) return [];
  const data = JSON.parse(text) as { records?: InboxRow[] } | string;
  if (data === "noMsgs" || data === "notLogged") return [];
  return (data as { records?: InboxRow[] }).records || [];
}

export async function getCeConversation(recordId: number) {
  const ready = await loginCe();
  const payload = new URLSearchParams({
    RecordID: String(recordId),
    crtPg: "0",
  });
  const { text, cookie } = await ceRequest("/ajax/getConversationMsgs.php", {
    method: "POST",
    cookie: ready.cookie,
    body: payload,
  });
  await persistCookie(cookie);
  if (text.includes("notLogged")) return [];
  const data = JSON.parse(text) as { records?: Array<Record<string, unknown>> } | string;
  if (typeof data === "string") return [];
  return data.records || [];
}

export function avatarUrl(path?: string | null) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${CE_ORIGIN}${path}`;
}

export function langsText(record: CeSearchRecord) {
  const native = record.Nlangs || "";
  const learning = Array.isArray(record.Plangs)
    ? record.Plangs.map((p) => p.language).join(", ")
    : record.Plangs || "";
  return [native && `Speaks ${native}`, learning && `Learning ${learning}`]
    .filter(Boolean)
    .join(" · ");
}
